/**
 * The client's network address, for per-address rate limits — derived ONLY from configuration the operator controls,
 * never from a header the client chooses. Pure (no I/O); src/server/auth-route.ts calls it once per request.
 *
 * Next.js route handlers do not expose the TCP peer, and `next start` only fills X-Forwarded-For when the request
 * has none (so with no proxy in front, a client can write any X-Forwarded-For it likes). Therefore:
 *
 * - Nothing configured (the default): the address is UNKNOWN and per-address limits are off. Per-account limits still
 *   apply. A spoofable header is never used.
 * - CLEARLINE_CLIENT_IP_HEADER=<name>: a single-value header that the deployment's proxy OVERWRITES on every request
 *   (for example X-Real-IP set by nginx). A value with a comma, or not an IP address, is unknown.
 * - CLEARLINE_TRUSTED_PROXY_HOPS=<1..5>: the number of proxies in front of the app, each APPENDING to
 *   X-Forwarded-For. The client is the entry that many places from the right (the address the outermost proxy saw);
 *   anything to its left was written by the client and is ignored. Fewer entries than hops = unknown.
 * - CLEARLINE_TRUSTED_PROXIES=<comma-separated IPs/CIDRs>: walk X-Forwarded-For from the right, skipping trusted
 *   proxies; the first untrusted entry is the client. All trusted, or a malformed entry, = unknown.
 *
 * The last two are safe only when the app's port is reachable from the proxy alone (DEPLOYMENT note in
 * docs/security/LOGIN_SECURITY_V1.md). If both are set, CLEARLINE_TRUSTED_PROXIES wins (it is the stricter check).
 * IPv6 addresses are bucketed by /64 (one customer line usually holds a whole /64).
 */
import { isIP } from "node:net";

export type IpEnv = Readonly<Record<string, string | undefined>>;

export function clientIp(headers: Headers, env: IpEnv = process.env): string | null {
  const single = env.CLEARLINE_CLIENT_IP_HEADER?.trim();
  if (single) {
    const v = headers.get(single);
    if (!v || v.includes(",")) return null;
    return normalise(v.trim());
  }
  const xff = headers.get("x-forwarded-for");
  const proxies = parseProxyList(env.CLEARLINE_TRUSTED_PROXIES);
  if (proxies === "invalid") return null;
  if (proxies.length > 0) {
    if (!xff) return null;
    const hops = xff.split(",").map((x) => x.trim());
    for (let i = hops.length - 1; i >= 0; i--) {
      const ip = canonical(hops[i]);
      if (!ip) return null;
      if (proxies.some((p) => inCidr(ip, p))) continue;
      return normalise(ip);
    }
    return null;
  }
  const n = Number(env.CLEARLINE_TRUSTED_PROXY_HOPS ?? "");
  if (Number.isInteger(n) && n >= 1 && n <= 5) {
    if (!xff) return null;
    const hops = xff.split(",").map((x) => x.trim());
    if (hops.length < n) return null;
    return normalise(hops[hops.length - n]);
  }
  return null;
}

/** A canonical bucket for an address: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 as its /64 prefix. */
export function normalise(raw: string | undefined): string | null {
  const v = canonical(raw);
  if (!v) return null;
  return isIP(v) === 4 ? v : `${expand6(v).slice(0, 4).join(":")}::/64`;
}

/** The address itself (brackets stripped, IPv4-mapped IPv6 as IPv4), or null when it is not an IP address. */
function canonical(raw: string | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (v.startsWith("[") && v.includes("]")) v = v.slice(1, v.indexOf("]")); // "[2001:db8::1]:443"
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped) v = mapped[1];
  return isIP(v) ? v : null;
}

function expand6(v: string): string[] {
  const [l, r] = v.toLowerCase().split("::");
  const left = l ? l.split(":") : [];
  const right = r !== undefined && r ? r.split(":") : [];
  const fill = v.includes("::") ? Array(8 - left.length - right.length).fill("0") : [];
  return [...left, ...fill, ...right].map((g) => g.padStart(4, "0"));
}

interface Cidr { v: 4 | 6; bytes: number[]; prefix: number }
function toBytes(ip: string): { v: 4 | 6; bytes: number[] } | null {
  const k = isIP(ip);
  if (k === 4) return { v: 4, bytes: ip.split(".").map(Number) };
  if (k === 6) return { v: 6, bytes: expand6(ip).flatMap((g) => [parseInt(g.slice(0, 2), 16), parseInt(g.slice(2), 16)]) };
  return null;
}
function parseProxyList(raw: string | undefined): Cidr[] | "invalid" {
  if (!raw || !raw.trim()) return [];
  const out: Cidr[] = [];
  for (const entry of raw.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [ip, pre] = entry.split("/");
    const b = toBytes(ip);
    if (!b) return "invalid";
    const max = b.v === 4 ? 32 : 128;
    const prefix = pre === undefined ? max : /^\d+$/.test(pre) ? Number(pre) : NaN;
    if (!(prefix >= 0 && prefix <= max)) return "invalid";
    out.push({ ...b, prefix });
  }
  return out;
}
function inCidr(ip: string, c: Cidr): boolean {
  const b = toBytes(ip);
  if (!b || b.v !== c.v) return false;
  let bits = c.prefix;
  for (let i = 0; i < b.bytes.length && bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 255 : (255 << (8 - bits)) & 255;
    if ((b.bytes[i] & mask) !== (c.bytes[i] & mask)) return false;
  }
  return true;
}
