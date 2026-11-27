import { SIGNATURE_HEADER, WEBHOOK_MAX_BYTES } from "@/lib/clearline/provider-api";
import { receiveProviderWebhook } from "@/server/provider-api";
import { clientIp } from "@/server/client-ip";
import { count, underLimit } from "@/server/rate-limit";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

const refused = () => json(400, { error: "Refused." });

/** Read at most `max` bytes of the body; null when it is larger (the stream is cancelled, never buffered past it). */
async function boundedBody(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > max) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

/**
 * A provider's webhook delivery for one connection: no session, no cookie; the delivery proves itself with its HMAC
 * signature (src/lib/clearline/provider-api/webhook.ts). Every refusal gets the same answer. Refusals are counted per
 * client address (src/server/rate-limit.ts); past the limit nothing is checked or recorded.
 */
export async function POST(req: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const ip = clientIp(req.headers);
    if (!(await underLimit("provider_webhook_ip", ip))) return json(429, { error: "Refused." });
    const body = await boundedBody(req, WEBHOOK_MAX_BYTES);
    const answer = body === null ? null : await receiveProviderWebhook((await params).connectionId, { signature: req.headers.get(SIGNATURE_HEADER), body });
    if (!answer || answer.status !== 200) { await count("provider_webhook_ip", ip); return refused(); }
    return json(answer.status, answer.body);
  } catch (e) {
    console.error("clearline-control: provider webhook error", e instanceof Error ? e.name : typeof e);
    return json(500, { error: "Refused." });
  }
}
