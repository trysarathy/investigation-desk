import { documents, type CaseRecord } from "@/lib/platform/store";
import { ALL_CHAINS } from "@/lib/types";
export async function GET() {
  const cases = documents<CaseRecord>("case").filter(
    (c) => c.provenance !== "synthetic",
  );
  return Response.json(
    {
      status: "running",
      deployment: "single-workspace",
      providers: ALL_CHAINS.map((chain) => {
        const last = cases
          .flatMap((c) => c.facts.lookups)
          .filter((l) => l.chain === chain)
          .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
        return {
          chain,
          status: last
            ? last.result === "error"
              ? "last lookup failed"
              : "last lookup answered"
            : "not observed",
          checkedAt: last?.fetchedAt ?? null,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
