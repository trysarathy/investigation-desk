import type { Metadata } from "next";
import { ProviderActivity } from "@/components/clearline/pages/ConnectMisc";
export const metadata: Metadata = { title: "Provider activity" };
export default function Page() { return <ProviderActivity />; }
