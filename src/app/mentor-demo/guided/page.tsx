import type { Metadata } from "next";
import GuidedAdvance from "@/components/mentor-demo/GuidedAdvance";

export const metadata: Metadata = {
  title: "Clearline | Explore a fictional advance",
  description: "A guided, browser-only fictional funding case: review, named treasury decision, supplier payout, partial repayment, overdue exception and evidence export.",
};

export default function GuidedAdvancePage() {
  return <GuidedAdvance />;
}
