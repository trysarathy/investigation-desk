/** Render a synthetic world into every file shape. Each name carries the synthetic label. */
import { blindProviderExport } from "./blind";
import { SYNTHETIC_LABEL } from "./fictional";
import type { SyntheticWorld } from "./world";
import { bankStatementCamt053, bankStatementCsv, bankStatementMt940 } from "./writers/bank";
import { chainTransfersJson, fxRatesCsv, orderListCsv, orderListXlsx } from "./writers/orders";
import { providerExportA, providerExportB, providerExportC, providerSettlementTotalsC } from "./writers/provider";
import { settlementLinesCsv, settlementTotalsJson } from "./writers/settlement";

export type SyntheticFileKind =
  | "provider_export_a" | "provider_export_b" | "provider_export_c" | "provider_settlement_totals_c" | "provider_export_blind"
  | "settlement_lines" | "settlement_totals" | "bank_csv" | "bank_mt940" | "bank_camt053" | "order_list_csv" | "order_list_xlsx"
  | "chain_transfers" | "fx_rates";

export interface SyntheticFile { name: string; kind: SyntheticFileKind; mediaType: string; bytes: Uint8Array; entityId?: string; account?: string }

const CSV = "text/csv", JSON_T = "application/json", XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const fileName = (month: string, base: string, ext: string): string => `${month} ${base} (${SYNTHETIC_LABEL}).${ext}`;

export async function renderFiles(world: SyntheticWorld): Promise<SyntheticFile[]> {
  const m = world.month;
  const files: SyntheticFile[] = [];
  for (const e of world.entitySpecs)
    files.push({ name: fileName(m, `provider-A export ${e.currency}`, "csv"), kind: "provider_export_a", mediaType: CSV, bytes: providerExportA(world, e.id), entityId: e.id });
  files.push({ name: fileName(m, "provider-B export", "xlsx"), kind: "provider_export_b", mediaType: XLSX, bytes: await providerExportB(world) });
  files.push({ name: fileName(m, "provider-C export", "json"), kind: "provider_export_c", mediaType: JSON_T, bytes: providerExportC(world) });
  files.push({ name: fileName(m, "provider-C settlement totals", "json"), kind: "provider_settlement_totals_c", mediaType: JSON_T, bytes: providerSettlementTotalsC(world) });
  files.push({ name: fileName(m, "provider-D export", "json"), kind: "provider_export_blind", mediaType: JSON_T, bytes: blindProviderExport(world) });
  files.push({ name: fileName(m, "settlement report lines", "csv"), kind: "settlement_lines", mediaType: CSV, bytes: settlementLinesCsv(world) });
  files.push({ name: fileName(m, "settlement report totals", "json"), kind: "settlement_totals", mediaType: JSON_T, bytes: settlementTotalsJson(world) });
  for (const a of world.bankAccounts) {
    files.push({ name: fileName(m, `bank statement ${a.accountId}`, "csv"), kind: "bank_csv", mediaType: CSV, bytes: bankStatementCsv(world, a.accountId), account: a.accountId });
    files.push({ name: fileName(m, `bank statement ${a.accountId} MT940`, "sta"), kind: "bank_mt940", mediaType: "text/plain", bytes: bankStatementMt940(world, a.accountId), account: a.accountId });
    files.push({ name: fileName(m, `bank statement ${a.accountId} camt.053`, "xml"), kind: "bank_camt053", mediaType: "application/xml", bytes: bankStatementCamt053(world, a.accountId), account: a.accountId });
  }
  files.push({ name: fileName(m, "orders", "csv"), kind: "order_list_csv", mediaType: CSV, bytes: orderListCsv(world) });
  files.push({ name: fileName(m, "orders", "xlsx"), kind: "order_list_xlsx", mediaType: XLSX, bytes: await orderListXlsx(world) });
  files.push({ name: fileName(m, "chain transfers", "json"), kind: "chain_transfers", mediaType: JSON_T, bytes: chainTransfersJson(world) });
  files.push({ name: fileName(m, "fx rates", "csv"), kind: "fx_rates", mediaType: CSV, bytes: fxRatesCsv(world) });
  return files;
}
