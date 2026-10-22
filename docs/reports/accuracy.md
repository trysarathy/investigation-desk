# Accuracy and release readiness

The existing suite has 145 engine regression tests and 55 live-replay assertions. These are **test counts, not labelled transaction counts or production accuracy**.

The recorded corpus contains seven actual public transactions and one fabricated not-found hash. The company address assignments, policies and ledger outcomes built around them are synthetic. Therefore they cannot establish real-world precision or recall for wrong customer, wrong network intent, below-minimum policy, holds, rejections, credit or missing credit.

Every diagnosis's independent public-case precision/recall is currently **not measured**. The 100+ independently labelled transaction release gate is **not met**. It would be misleading to duplicate the seven transactions or relabel synthetic variations to reach 100.

The accuracy engine calculates TP/(TP+FP) and TP/(TP+FN), separates label provenance, deduplicates cases, and emits null for missing denominators. Analyst-confirmed metrics are conditional on the reviewed subset and are not unbiased deployment accuracy. Unknown (D99) is included, so abstentions on a labelled diagnosis count as false negatives. A correction preserves the original prediction and evidence and becomes an exportable regression candidate; it must be adjudicated before inclusion.

Collection protocol: capture immutable provider bodies, chain and transfer index, source URL, snapshot time and settings version; obtain partner policy/ledger labels only with permission; have a second reviewer adjudicate; split by transaction and company before tuning rules. Include normal payments and hard negatives. Never infer payment-company wallet ownership from a search snippet alone.
