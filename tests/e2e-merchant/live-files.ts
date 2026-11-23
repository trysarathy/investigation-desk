/**
 * Upload files for the rc7 upload journeys, all from the synthetic generator's small preset (fictional).
 *
 * The provider export is shape A (UTF-8 with BOM, comma, DD/MM/YYYY HH:mm SGT, thousand separators, a trailing TOTAL
 * row) with the quote columns that shape A leaves out appended (tests/fixtures/synthetic/quote-export.ts), so the
 * journey can show decisions on full quote terms; plain shapes A, B and C are covered by tests/control/pipeline-truth.
 * The decisions the journey expects are derived from the generator's ground truth (truth-expect.ts), never pinned.
 */
import { smallPreset, type SyntheticFile } from "../../src/lib/clearline/synthetic";
import { providerExportWithQuotes } from "../fixtures/synthetic/quote-export";
import { expectationsFor } from "../fixtures/synthetic/truth-expect";

export async function uploadFiles() {
  const { world, files, truth } = await smallPreset();
  const pick = (kind: SyntheticFile["kind"], account?: string) => files.find((f) => f.kind === kind && (!account || f.account === account))!;
  const sg = world.entitySpecs[0], us = world.entitySpecs[1];
  return {
    world, truth,
    providerSg: providerExportWithQuotes(world, sg.id),
    settlementTotals: pick("settlement_totals"),
    bankCsvSg: pick("bank_csv", sg.bankAccountId),
    bankCsvUs: pick("bank_csv", us.bankAccountId),
    mt940Us: pick("bank_mt940", us.bankAccountId),
    /** What reconciling ENT-SG-SYN from these files must decide per order (totals-only settlement; the imported-line flag off). */
    expectedSg: expectationsFor(world, truth, { provider: "Aq", settlement: "totals", importedLinesVerify: false }, sg.id),
  };
}
