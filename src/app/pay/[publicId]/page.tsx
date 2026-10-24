import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { AutoRefresh } from "@/components/requests/AutoRefresh";
import { CopyButton } from "@/components/requests/Copy";
import { CONFIRMATIONS } from "@/lib/requests/check";
import { DEMO_BUSINESS } from "@/lib/requests/demo";
import { amountToSend, deriveRequest, formatUsdc } from "@/lib/requests/lifecycle";
import { eip681, senderStatus } from "@/lib/requests/present";
import { requestsStore } from "@/lib/requests/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment request", robots: { index: false } };

const TRACK = ["Waiting", "Seen", "Confirming", "Received", "Paid"];

/** 0x + groups of four, so a sender can check it piece by piece. The first and last groups stand out. */
function Address({ value }: { value: string }) {
  const body = value.slice(2).match(/.{1,4}/g) ?? [];
  return (
    <div className="addr" aria-label={value}>
      <span className="end">0x{body[0]}</span>{" "}{body.slice(1, -1).join(" ")}{" "}<span className="end">{body.at(-1)}</span>
    </div>
  );
}

export default async function PayPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const data = await requestsStore().load();
  const r = Object.values(data.requests).find((x) => x.publicId === publicId);
  if (!r) notFound();
  const v = deriveRequest(data, r, CONFIRMATIONS);
  const s = senderStatus(v);
  // Progress shows only what really happened: in review, the furthest a counted transfer got.
  const inBlock = v.counted.some((o) => o.blockNumber !== undefined);
  const reviewStep = v.received !== "0" ? 3 : inBlock ? 2 : v.counted.length ? 1 : 0;
  const step = { awaiting_payment: v.received !== "0" ? 3 : 0, transfer_detected: 1, confirming: 2, matched: 3, needs_review: reviewStep, completed: 5 }[v.state];
  const attention = v.state === "needs_review" || (v.state === "awaiting_payment" && v.review === "short");
  // What is still due, counting transfers already confirmed or confirming. Nothing due: no
  // instructions and no QR, so nobody is invited to pay twice. The QR always asks for the same.
  const toSend = amountToSend(v);
  const due = toSend !== "0" && v.state !== "completed";
  const uri = eip681(r, due ? toSend : r.amount);
  const qr = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#17181c", light: "#ffffff" } });
  const business = r.demo ? DEMO_BUSINESS.replace(/\.$/, "") : "the business";

  return (
    <main className="pay">
      {v.state !== "completed" && <AutoRefresh ms={4000} />}
      {r.demo && <span className="demo-flag" title="This page belongs to a demo. The business, address and any transfers shown are synthetic.">Demo · synthetic business data · no real payment</span>}
      <article className="pay-card" aria-labelledby="pay-amount">
        <header className="pay-top">
          <div className="pay-for">{r.invoiceRef} · payment to {business}</div>
          <div className="pay-amount" id="pay-amount">{formatUsdc(r.amount)}<small>USDC</small></div>
          <div className="pay-net"><span className="badge">Token: USDC</span><span className="badge">Network: Ethereum</span></div>
        </header>

        <section className="pay-status" aria-live="polite" style={{ borderTop: 0, borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="pay-state">{s.title}</div>
            <div className="muted" style={{ fontSize: 13 }}>{s.detail}</div>
          </div>
          <ol className="track" aria-label="Payment progress">
            {TRACK.map((t, i) => {
              const cls = i < step ? "done" : i === step ? (attention ? "attn" : "now") : "";
              return <li key={t} className={cls} aria-current={i === step ? "step" : undefined}>{t}</li>;
            })}
          </ol>
        </section>

        {due && (
          <>
            <ol className="pay-steps">
              <li>
                <span className="pay-n">1</span>
                <div>
                  <div className="pay-k">Send exactly</div>
                  <div className="pay-v amount">{formatUsdc(toSend)} USDC{toSend !== r.amount ? " (the remaining balance)" : ""}</div>
                </div>
              </li>
              <li>
                <span className="pay-n">2</span>
                <div>
                  <div className="pay-k">Using the Ethereum network</div>
                  <div className="pay-v">USDC on Ethereum</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Circle&apos;s USDC contract: <span className="mono">{r.tokenContract.slice(0, 10)}…{r.tokenContract.slice(-8)}</span>{" "}
                    <CopyButton text={r.tokenContract} label="Copy contract" className="btn btn-sm" />
                  </div>
                </div>
              </li>
              <li>
                <span className="pay-n">3</span>
                <div style={{ minWidth: 0 }}>
                  <div className="pay-k">To this address</div>
                  <Address value={r.receivingAddress} />
                  <div style={{ marginTop: 8 }}><CopyButton text={r.receivingAddress} label="Copy address" /></div>
                </div>
              </li>
            </ol>
            <p className="pay-warn">
              Send only USDC on Ethereum. USDC on another network, or any other token, won&apos;t count as payment for this invoice
              and may not be recoverable. Blockchain transfers can&apos;t be reversed, so check the first and last characters of the
              address after you paste it.
            </p>
            <div className="pay-qr">
              <div dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label="QR code for this payment request" />
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                QR in the standard Ethereum payment-request format (EIP-681). Some wallets don&apos;t read token requests or the amount from it,
                so check the amount, token and network before you confirm.
              </div>
            </div>
          </>
        )}
      </article>
      <p className="pay-foot">
        {r.demo
          ? <>This page shows the simulated transfers in this demo and whether {business} has confirmed them. It updates by itself.</>
          : <>This page shows transfers {business} has recorded for this request, and whether it has confirmed them. It updates by itself once a transfer is recorded.</>}
        {" "}Questions about this payment go to {business}.
      </p>
    </main>
  );
}
