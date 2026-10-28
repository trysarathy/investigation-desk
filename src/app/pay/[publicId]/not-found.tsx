// The customer-facing payment page for a link that doesn't exist. No operator links: the person
// reading this is the business's customer.
export default function PayLinkNotFound() {
  return (
    <div className="page" style={{ maxWidth: 520, margin: "48px auto", padding: "0 16px" }} data-testid="not-found">
      <h1>This payment link isn&apos;t valid</h1>
      <p className="muted" style={{ margin: 0 }}>
        It may have been mistyped, or the request was withdrawn. Don&apos;t send a payment based on this link: ask the business that sent it for a new one.
      </p>
    </div>
  );
}
