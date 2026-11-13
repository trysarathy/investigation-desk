import type { Metadata } from "next";
import Payments from "@/components/clearline/pages/Payments";
export const metadata: Metadata = { title: "Payments" };
export default function Page() { return <Payments />; }
