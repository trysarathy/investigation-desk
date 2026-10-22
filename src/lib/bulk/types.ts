import type { Chain, Code, Confidence } from "../types";

export interface BulkResult {
  line: number;
  txHash: string;
  statedChain?: Chain;
  customerId?: string;
  /** Inferred from File A when the row gave none. */
  customerInferred: boolean;
  state: "verdict" | "paused" | "error";
  code?: Code;
  label: string;
  confidence: Confidence | null;
  foundChain?: Chain;
  token?: string;
  amount?: string;
  note?: string;
}
