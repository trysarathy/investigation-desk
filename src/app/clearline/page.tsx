import type { Metadata } from "next";
import Console from "@/components/clearline/Console";
export const metadata: Metadata = {
 title:"Clearline — Payment operations, test mode",
 description:"A fictional, test-mode preview of Clearline Connect and Control. No real payment execution.",
};
export default function ClearlinePage(){return <Console/>;}
