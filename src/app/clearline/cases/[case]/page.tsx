import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CaseView from "@/components/clearline/cases/CaseView";
import { CASE_SHORT, isCaseSlug } from "@/lib/clearline/merchant-cases/slugs";

/**
 * Rendered on the server from the pure engine at request time: no database, no sign-in. Dynamic (not prerendered)
 * so that the per-request CSP nonce reaches the console's scripts, like every other console page.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ case: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { case: slug } = await params;
  return isCaseSlug(slug) ? { title: CASE_SHORT[slug], description: "A fictional merchant-reconciliation walkthrough. Test mode · illustrative data." } : {};
}

export default async function Page({ params }: Props) {
  const { case: slug } = await params;
  if (!isCaseSlug(slug)) notFound();
  return <CaseView slug={slug} />;
}
