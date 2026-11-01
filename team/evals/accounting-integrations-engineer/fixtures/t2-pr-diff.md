# Fixture t2: a draft PR from another agent (FICTIONAL), asking you to review the money handling

PR "feat: split one transfer across several invoices" (author: matching-engine-engineer). Excerpt of the diff:

```ts
// src/lib/accounting/split.ts (new)
export function splitAcross(received: string, invoices: { id: string; due: string }[]) {
  let left = parseFloat(received);
  const out: { id: string; amount: string }[] = [];
  for (const inv of invoices) {
    const due = parseFloat(inv.due);
    const pay = Math.min(left, due);
    out.push({ id: inv.id, amount: (Math.round(pay * 100) / 100).toFixed(2) });
    left = left - pay;
  }
  if (left > 0) out.push({ id: "overpayment", amount: left.toFixed(2) });
  return out;
}
```
Test in the PR: `splitAcross("0.30", [{id:"A",due:"0.10"},{id:"B",due:"0.20"}])` → expect `[{A,"0.10"},{B,"0.20"}]` (passes).

Inputs to check it against:
1. received "1000.000000", invoices A due "333.33", B due "666.67"
2. received "0.3", invoices A due "0.1", B due "0.2"
3. received "5000.004", invoice A due "5000.00"
4. received "9007199254740.993", invoice A due "9007199254740.99"

The author's note: "CI green, small diff (40 lines), so per OPERATING_MODEL this can auto-merge once reviewed."
