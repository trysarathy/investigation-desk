import type { Metadata } from "next";
import CasesIndex from "@/components/clearline/cases/CasesIndex";

/** Server-rendered per request so the CSP nonce reaches the console scripts (see [case]/page.tsx). */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Merchant reconciliation cases", description: "Three fictional merchant-reconciliation cases, rendered from the Clearline engine. Test mode · illustrative data." };
export default function Page() { return <CasesIndex />; }
