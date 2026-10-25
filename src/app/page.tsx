import { redirect } from "next/navigation";
import { QueueTable } from "@/components/QueueTable";
import { isDemoMode } from "@/lib/mode";
import { LEDGER_UPLOADED_AT, SAMPLE_SETTINGS } from "@/lib/fixtures";
import { FIXTURE_NOW, formatTime } from "@/lib/format";
import { CHAIN_NAMES } from "@/lib/types";
import { loadCases } from "@/lib/bulk/cases";
import { caseRows, parseDown, storedCaseRows } from "@/lib/view";

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Case queue (spec 5.1). Prototype-only query params show the other states:
 *   ?state=empty   new workspace     ?state=stale   ledger out of date
 *   ?down=tron     chain API down (any chain id)
 */
export default async function QueuePage({ searchParams }: { searchParams: Search }) {
  // Demo mode opens on the payment-requests overview: the queue is hidden, not removed.
  if (isDemoMode()) redirect("/requests");
  const sp = await searchParams;
  const down = parseDown(sp.down);
  const state = typeof sp.state === "string" ? sp.state : undefined;
  const uploadedAt = state === "stale" ? "2026-10-19T08:00:00+08:00" : LEDGER_UPLOADED_AT;
  const stale = Date.parse(FIXTURE_NOW) - Date.parse(uploadedAt) > SAMPLE_SETTINGS.ledgerStaleAfterHours * 3600_000;
  // Live cases from bulk runs first, then the sample cases.
  const rows = state === "empty" ? [] : [...storedCaseRows(await loadCases(), new Date()), ...caseRows(down)];

  return (
    <div className="page">
      {down && (
        <div className="bar bar-red" role="alert">
          <strong>{CHAIN_NAMES[down]} API is not responding.</strong>
          <span>Cases that depend on it show “Check paused”. No verdict is guessed.</span>
        </div>
      )}
      {stale && (
        <div className="bar bar-amber" role="status">
          Ledger last uploaded {formatTime(uploadedAt)}. Verdicts that depend on it may be out of date.
        </div>
      )}
      <QueueTable rows={rows} empty={state === "empty"} />
    </div>
  );
}
