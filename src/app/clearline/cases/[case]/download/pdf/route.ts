/** rc6 public cases demo: the one-page PDF summary (Test mode · illustrative data). Built once from the engine at build time. */
import { casePdf, pdfFileName } from "@/lib/clearline/merchant-cases/pdf";
import { CASE_SLUGS, isCaseSlug } from "@/lib/clearline/merchant-cases/slugs";

export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = () => CASE_SLUGS.map((c) => ({ case: c }));

export async function GET(_req: Request, { params }: { params: Promise<{ case: string }> }) {
  const { case: slug } = await params;
  if (!isCaseSlug(slug)) return new Response("Not found", { status: 404 });
  const bytes = await casePdf(slug);
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdfFileName(slug)}"`, "X-Clearline-Label": "Test mode - illustrative data" },
  });
}
