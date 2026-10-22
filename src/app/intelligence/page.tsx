import { Intelligence } from "@/components/Intelligence";
import { intelligence } from "@/lib/intelligence/service";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Intelligence initial={intelligence()} />;
}
