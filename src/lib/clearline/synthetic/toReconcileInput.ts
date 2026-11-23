/**
 * Direct (non-file) conversion of a synthetic world into the engine's ReconcileInput, one per entity, so the engine
 * can run on synthetic data before the upload / mapping layer exists. Transfers that belong to no order are given to
 * the entity whose chain feed saw them (TransferMeta.entityId).
 */
import { TEST_MODE_LABEL, type ReconcileInput } from "../merchant/types";
import { toEnginePolicy, type SyntheticPolicy } from "./policy";
import { transferKey, type SyntheticWorld } from "./world";

export function toReconcileInput(world: SyntheticWorld, entityId: string, policy: SyntheticPolicy = world.policy): ReconcileInput {
  const spec = world.entitySpecs.find((e) => e.id === entityId);
  const entity = world.entities.find((e) => e.id === entityId);
  if (!spec || !entity) throw new RangeError(`unknown entity ${entityId}`);
  const orderIds = new Set(world.orders.filter((o) => o.entityId === entityId).map((o) => o.orderId));
  const pids = new Set(world.paymentMeta.filter((m) => m.entityId === entityId).map((m) => m.providerPaymentId));
  const transferKeys = new Set(world.transferMeta.filter((m) => m.entityId === entityId).map((m) => m.key));
  const batchIds = new Set(world.batches.filter((b) => b.targetBankAccount === spec.bankAccountId).map((b) => b.batchId));
  return {
    label: TEST_MODE_LABEL,
    entity,
    policy: toEnginePolicy(policy, entity.functionalCurrency),
    networks: world.networks,
    tokens: world.tokens,
    invoices: world.orders.filter((o) => orderIds.has(o.orderId)).map((o) => o.invoice),
    quotes: world.quotes.filter((q) => orderIds.has(q.orderId)),
    paymentLinks: world.paymentLinks.filter((l) => orderIds.has(l.orderId)),
    transfers: world.transfers.filter((t) => transferKeys.has(transferKey(t))),
    providerRecords: world.providerRecords.filter((r) => pids.has(r.providerPaymentId)),
    batches: world.batches.filter((b) => batchIds.has(b.batchId)),
    batchLines: world.batchLines.filter((l) => batchIds.has(l.batchId)),
    bankLines: world.bankLines.filter((l) => l.account === spec.bankAccountId),
    fxRates: world.fxRates.filter((r) => r.pair.endsWith(`/${entity.functionalCurrency}`)),
    addressFacts: world.addressFacts,
  };
}

/** Every entity's input, in entity order. */
export function toReconcileInputs(world: SyntheticWorld, policy: SyntheticPolicy = world.policy): ReconcileInput[] {
  return world.entitySpecs.map((e) => toReconcileInput(world, e.id, policy));
}
