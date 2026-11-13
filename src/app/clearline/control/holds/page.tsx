import type { Metadata } from "next";
import Holds from "@/components/clearline/pages/Holds";
export const metadata: Metadata = { title: "Compliance holds" };
export default function Page() { return <Holds />; }
