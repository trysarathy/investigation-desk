export default function BulkPage() {
  return (
    <div className="page">
      <h1>Bulk investigation</h1>
      <section className="panel" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0 }}>Upload a CSV with columns <span className="mono">tx_hash</span>, <span className="mono">chain</span> (optional) and <span className="mono">customer_id</span> (optional), up to 1,000 rows.</p>
        <p className="muted" style={{ margin: 0 }}>Not built yet. Bulk runs arrive in build week 4 with CSV validation and the ledger join.</p>
      </section>
    </div>
  );
}
