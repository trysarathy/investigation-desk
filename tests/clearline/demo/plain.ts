/** JSON with BigInt as decimal strings (stable key order as produced). */
export const plainJson = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
