import type { ReconcileInput } from "../merchant/types";

/** The rows of one ingestion (the same shape as src/server/merchant-store.ts IngestParts). */
export type IngestPartsLike = { -readonly [K in "invoices" | "quotes" | "paymentLinks" | "providerRecords" | "batches" | "batchLines" | "bankLines" | "fxRates" | "addressFacts"]?: ReconcileInput[K][number][] };
