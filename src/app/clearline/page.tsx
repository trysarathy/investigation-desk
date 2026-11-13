import type { Metadata } from "next";
import Overview from "@/components/clearline/pages/Overview";
export const metadata: Metadata = { title: "Overview", description: "A fictional, test-mode preview of Clearline Connect and Control. No real payment execution." };
export default function Page() { return <Overview />; }
