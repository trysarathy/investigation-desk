export const PATTERNS = [
  "contract_mismatch",
  "issuer_freeze",
  "provider_outage",
  "confirmation_delay",
  "address_lookalike",
] as const;
export type Pattern = (typeof PATTERNS)[number];
export interface Contribution {
  workspace: string;
  day: string;
  pattern: Pattern;
  chain: "tron" | "ethereum" | "bsc";
}
export interface Aggregate {
  day: string;
  pattern: Pattern;
  chain: Contribution["chain"];
  otherCompanies: number;
}
/** Only coarse day + pattern + chain crosses tenants. No addresses, amounts, hashes or case IDs. */
export function aggregateSignals(
  rows: Contribution[],
  viewer: string,
  optedIn: ReadonlySet<string>,
  day: string,
): Aggregate[] {
  if (!optedIn.has(viewer)) return [];
  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.workspace === viewer || !optedIn.has(r.workspace) || r.day !== day)
      continue;
    const key = `${r.pattern}|${r.chain}`,
      set = groups.get(key) ?? new Set<string>();
    set.add(r.workspace);
    groups.set(key, set);
  }
  return [...groups]
    .filter(([, set]) => set.size >= 3)
    .map(([key, set]) => {
      const [pattern, chain] = key.split("|");
      return {
        day,
        pattern: pattern as Pattern,
        chain: chain as Contribution["chain"],
        otherCompanies: set.size,
      };
    });
}
