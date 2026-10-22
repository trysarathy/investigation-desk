import { CATALOGUE_ORDER } from '../catalogue';
import type { Code } from '../types';
export interface LabelledOutcome {
  id: string; predicted: Code; actual: Code;
  provenance: 'synthetic' | 'public-chain' | 'analyst';
  adjudicated: boolean;
}
/** One latest adjudication per case; no synthetic rows in production metrics. */
export function accuracy(rows: LabelledOutcome[], provenance: LabelledOutcome['provenance']) {
  const unique = [...new Map(rows.filter(r => r.adjudicated && r.provenance === provenance).map(r => [r.id, r])).values()];
  return [...CATALOGUE_ORDER, 'D99' as const].map(code => {
    const tp = unique.filter(r => r.actual === code && r.predicted === code).length;
    const fp = unique.filter(r => r.actual !== code && r.predicted === code).length;
    const fn = unique.filter(r => r.actual === code && r.predicted !== code).length;
    return { code, tp, fp, fn, support: tp + fn, predicted: tp + fp,
      precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
  });
}
