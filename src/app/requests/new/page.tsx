import Link from "next/link";
import { NewRequestForm } from "@/components/requests/NewRequestForm";

// Rendered per request like every other page: the layout reads the workspace label at request time.
export const dynamic = "force-dynamic";

export default function NewRequestPage() {
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <h1>New payment request</h1>
        <Link className="btn" href="/requests">Back</Link>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        You get a payment link for the sender and a request in your inbox. Nothing is sent to anyone: you share the link yourself.
      </p>
      <NewRequestForm />
    </div>
  );
}
