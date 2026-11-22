/** rc6 public cases demo: the case CSV (Test mode · illustrative data). Built once from the engine at build time. */
import { caseCsv, csvFileName } from "@/lib/clearline/merchant-cases/csv";
import { CASE_SLUGS, isCaseSlug } from "@/lib/clearline/merchant-cases/slugs";

export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = () => CASE_SLUGS.map((c) => ({ case: c }));

export async function GET(_req: Request, { params }: { params: Promise<{ case: string }> }) {
  const { case: slug } = await params;
  if (!isCaseSlug(slug)) return new Response("Not found", { status: 404 });
  return new Response(caseCsv(slug), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${csvFileName(slug)}"`, "X-Clearline-Label": "Test mode - illustrative data" },
  });
}
