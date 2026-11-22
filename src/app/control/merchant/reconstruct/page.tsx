import type { Metadata } from "next";
import s from "@/components/control/control.module.css";
import { ReconstructionViewer } from "@/components/reconstruct/ReconstructionViewer";

export const metadata: Metadata = { title: "Case reconstruction" };

/**
 * rc6 phase 10, pilot only (every /control path is served only when CLEARLINE_CONTROL_PILOT=1; see src/middleware.ts).
 * Explains the local CLI and shows a report the user opens from their own machine. The page reads no data and posts
 * nothing: the report is parsed in the browser only.
 */
export default function ReconstructPage() {
  return (
    <main className={s.main} id="main">
      <h1 className={s.title}>Case reconstruction</h1>
      <p className={s.lede}>Rebuild one day of a provider&apos;s payments on your own laptop: what Clearline would decide for each item, the bridge for each batch, journal proposals, the fields that could not be mapped and the questions to ask the provider.</p>
      <section aria-labelledby="run-h" className={s.section}>
        <h2 id="run-h" className={s.h}>Run it locally</h2>
        <ol>
          <li>Put the provider&apos;s anonymised files for one day in <code className={s.mono}>reconstruction-data/&lt;provider&gt;/&lt;day&gt;/input/</code> in your checkout (git-ignored) or anywhere outside the repository.</li>
          <li>Run <code className={s.mono}>npx tsx scripts/reconstruct/reconstruct.ts --in reconstruction-data/&lt;provider&gt;/&lt;day&gt;/input --out reconstruction-data/&lt;provider&gt;/&lt;day&gt;/report</code> (add <code className={s.mono}>--mapping &lt;file&gt;</code> for the provider&apos;s column mapping).</li>
          <li>Open <code className={s.mono}>report.html</code>, or choose <code className={s.mono}>report.json</code> below.</li>
          <li>Delete the report when done: <code className={s.mono}>npx tsx scripts/reconstruct/reconstruct.ts --purge &lt;report dir&gt; --yes</code>.</li>
        </ol>
        <p>The tool makes no network call and uses no database. It refuses to run in CI, and refuses data inside the repository unless it is under <code className={s.mono}>reconstruction-data/</code>. To try it, run it on the bundled sample: <code className={s.mono}>--in scripts/reconstruct/sample/case1</code>. See the runbook docs/runbooks/RECONSTRUCTION_DATA_HANDLING.md.</p>
      </section>
      <ReconstructionViewer />
    </main>
  );
}
