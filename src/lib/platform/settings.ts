import { randomUUID } from "node:crypto";
import { getDocument, putDocument, audit } from "./store";
import { SAMPLE_SETTINGS } from "../fixtures";
import { DEPOSIT_CHAINS, type Settings } from "../types";
import { isDecimal } from "../decimal";
import { normaliseInput } from "../normalise";
import { tronToHex } from "../address";
export function companySettings(demo = false): Settings | undefined {
  return demo ? SAMPLE_SETTINGS : getDocument<Settings>("settings", "current");
}
export function saveSettings(input: Settings, actor: string) {
  for (const chain of DEPOSIT_CHAINS) {
    const n = input.confirmations?.[chain];
    if (!Number.isInteger(n) || n < 1 || n > 100000)
      throw Error("Confirmation thresholds must be positive integers");
    const tokens = input.acceptedTokens?.[chain];
    if (!Array.isArray(tokens) || tokens.length > 2)
      throw Error("Declare up to two token contracts per chain");
    const seen = new Set();
    for (const t of tokens) {
      if (!["USDT", "USDC"].includes(t.symbol) || seen.has(t.symbol))
        throw Error("One contract per token symbol per chain");
      seen.add(t.symbol);
      if (
        normaliseInput(t.contract).kind !==
        (chain === "tron" ? "tron_address" : "evm_address")
      )
        throw Error("Invalid token contract");
      if (chain === "tron") tronToHex(t.contract);
      const min = input.minimums?.[chain]?.[t.symbol];
      if (!min || !isDecimal(min) || min.startsWith("-"))
        throw Error(
          "An exact non-negative minimum is required for each accepted token",
        );
    }
  }
  for (const key of [
    "belowMinimumPolicy",
    "retiredAddressPolicy",
    "whereInApp",
  ] as const) {
    if (
      typeof input[key] !== "string" ||
      !input[key].trim() ||
      input[key].length > 500 ||
      /will\s+(be\s+)?credit/i.test(input[key])
    )
      throw Error("Provide concise policy text without a promise of credit");
  }
  const s: Settings = {
    ...SAMPLE_SETTINGS,
    version: `company-${randomUUID()}`,
    acceptedTokens: input.acceptedTokens,
    confirmations: input.confirmations,
    minimums: input.minimums,
    belowMinimumPolicy: input.belowMinimumPolicy,
    retiredAddressPolicy: input.retiredAddressPolicy,
    whereInApp: input.whereInApp,
    keysHeldOnOtherChains: input.keysHeldOnOtherChains === true,
  };
  putDocument("settings", s.version, s);
  putDocument("settings", "current", s);
  audit("settings.versioned", s.version, actor);
  return s;
}
