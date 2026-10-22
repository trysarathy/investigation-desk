export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading cases">
      <div className="skel" style={{ width: 280, height: 32 }} />
      <div className="panel">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 90px 80px 1fr 80px 50px", gap: 16, padding: "12px", borderBottom: "1px solid var(--border)" }}>
            {Array.from({ length: 6 }, (_, j) => <div key={j} className="skel" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
