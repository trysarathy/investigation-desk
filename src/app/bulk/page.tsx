import { BulkRunner } from "@/components/BulkRunner";
import { liveKeysPresent } from "@/lib/chain/live";
import { loadWorkspace } from "@/lib/workspace/live";

// Reads the uploaded files and server keys on every request; never pre-render it at build time.
export const dynamic = "force-dynamic";

export default async function BulkPage() {
  const { missing } = await loadWorkspace();
  const blocked = !liveKeysPresent()
    ? "Bulk runs need TRONGRID_API_KEY and ETHERSCAN_API_KEY on the server."
    : missing.length
      ? `Upload ${missing.map((m) => `File ${m}`).join(" and ")} in Settings → Data first.`
      : undefined;
  return (
    <div className="page">
      <h1>Bulk investigation</h1>
      <BulkRunner blocked={blocked} />
    </div>
  );
}
