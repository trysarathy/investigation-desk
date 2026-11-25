/**
 * v1 conformance fixtures for Solana JSON-RPC in its real response shapes (getTransaction with encoding "jsonParsed",
 * getSignaturesForAddress, getTokenAccountsByOwner, getSlot). Every wallet, token account and signature is FICTIONAL
 * (base58 derived from a label); only the USDC mint is a real public address (networks.ts). Synthetic, not captured live.
 */
import { createHash } from "node:crypto";
import { type HttpRequest, type HttpResponse, SPL_TOKEN_PROGRAM, USDC_SOLANA_MINT } from "@/lib/clearline/merchant/chain";

const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let s = "";
  while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}
const digest = (label: string, len: number) => { const out = new Uint8Array(len); for (let i = 0; i < len; i += 32) out.set(createHash("sha256").update(`${label}:${i}`).digest().subarray(0, Math.min(32, len - i)), i); out[0] |= 1; return out; };
export const pubkey = (label: string) => b58(digest(`pk:${label}`, 32));
export const signature = (label: string) => b58(digest(`sig:${label}`, 64));

export const WALLET = pubkey("deposit-wallet");
export const PAYER = pubkey("payer-wallet");
export const WALLET_USDC_ATA = pubkey("deposit-usdc-ata");
export const PAYER_USDC_ATA = pubkey("payer-usdc-ata");
export const LOOKALIKE_MINT = pubkey("lookalike-mint"); // a fictional mint with the same symbol: never a payment
export const WALLET_LOOKALIKE_ATA = pubkey("deposit-lookalike-ata");
export const SLOT = 380_000_000;
export const TX_TIME_S = Date.UTC(2026, 0, 15, 9) / 1000;
export const AMOUNT = 250_000_000n;

export interface SolTx { sig: string; slot: number; blockTime: number; err?: unknown; mint?: string; amount?: bigint; checked?: boolean; inner?: boolean; destAta?: string }

/** A getTransaction (jsonParsed) result: one SPL transfer from the payer's token account to the wallet's. */
export function txBody(t: SolTx) {
  const mint = t.mint ?? USDC_SOLANA_MINT;
  const dest = t.destAta ?? (mint === USDC_SOLANA_MINT ? WALLET_USDC_ATA : WALLET_LOOKALIKE_ATA);
  const amount = (t.amount ?? AMOUNT).toString();
  const keys = [
    { pubkey: PAYER, signer: true, writable: true, source: "transaction" },
    { pubkey: PAYER_USDC_ATA, signer: false, writable: true, source: "transaction" },
    { pubkey: dest, signer: false, writable: true, source: "transaction" },
    { pubkey: mint, signer: false, writable: false, source: "transaction" },
    { pubkey: SPL_TOKEN_PROGRAM, signer: false, writable: false, source: "transaction" },
    { pubkey: "ComputeBudget111111111111111111111111111111", signer: false, writable: false, source: "transaction" },
  ];
  const transfer = t.checked === false
    ? { program: "spl-token", programId: SPL_TOKEN_PROGRAM, parsed: { type: "transfer", info: { source: PAYER_USDC_ATA, destination: dest, authority: PAYER, amount } }, stackHeight: t.inner ? 2 : null }
    : { program: "spl-token", programId: SPL_TOKEN_PROGRAM, parsed: { type: "transferChecked", info: { source: PAYER_USDC_ATA, destination: dest, authority: PAYER, mint, tokenAmount: { amount, decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: String(Number(amount) / 1e6) } } }, stackHeight: t.inner ? 2 : null };
  const computeBudget = { programId: "ComputeBudget111111111111111111111111111111", accounts: [], data: "3DTZbgwsozUF", stackHeight: null };
  const bal = (accountIndex: number, owner: string, ui: string) => ({ accountIndex, mint, owner, programId: SPL_TOKEN_PROGRAM, uiTokenAmount: { amount: ui, decimals: 6, uiAmount: Number(ui) / 1e6, uiAmountString: String(Number(ui) / 1e6) } });
  return {
    slot: t.slot, blockTime: t.blockTime, version: 0,
    meta: {
      err: t.err ?? null, status: t.err ? { Err: t.err } : { Ok: null }, fee: 5000, preBalances: [1_000_000_000, 2_039_280, 2_039_280, 1_461_600, 1, 1], postBalances: [999_995_000, 2_039_280, 2_039_280, 1_461_600, 1, 1],
      innerInstructions: t.inner ? [{ index: 1, instructions: [transfer] }] : [],
      logMessages: ["Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]", "Program log: Instruction: TransferChecked", "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success"],
      preTokenBalances: [bal(1, PAYER, "900000000"), bal(2, WALLET, "0")],
      postTokenBalances: [bal(1, PAYER, (900_000_000n - BigInt(amount)).toString()), bal(2, WALLET, amount)],
      rewards: [], loadedAddresses: { writable: [], readonly: [] }, computeUnitsConsumed: 6200,
    },
    transaction: {
      signatures: [t.sig],
      message: {
        accountKeys: keys, recentBlockhash: pubkey(`blockhash:${t.slot}`), addressTableLookups: [],
        instructions: t.inner ? [computeBudget, { programId: pubkey("router-program"), accounts: [PAYER, PAYER_USDC_ATA, dest], data: "9xQeWvG816bUx", stackHeight: null }] : [computeBudget, transfer],
      },
    },
  };
}

/** A synthetic Solana node over a list of transactions. `finalizedSlot`: transactions above it exist only as "confirmed". */
export function solanaNode(o: { txs: SolTx[]; confirmedSlot: number; finalizedSlot: number; down?: boolean; secondFinalizedSlotShift?: number; lookalikeAccount?: boolean; override?: (method: string, params: unknown[]) => unknown | undefined }) {
  const calls: { method: string; params: unknown[] }[] = [];
  const finalizedReads = new Map<string, number>();
  const transport = async (req: HttpRequest): Promise<HttpResponse> => {
    const { method, params } = JSON.parse(req.body!) as { method: string; params: unknown[] };
    calls.push({ method, params });
    if (o.down) return { status: 503, headers: {}, body: "unavailable" };
    const ok = (result: unknown) => ({ status: 200, headers: {}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result }) });
    const ov = o.override?.(method, params);
    if (ov !== undefined) return ok(ov);
    switch (method) {
      case "getSlot": return ok(o.confirmedSlot);
      case "getTokenAccountsByOwner": {
        const acct = (pk: string, mint: string) => ({ pubkey: pk, account: { lamports: 2_039_280, owner: SPL_TOKEN_PROGRAM, executable: false, rentEpoch: 18446744073709551615, space: 165,
          data: { program: "spl-token", space: 165, parsed: { type: "account", info: { isNative: false, mint, owner: params[0], state: "initialized", tokenAmount: { amount: "0", decimals: 6, uiAmount: 0, uiAmountString: "0" } } } } } });
        return ok({ context: { apiVersion: "2.1.13", slot: o.confirmedSlot }, value: [acct(WALLET_USDC_ATA, USDC_SOLANA_MINT), ...(o.lookalikeAccount ? [acct(WALLET_LOOKALIKE_ATA, LOOKALIKE_MINT)] : [])] });
      }
      case "getSignaturesForAddress": {
        const target = params[0];
        const list = o.txs.filter((t) => (t.destAta ?? (t.mint === LOOKALIKE_MINT ? WALLET_LOOKALIKE_ATA : WALLET_USDC_ATA)) === target).sort((a, b) => b.slot - a.slot)
          .map((t) => ({ signature: t.sig, slot: t.slot, err: t.err ?? null, memo: null, blockTime: t.blockTime, confirmationStatus: t.slot <= o.finalizedSlot ? "finalized" : "confirmed" }));
        return ok(list);
      }
      case "getTransaction": {
        const [sig, cfg] = params as [string, { commitment: string }];
        const t = o.txs.find((x) => x.sig === sig);
        if (!t) return ok(null);
        if (cfg.commitment === "finalized") {
          if (t.slot > o.finalizedSlot) return ok(null);
          const k = (finalizedReads.get(sig) ?? 0) + 1;
          finalizedReads.set(sig, k);
          if (k >= 2 && o.secondFinalizedSlotShift) return ok(txBody({ ...t, slot: t.slot + o.secondFinalizedSlotShift }));
        }
        return ok(txBody(t));
      }
      default: return { status: 200, headers: {}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }) };
    }
  };
  return { transport, calls };
}
