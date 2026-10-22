import { notFound } from "next/navigation";
import { Investigation } from "@/components/Investigation";
import { findCase } from "@/lib/fixtures";
import { caseView, parseDown } from "@/lib/view";

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const c = findCase(id);
  if (!c) notFound();
  const view = await caseView(c, parseDown(sp.down));
  return <Investigation key={view.id} view={view} />;
}
