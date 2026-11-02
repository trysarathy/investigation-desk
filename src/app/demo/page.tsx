import { redirect, notFound } from "next/navigation";
import { demoSlicesOn } from "@/lib/demo-slices/gate";

export const dynamic = "force-dynamic";

export default function DemoIndex() {
  if (!demoSlicesOn()) notFound();
  redirect("/demo/release");
}
