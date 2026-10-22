import { BulkRunner } from "@/components/BulkRunner";
import { liveKeysPresent } from "@/lib/chain/live";
import { loadWorkspace } from "@/lib/workspace/live";

// Reads the uploaded files and server keys on every request; never pre-render it at build time.
export const dynamic = "force-dynamic";

export default async function BulkPage() {
  const { missing, data } = await loadWorkspace();
  const blocked = missing.length
    ? `Upload ${missing.map((m) => `File ${m}`).join(" and ")} in Settings → Data first, or load the demo workspace there.`
    : !liveKeysPresent() && !data.demo
      ? "Bulk runs need TRONGRID_API_KEY and ETHERSCAN_API_KEY on the server."
      : undefined;
  return (
    <div className="page">
      <h1>Bulk investigation</h1>
      {data.demo && (
        <p className="muted" style={{ margin: 0 }}>
          Demo workspace. <a href="/api/demo/bulk.csv">Download the demo bulk file</a> and run it here.
        </p>
      )}
      <BulkRunner blocked={blocked} />
    </div>
  );
}
