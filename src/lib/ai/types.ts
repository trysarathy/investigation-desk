import type { Evidence } from "../types";

/** What the AI may see of one evidence object: no customer IDs, names or emails (spec section 6). */
export type AiEvidence = Pick<Evidence, "id" | "label" | "status" | "value" | "detail" | "mono">;

/** Everything sent to the model: the verdict code, the evidence objects and the reply template. */
export interface AiInput {
  code: string;
  evidence: AiEvidence[];
  /** Approved template with company-setting placeholders already filled; null when there is none. */
  template: string | null;
}
