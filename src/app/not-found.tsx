import Link from "next/link";
import { isDemoMode } from "@/lib/mode";

// Shown for any page or record that doesn't exist. Worded for both modes: in demo mode the likely
// cause is that "Reload demo day" removed a request made during the demo.
export default function NotFound() {
  const demo = isDemoMode();
  return (
    <div className="page" data-testid="not-found">
      <h1>Not found</h1>
      <p className="muted" style={{ margin: 0 }}>
        {demo
          ? "There's nothing at this address. Requests made during the demo are removed when the demo day is reloaded."
          : "There's nothing at this address. Check the link, or find the record from the list."}
      </p>
      <div><Link className="btn" href={demo ? "/requests" : "/"}>{demo ? "Back to At a glance" : "Back to the queue"}</Link></div>
    </div>
  );
}
