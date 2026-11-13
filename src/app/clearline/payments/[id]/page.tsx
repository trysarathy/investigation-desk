import type { Metadata } from "next";
import Investigation from "@/components/clearline/pages/Investigation";
export const metadata: Metadata = { title: "Payment investigation" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Investigation id={decodeURIComponent(id)} />;
}
