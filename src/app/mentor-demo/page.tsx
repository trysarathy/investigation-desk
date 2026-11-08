import type { Metadata } from "next";
import MentorDemo from "@/components/mentor-demo/MentorDemo";
export const metadata: Metadata = {
  title: "Clearline Funding Desk | Interactive mentor demo",
  description: "Explore a synthetic advance review, treasury approval, supplier payout and repayment exception lifecycle.",
};
export default function MentorDemoPage() {
  return <MentorDemo />;
}
