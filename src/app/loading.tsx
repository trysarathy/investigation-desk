// Shown while a page renders on the server (usually well under a second). Plain bars that fit any
// width: the earlier queue-table skeleton was 490px wide and pushed phone screens sideways.
export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ width: "min(280px, 70%)", height: 32 }} />
      <div className="panel">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 3fr) minmax(0, 1fr)", gap: 16, padding: "12px", borderBottom: "1px solid var(--border)" }}>
            {Array.from({ length: 3 }, (_, j) => <div key={j} className="skel" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
