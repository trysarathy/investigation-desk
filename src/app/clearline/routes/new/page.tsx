import type { Metadata } from "next";
import Connect from "@/components/clearline/pages/Connect";
export const metadata: Metadata = { title: "New payment intent" };
export default function Page() { return <Connect />; }
