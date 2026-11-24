/**
 * The demo day's own files (demo-files/, made by scripts/demo/make-demo-files.ts): what Northwind Travel's Singapore
 * book receives on DEMO_TODAY, the day after the seeded window. Pure and deterministic; every value fictional.
 *
 *   - 24 new orders (BK-39001 … BK-39024) paid between 08:05 and 09:40 Singapore time, before DEMO_NOW: 20 exact,
 *     one sender-side (exchange) fee, one small underpayment, one paid after its quote expired (re-quoted), one
 *     underpaid beyond the band. Their chain transfers are in the recorded chain file, like every demo transfer.
 *   - The SGD account's bank statement for DEMO_TODAY: the bank lines the demo world dates on that day (the settlement
 *     of Monday's batch, and any batch the bank credited a day late), as a camt.053.
 */
import { bpsOf, toFiatMinor } from "../merchant/amounts";
import type { ChainTransfer, NetworkId } from "../merchant/types";
import { USDC_ETH_CONTRACT, USDT_ETH_CONTRACT, USDT_TRON_CONTRACT, fictionalAddress, fictionalTxHash } from "../synthetic/fictional";
import { createRng } from "../synthetic/prng";
import { DEMO_NOW, DEMO_TODAY } from "./clock";
import { DEMO_ACCOUNTS, DEMO_ENTITY_IDS, DEMO_SEED, type DemoWorld } from "./world";

export type NextDayScenario = "exact" | "sender_side_fee" | "underpayment_within" | "requote_within" | "underpayment_beyond";

export interface NextDayPayment {
  orderId: string; paymentId: string; quoteId: string; scenario: NextDayScenario;
  network: NetworkId; symbol: "USDT" | "USDC"; contract: string; depositAddress: string; payer: string;
  quotedBaseUnits: bigint; receivedBaseUnits: bigint; quoteRate: string; executedRate: string;
  invoiceMinor: bigint; creditedMinor: bigint; feeMinor: bigint;
  quoteCreatedAt: string; quoteExpiresAt: string; paidAt: string; txHash: string; logIndex: number; status: string;
}

export interface NextDay {
  entityId: string; currency: "SGD"; day: string; account: string;
  payments: NextDayPayment[];
  transfers: ChainTransfer[];
  bankLines: { bankLineId: string; valueDate: string; amountMinor: bigint; description: string }[];
}

const MIN = 60_000;
const tokenOf = (k: number) => (k % 20 < 11 ? { network: "tron" as const, symbol: "USDT" as const, contract: USDT_TRON_CONTRACT }
  : k % 20 < 17 ? { network: "ethereum" as const, symbol: "USDC" as const, contract: USDC_ETH_CONTRACT } : { network: "ethereum" as const, symbol: "USDT" as const, contract: USDT_ETH_CONTRACT });
const SCENARIOS: Readonly<Record<number, NextDayScenario>> = { 6: "sender_side_fee", 11: "underpayment_within", 16: "requote_within", 21: "underpayment_beyond" };
const STATUS: Readonly<Record<NextDayScenario, string>> = { exact: "COMPLETE", sender_side_fee: "COMPLETE", underpayment_within: "SHORT", requote_within: "REPRICED", underpayment_beyond: "SHORT" };
const shift = (rate: string, d: number) => { const v = Number(rate.replace(".", "")) + d; return `${Math.floor(v / 10_000)}.${String(v % 10_000).padStart(4, "0")}`; };

export function demoNextDay(demo: DemoWorld): NextDay {
  const rng = createRng(DEMO_SEED + 1);
  const fx = (symbol: string) => demo.world.fxRates.find((r) => r.pair === `${symbol}/SGD` && r.timestamp.startsWith(DEMO_TODAY))!.rate;
  const exchange = { tron: fictionalAddress("tron", rng), ethereum: fictionalAddress("ethereum", rng) };
  const payments: NextDayPayment[] = [];
  const transfers: ChainTransfer[] = [];
  const start = Date.parse(`${DEMO_TODAY}T00:05:00.000Z`);
  for (let k = 1; k <= 24; k++) {
    const scenario = SCENARIOS[k] ?? "exact";
    const tok = tokenOf(k);
    const paidMs = start + (k - 1) * 4 * MIN + rng.int(0, 150) * 1000;
    const requote = scenario === "requote_within";
    const qCreated = requote ? paidMs - 38 * MIN : paidMs - rng.int(2, 18) * MIN;
    const quoteRate = fx(tok.symbol);
    const quoted = BigInt(rng.int(4_000, 360_000)) * 10_000n; // 40.00 … 3,600.00 tokens
    const gap = scenario === "sender_side_fee" ? 1_200_000n : scenario === "underpayment_within" ? 2_400_000n : scenario === "underpayment_beyond" ? (quoted * 6n) / 100n / 10_000n * 10_000n : 0n;
    const received = quoted - gap;
    const executedRate = requote ? shift(quoteRate, -4) : quoteRate;
    const invoiceMinor = toFiatMinor(quoted, 6, quoteRate, "SGD");
    const creditedMinor = toFiatMinor(received, 6, executedRate, "SGD");
    const network = tok.network;
    const depositAddress = fictionalAddress(network, rng);
    const payer = scenario === "sender_side_fee" ? exchange[network] : fictionalAddress(network, rng);
    const txHash = fictionalTxHash(network, rng);
    const logIndex = network === "tron" ? 0 : rng.int(0, 120);
    const n = 39_000 + k;
    payments.push({
      orderId: `BK-${n}`, paymentId: `PPX-${n}`, quoteId: `QX-${n}`, scenario, network, symbol: tok.symbol, contract: tok.contract, depositAddress, payer,
      quotedBaseUnits: quoted, receivedBaseUnits: received, quoteRate, executedRate, invoiceMinor, creditedMinor, feeMinor: bpsOf(creditedMinor, 100),
      quoteCreatedAt: new Date(qCreated).toISOString(), quoteExpiresAt: new Date(qCreated + 30 * MIN).toISOString(), paidAt: new Date(paidMs).toISOString(),
      txHash, logIndex, status: STATUS[scenario],
    });
    const blockMs = network === "tron" ? 3_000 : 12_000;
    transfers.push({
      network, txHash, logIndex, tokenContract: tok.contract, from: payer, to: depositAddress, amountBaseUnits: received, decimals: 6,
      block: (network === "tron" ? 71_300_000 : 23_970_000) + Math.floor((paidMs - start) / blockMs), timestamp: new Date(paidMs).toISOString(),
      confirmations: Math.floor((Date.parse(DEMO_NOW) - paidMs) / blockMs),
    });
  }
  const sg = demo.inputs.find((i) => i.entity.id === DEMO_ENTITY_IDS.SG)!;
  const bankLines = sg.bankLines.filter((l) => l.account === DEMO_ACCOUNTS.SGD && l.valueDate === DEMO_TODAY)
    .map((l) => ({ bankLineId: l.bankLineId, valueDate: l.valueDate, amountMinor: l.amountMinor, description: l.description }));
  return { entityId: DEMO_ENTITY_IDS.SG, currency: "SGD", day: DEMO_TODAY, account: DEMO_ACCOUNTS.SGD, payments, transfers, bankLines };
}

/** Every demo transfer — the seeded window and the demo day's files — for the recorded chain file. */
export function allDemoTransfers(demo: DemoWorld): ChainTransfer[] {
  return [...demo.inputs.flatMap((i) => i.transfers), ...demoNextDay(demo).transfers];
}
