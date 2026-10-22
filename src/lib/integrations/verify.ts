import { createHmac, timingSafeEqual } from "node:crypto";
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function verifySlack(
  body: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  now = Date.now(),
) {
  if (
    !secret ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !signature ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  return equalSecret(
    signature,
    "v0=" +
      createHmac("sha256", secret)
        .update(`v0:${timestamp}:${body}`)
        .digest("hex"),
  );
}
