import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <h1>Case not found</h1>
      <p className="muted" style={{ margin: 0 }}>There is no case with that ID in this workspace.</p>
      <div><Link className="btn" href="/">Back to the queue</Link></div>
    </div>
  );
}
