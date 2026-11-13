import type { Metadata } from "next";
import { QuotesRoutes } from "@/components/clearline/pages/ConnectMisc";
export const metadata: Metadata = { title: "Routes and quotes" };
export default function Page() { return <QuotesRoutes />; }
