import { notFound } from "next/navigation";
import FundingDesk from "@/components/funding/FundingDesk";
export const dynamic = "force-dynamic";
export default function FundingPage() {
  if (process.env.CLEARLINE_FUNDING_ONLY !== "1") notFound();
  return <FundingDesk />;
}
