import type { Metadata } from "next";
import AccountingSetup from "@/components/clearline/pages/AccountingSetup";
export const metadata: Metadata = { title: "Accounting — periods and mapping" };
export default function Page() { return <AccountingSetup />; }
