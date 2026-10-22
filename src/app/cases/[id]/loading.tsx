export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading case">
      <div className="skel" style={{ width: 240, height: 20 }} />
      <div className="verdict-bar"><div className="skel" style={{ width: 320, height: 20 }} /></div>
      <div className="cols">
        <div className="panel">{Array.from({ length: 6 }, (_, i) => <div key={i} style={{ padding: 16, borderBottom: "1px solid var(--border)" }}><div className="skel" /></div>)}</div>
        <div className="panel" style={{ padding: 16 }}><div className="skel" style={{ height: 96 }} /></div>
      </div>
    </div>
  );
}
