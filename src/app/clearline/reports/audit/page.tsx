import type { Metadata } from "next";
import AuditHistory from "@/components/clearline/pages/AuditHistory";
export const metadata: Metadata = { title: "Audit history" };
export default function Page() { return <AuditHistory />; }
