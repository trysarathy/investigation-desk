import { documents, type CaseRecord } from "@/lib/platform/store";
import { valueReport } from "@/lib/platform/value";
export const dynamic = "force-dynamic";
export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; baseline?: string }>;
}) {
  const q = await searchParams;
  const month =
    q.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month)
      ? q.month
      : new Date().toISOString().slice(0, 7);
  const baseline = Math.min(120, Math.max(1, Number(q.baseline) || 15)),
    r = valueReport(documents<CaseRecord>("case"), month, baseline);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Proof of value</span>
          <h1 className="display-title">Outcomes you can account for.</h1>
          <p className="muted">
            {month} · excludes fictional and synthetic cases
          </p>
        </div>
        <span className="badge">Monthly workspace report</span>
      </div>
      <form className="panel padded form-row">
        <label>
          Month{" "}
          <input
            className="input"
            type="month"
            name="month"
            defaultValue={month}
          />
        </label>
        <label>
          Baseline minutes per case{" "}
          <input
            className="input"
            type="number"
            name="baseline"
            min="1"
            max="120"
            defaultValue={baseline}
          />
        </label>
        <button className="btn">Update estimate</button>
      </form>
      <div className="metric-grid">
        <div className="metric">
          <span>Cases handled</span>
          <strong>{r.cases}</strong>
          <small>{r.resolved} marked resolved</small>
        </div>
        <div className="metric">
          <span>Median time to resolve</span>
          <strong>
            {r.medianMinutes === null ? "—" : r.medianMinutes.toFixed(1) + "m"}
          </strong>
          <small>Case creation to resolution</small>
        </div>
        <div className="metric">
          <span>Auto-diagnosed</span>
          <strong>
            {r.autoDiagnosed === null
              ? "—"
              : (r.autoDiagnosed * 100).toFixed(1) + "%"}
          </strong>
          <small>High confidence, not proof of accuracy</small>
        </div>
        <div className="metric">
          <span>Estimated hours saved</span>
          <strong>
            {r.estimatedHoursSaved === null
              ? "—"
              : r.estimatedHoursSaved.toFixed(1)}
          </strong>
          <small>Estimate, not measured staff time</small>
        </div>
      </div>
      <section className="panel padded">
        <h2>The formula is part of the report.</h2>
        <p className="mono">
          Σ max(0, baseline minutes − case elapsed minutes) / 60
        </p>
        <p className="muted">
          Baseline: {baseline} minutes, supplied assumption. Only resolved cases
          enter this estimate. Wall-clock elapsed time includes waiting and is
          not active handling time. Validate against a measured before-and-after
          sample before using this in an ROI claim.
        </p>
        <p className="muted">
          Monthly cohort uses case creation date. Rechecks do not count as new
          cases. No savings are claimed for unreviewed demo cases.
        </p>
      </section>
    </div>
  );
}
