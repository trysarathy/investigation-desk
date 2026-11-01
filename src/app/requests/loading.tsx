export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading requests">
      <div className="skel" style={{ width: 240, height: 32 }} />
      <div className="panel">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 16, padding: 12, borderBottom: "1px solid var(--border)" }}>
            {Array.from({ length: 3 }, (_, j) => <div key={j} className="skel" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
