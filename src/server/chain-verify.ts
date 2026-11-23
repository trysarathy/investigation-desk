import "server-only";
import { readFileSync } from "node:fs";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { NETWORKS, normAddress } from "@/lib/clearline/merchant/config";
import type { NetworkId } from "@/lib/clearline/merchant/types";
import {
  NoChainClient, RecordingChainClient, liveChainClientFromEnv,
  type ChainTransferFact, type Evidence, type NonMatchingTokenFact, type VerifyChainClient,
} from "@/lib/clearline/merchant/chain";
import type { Env } from "@/lib/clearline/merchant/chain/guard";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can } from "./authz";
import { serverAudit } from "./control";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";

/**
 * rc7 phase 2: verify an entity's payments against CHAIN data. For every deposit address issued for its orders
 * (quotes and payment links) and every transaction a provider file claims, read the chain through the configured
 * client and store what it says as chain facts (source 'chain_client', with evidence: source, host, endpoint, fetched
 * at, block, block hash). A provider's claim stays a claim; the engine uses chain facts only.
 *
 * - A read that fails is stored as an `unavailable` chain read (network, address or tx hash, source, reason, time):
 *   those orders show "chain data unavailable" and are never matched; everything else reconciles.
 * - Finality: confirmations ≥ the network's confirmations_required, and a fact is stored as final only after a second
 *   read of its transaction returns the same block (and block hash when the source gives one).
 * - Cache: a transaction whose stored facts are all final is not read again. Nothing non-final is cached.
 * - Clients: the recorded client by default (CLEARLINE_CHAIN_RECORDING); the real readers only with
 *   CLEARLINE_CHAIN_LIVE=1 and keys (refused under tests and CI); otherwise every read is unavailable.
 * Logs and audit carry ids and counts only.
 */

const dbNetwork = (n: string): NetworkId => (n === "arbitrum-one" ? "arbitrum_one" : n) as NetworkId;
const DAY_MS = 86_400_000;
/** [ASSUMPTION] reads start one day before the earliest known time of the order (quote, link or invoice). */
const LOOKBACK_MS = DAY_MS;
const hashKey = (network: string, h: string) => `${network}|${network === "tron" ? h.toLowerCase().replace(/^0x/, "") : h.toLowerCase()}`;

/** The client to use, from the server's environment. */
export function verifyClientFromEnv(env: Env = process.env): VerifyChainClient {
  if (env.CLEARLINE_CHAIN_LIVE === "1") return liveChainClientFromEnv(env); // refused under tests / CI by its guard
  if (env.CLEARLINE_CHAIN_RECORDING) {
    return new RecordingChainClient(JSON.parse(readFileSync(env.CLEARLINE_CHAIN_RECORDING, "utf8")), { now: new Date().toISOString() });
  }
  return new NoChainClient();
}

interface AddressTarget { network: NetworkId; address: string; fromMs: number }
interface ChainRead { network: NetworkId; address?: string; txHash?: string; status: "ok" | "unavailable" | "not_found" | "failed_transaction" | "reorged"; reason?: string; evidence: Evidence[]; transfers: number }
type Fact = { kind: "transfer"; f: ChainTransferFact } | { kind: "lookalike"; f: NonMatchingTokenFact };

export interface VerifyResult { entityId: string; mode: VerifyChainClient["mode"]; addresses: number; transactions: number; cached: number; facts: number; final: number; pending: number; unavailable: number }

const factKey = (f: Fact) => `${f.f.network}|${f.f.txHash}|${f.f.logIndex ?? 0}`;

async function targetsOf(tx: Tx, orgId: string, entityId: string) {
  const inv = await tx.select({ orderId: t.invoices.orderId, issuedAt: t.invoices.issuedAt }).from(t.invoices)
    .where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.entityId, entityId), ne(t.invoices.status, "void")));
  const issued = new Map(inv.map((i) => [i.orderId, i.issuedAt.getTime()]));
  const ids = [...issued.keys()];
  const quotes = ids.length ? await tx.select().from(t.merchantQuotes).where(and(eq(t.merchantQuotes.orgId, orgId), inArray(t.merchantQuotes.orderId, ids))) : [];
  const links = ids.length ? await tx.select().from(t.paymentLinks).where(and(eq(t.paymentLinks.orgId, orgId), inArray(t.paymentLinks.orderId, ids))) : [];
  const addresses = new Map<string, AddressTarget>();
  const add = (network: string, address: string, at: Date | null | undefined, orderId: string) => {
    const n = dbNetwork(network);
    const fromMs = Math.min(at?.getTime() ?? Infinity, issued.get(orderId) ?? Infinity) - LOOKBACK_MS;
    const k = `${n}|${normAddress(n, address)}`;
    const prev = addresses.get(k);
    addresses.set(k, { network: n, address, fromMs: Math.min(prev?.fromMs ?? Infinity, Number.isFinite(fromMs) ? fromMs : 0) });
  };
  for (const q of quotes) add(q.network, q.depositAddress, q.createdAt, q.orderId);
  for (const l of links) add(l.network, l.depositAddress, l.createdAt, l.orderId);
  const claims = await tx.selectDistinct({ network: t.chainTransfers.network, txHash: t.chainTransfers.txHash }).from(t.chainTransfers)
    .where(and(eq(t.chainTransfers.orgId, orgId), eq(t.chainTransfers.entityId, entityId), eq(t.chainTransfers.source, "provider_export")));
  const stored = await tx.select({ network: t.chainTransfers.network, txHash: t.chainTransfers.txHash, logIndex: t.chainTransfers.logIndex, finalised: t.chainTransfers.finalised, block: t.chainTransfers.block })
    .from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, orgId), eq(t.chainTransfers.entityId, entityId), eq(t.chainTransfers.source, "chain_client")));
  return { addresses: [...addresses.values()].sort((a, b) => (`${a.network}|${a.address}` < `${b.network}|${b.address}` ? -1 : 1)), claims, stored };
}

/**
 * Read the chain for one entity and store the facts and reads. Never matches anything itself: run reconciliation
 * afterwards (runReconciliation does both).
 */
export async function verifyChainForEntity(ctx: TenantContext, entityId: string, client: VerifyChainClient = verifyClientFromEnv(), opts: { now?: Date } = {}): Promise<VerifyResult> {
  if (!can(ctx.role, "merchant_reconcile")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  const tenant = { userId: ctx.userId, orgId: ctx.orgId };
  const now = opts.now ?? new Date();
  const { addresses, claims, stored } = await withTenant(tenant, async (tx) => {
    const [ent] = await tx.select({ id: t.merchantEntities.id }).from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, entityId)));
    if (!ent) throw new AccessDenied(404, "Not found.");
    return targetsOf(tx, ctx.orgId, entityId);
  }, { read: true });
  const issued = new Set(addresses.map((a) => `${a.network}|${normAddress(a.network, a.address)}`));
  const toIssued = (network: string, to: string | undefined) => to !== undefined && issued.has(`${network}|${normAddress(network, to)}`);
  const storedFinal = new Map<string, boolean>();
  for (const s of stored) { const k = hashKey(s.network, s.txHash); storedFinal.set(k, (storedFinal.get(k) ?? true) && s.finalised); }
  const storedByKey = new Map(stored.map((s) => [`${dbNetwork(s.network)}|${s.txHash}|${s.logIndex}`, s]));

  const reads: ChainRead[] = [];
  const facts = new Map<string, Fact>();
  const readTx = new Set<string>();
  const keep = (f: Fact) => { if (!facts.has(factKey(f))) facts.set(factKey(f), f); };
  for (const a of addresses) {
    const o = await client.incoming(a.network, a.address, a.fromMs, now.getTime());
    if (o.status === "unavailable") { reads.push({ network: a.network, address: a.address, status: "unavailable", reason: o.reason, evidence: o.evidence, transfers: 0 }); continue; }
    reads.push({ network: a.network, address: a.address, status: "ok", evidence: o.evidence, transfers: o.transfers.length });
    for (const f of o.transfers) keep({ kind: "transfer", f });
    for (const f of o.nonMatching) if (toIssued(f.network, f.to)) keep({ kind: "lookalike", f });
    for (const u of o.unresolved) reads.push({ network: a.network, txHash: u.txHash, status: u.status, reason: u.reason, evidence: [], transfers: 0 });
  }
  let cached = 0;
  for (const c of claims) {
    const network = dbNetwork(c.network);
    const k = hashKey(network, c.txHash);
    if (storedFinal.get(k) === true) { cached++; continue; } // a transaction whose stored facts are all final is not read again
    const o = await client.transfer(network, c.txHash);
    readTx.add(k);
    if (o.status === "unavailable" || o.status === "not_found" || o.status === "failed_transaction") {
      reads.push({ network, txHash: c.txHash, status: o.status, reason: o.reason, evidence: o.evidence, transfers: 0 });
      continue;
    }
    reads.push({ network, txHash: c.txHash, status: o.status === "reorged" ? "reorged" : "ok", ...(o.status === "reorged" ? { reason: o.reason } : {}), evidence: o.evidence, transfers: o.transfers.length });
    // Only transfers to an address issued for one of this entity's orders are this entity's facts.
    for (const f of o.transfers) if (toIssued(f.network, f.to)) keep({ kind: "transfer", f: o.status === "reorged" ? { ...f, finalised: false } : f });
    if (o.status === "ok") for (const f of o.nonMatching) if (toIssued(f.network, f.to)) keep({ kind: "lookalike", f });
  }

  // Re-check before finalising: a fact that becomes final now is read again by transaction; the block must not move.
  for (const f of facts.values()) {
    if (f.kind !== "transfer" || !f.f.finalised) continue;
    const prior = storedByKey.get(factKey(f));
    if (prior?.finalised && prior.block === Number(f.f.blockNumber)) continue;
    const again = await client.transfer(f.f.network, f.f.txHash);
    const same = again.status === "ok" && again.transfers.some((x) => x.logIndex === f.f.logIndex && x.blockNumber === f.f.blockNumber
      && (x.blockHash === undefined || f.f.blockHash === undefined || x.blockHash === f.f.blockHash));
    if (!same) {
      f.f = { ...f.f, finalised: false };
      reads.push({ network: f.f.network, txHash: f.f.txHash, status: again.status === "unavailable" ? "unavailable" : "reorged", reason: again.status === "unavailable" ? again.reason : "the transaction's block changed on the re-check before finalising (reorg)", evidence: again.evidence, transfers: 0 });
    }
  }

  const required = (n: string) => NETWORKS.find((x) => x.network === n)?.confirmationsRequired ?? Number.MAX_SAFE_INTEGER;
  const counts = { facts: 0, final: 0, pending: 0 };
  await withTenant(tenant, async (tx) => {
    const netRows = await tx.select().from(t.networkConfig);
    const requiredOf = (n: string) => netRows.find((x) => dbNetwork(x.network) === n)?.confirmationsRequired ?? required(n);
    const rows: (typeof t.chainTransfers.$inferInsert)[] = [];
    for (const f of [...facts.values()].sort((a, b) => (factKey(a) < factKey(b) ? -1 : 1))) {
      const ev = f.f.evidence[0] ?? { source: "recording", host: "unknown", method: "unknown", fetchedAt: now.toISOString() };
      const evidence = { evidenceSource: ev.source, evidenceHost: ev.host, evidenceEndpoint: ev.method, fetchedAt: new Date(ev.fetchedAt) };
      let row: typeof t.chainTransfers.$inferInsert;
      if (f.kind === "transfer") {
        const x = f.f;
        // finality per network_config: the stored rule wins over the reader's default
        const finalised = x.finalised && x.confirmations >= BigInt(requiredOf(x.network));
        row = {
          orgId: ctx.orgId, network: x.network, txHash: x.txHash, logIndex: x.logIndex, tokenContract: x.tokenContract, fromAddress: x.from, toAddress: x.to,
          amountBaseUnits: x.amountBaseUnits.toString(), decimals: x.decimals, block: Number(x.blockNumber), blockTime: new Date(x.timestamp),
          confirmations: Number(x.confirmations > 2_000_000_000n ? 2_000_000_000n : x.confirmations), finalised, source: "chain_client", entityId,
          claimedSymbol: x.symbol, blockHash: x.blockHash ?? ev.blockHash ?? null, ...evidence,
        };
        counts[finalised ? "final" : "pending"]++;
      } else {
        const x = f.f;
        if (!x.rawAmount || x.rawAmount <= 0n || !x.from || !x.to) continue;
        row = {
          orgId: ctx.orgId, network: x.network, txHash: x.txHash, logIndex: x.logIndex ?? 0, tokenContract: x.contract, fromAddress: x.from, toAddress: x.to,
          // [ASSUMPTION] a look-alike listing carries no decimals or block time: the claimed decimals (or 0) and the read time are recorded
          amountBaseUnits: x.rawAmount.toString(), decimals: x.claimedDecimals ?? 0, block: Number(ev.blockNumber ?? 0n), blockTime: new Date(ev.fetchedAt),
          confirmations: 0, finalised: false, source: "chain_client", entityId, claimedSymbol: x.claimedSymbol ?? null, blockHash: ev.blockHash ?? null, ...evidence,
        };
      }
      counts.facts++;
      rows.push(row);
    }
    // rc7 phase 3b: written in chunks (same rows, same order); facts stay as first read (trigger 0007); only
    // confirmations, finality, block and evidence of the latest read change
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(t.chainTransfers).values(rows.slice(i, i + 500)).onConflictDoUpdate({
        target: [t.chainTransfers.orgId, t.chainTransfers.network, t.chainTransfers.txHash, t.chainTransfers.logIndex, t.chainTransfers.source],
        set: { confirmations: sql`excluded.confirmations`, finalised: sql`excluded.finalised`, block: sql`excluded.block`, blockHash: sql`excluded.block_hash`,
          evidenceSource: sql`excluded.evidence_source`, evidenceHost: sql`excluded.evidence_host`, evidenceEndpoint: sql`excluded.evidence_endpoint`, fetchedAt: sql`excluded.fetched_at` },
      });
    }
    const readRows = reads.map((r) => ({
      orgId: ctx.orgId, entityId, network: r.network, address: r.address ?? null, txHash: r.txHash ?? null, status: r.status, reason: r.reason?.slice(0, 500) ?? null,
      source: r.evidence[0]?.source ?? client.mode, host: r.evidence[0]?.host ?? null, endpoint: r.evidence[0]?.method ?? null, transfers: r.transfers, at: now,
    }));
    for (let i = 0; i < readRows.length; i += 1000) await tx.insert(t.chainReads).values(readRows.slice(i, i + 1000));
    const unavailable = reads.filter((r) => r.status === "unavailable").length;
    await serverAudit(tx, ctx, "merchant_chain_verified", "merchant_entity", entityId,
      `Chain verified (${client.mode}): ${addresses.length} address(es), ${readTx.size} transaction(s) read, ${cached} cached final; ${counts.facts} fact(s), ${counts.final} final, ${counts.pending} not final; ${unavailable} read(s) unavailable`,
      { mode: client.mode, addresses: addresses.length, transactions: readTx.size, cached, ...counts, unavailable });
  });
  return { entityId, mode: client.mode, addresses: addresses.length, transactions: readTx.size, cached, ...counts, unavailable: reads.filter((r) => r.status === "unavailable").length };
}

/** Whether the organisation holds live (uploaded) data: only then does reconciliation verify against the chain. */
export async function isLiveOrg(ctx: TenantContext): Promise<boolean> {
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const [o] = await tx.select({ dataMode: t.organizations.dataMode }).from(t.organizations).where(eq(t.organizations.id, ctx.orgId));
    return o?.dataMode === "live";
  }, { read: true });
}
