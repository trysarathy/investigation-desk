/**
 * v1 phase 2.2: which network addresses an outbound provider request may connect to. Only public unicast addresses:
 * every private, loopback, link-local (including cloud metadata 169.254.169.254), carrier-grade NAT, multicast,
 * reserved, documentation, benchmarking and unspecified range is refused, for IPv4, IPv6 and IPv4 inside IPv6
 * (mapped, compatible, NAT64, 6to4, Teredo). Checked on the address actually connected to, after DNS resolution.
 */
import { isIP } from "node:net";

const v4 = (ip: string): number[] | null => {
  const p = ip.split(".");
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.map(Number);
};

/** IPv4 ranges that are not public unicast (RFC 6890 special-purpose registry and multicast/reserved). */
const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10], [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16], [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24], [[192, 31, 196, 0], 24], [[192, 52, 193, 0], 24], [[192, 88, 99, 0], 24], [[192, 168, 0, 0], 16],
  [[192, 175, 48, 0], 24], [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24], [[203, 0, 113, 0], 24], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4],
];
function inV4(a: number[], [net, bits]: [number[], number]): boolean {
  const n = (x: number[]) => ((x[0] << 24) >>> 0) + (x[1] << 16) + (x[2] << 8) + x[3];
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((n(a) & mask) >>> 0) === ((n(net) & mask) >>> 0);
}
const publicV4 = (a: number[]) => !V4_BLOCKED.some((r) => inV4(a, r));

/** An IPv6 address as eight 16-bit groups (with an embedded dotted IPv4 tail expanded), or null. */
function v6groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const a = v4(tail[1]);
    if (!a) return null;
    s = s.slice(0, -tail[1].length) + `${((a[0] << 8) | a[1]).toString(16)}:${((a[2] << 8) | a[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => (h ? h.split(":") : []);
  const head = part(halves[0]), rest = halves.length === 2 ? part(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

function publicV6(g: number[]): boolean {
  const embedded = (hi: number, lo: number) => publicV4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  if (g.every((x) => x === 0)) return false; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1 loopback
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]); // ::ffff:a.b.c.d mapped
  if (g.slice(0, 6).every((x) => x === 0)) return false; // ::a.b.c.d compatible (deprecated) and other ::/96
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 ? embedded(g[6], g[7]) : false; // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // IETF protocol assignments (incl. benchmarking, ORCHID)
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard-only
  return (g[0] & 0xe000) === 0x2000; // only global unicast 2000::/3
}

/** True only for a public unicast address. Anything unparseable is refused. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.split("%")[0]);
  if (kind === 4) { const a = v4(ip); return !!a && publicV4(a); }
  if (kind === 6) { const g = v6groups(ip); return !!g && publicV6(g); }
  return false;
}

/** Loopback only (127.0.0.0/8, ::1, ::ffff:127.x): the one extra range a local test stand-in may use. */
export function isLoopbackAddress(ip: string): boolean {
  const kind = isIP(ip.split("%")[0]);
  if (kind === 4) { const a = v4(ip); return !!a && a[0] === 127; }
  if (kind === 6) {
    const g = v6groups(ip);
    if (!g) return false;
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
    return g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff && g[6] >> 8 === 127;
  }
  return false;
}
