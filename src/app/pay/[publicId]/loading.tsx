// The sender's page loads with a plain placeholder card, never the operator app's table skeleton.
export default function Loading() {
  return <main className="pay"><div className="pay-card" style={{ height: 420 }} aria-busy="true" aria-label="Loading payment request" /></main>;
}
