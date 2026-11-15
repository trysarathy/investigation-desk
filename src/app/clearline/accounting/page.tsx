import type { Metadata } from "next";
import Accounting from "@/components/clearline/pages/Accounting";
export const metadata: Metadata = { title: "Accounting — proposed entries" };
export default function Page() { return <Accounting />; }
