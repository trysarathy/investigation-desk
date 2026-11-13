import Link from "next/link";

export default function NotFound() {
  // QA residual R1: the customer preview must never show legacy-app text on a 404.
  if (process.env.CLEARLINE_CUSTOMER_PREVIEW === "1") {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "64px auto", padding: "0 16px" }}>
        <h1>Not found — Clearline</h1>
        <p>This page does not exist in the Clearline test-mode preview.</p>
        <p><Link href="/clearline">Go to the Clearline console</Link></p>
      </main>
    );
  }
  return (
    <div className="page">
      <h1>Case not found</h1>
      <p className="muted" style={{ margin: 0 }}>There is no case with that ID in this workspace.</p>
      <div><Link className="btn" href="/">Back to the queue</Link></div>
    </div>
  );
}
