-- v1 (#174, approval-only draft): a per-payment settlement file may carry refund rows. Runs as the schema owner. No
-- existing control is relaxed:
--  * kind = 'payment' (every existing row, the default) or 'refund'. A refund row names the ORIGINAL payment by its
--    provider payment ID and carries its own refund ID; it never links that payment to a batch.
--  * sign convention: a payment row as before (gross >= 0, fee >= 0, gross - fee = net); a refund row carries the money
--    returned as a NEGATIVE gross and net with a zero fee (gross < 0, fee = 0, net = gross), so gross - fee = net holds
--    for every row and the rows of a batch sum to its net.
--  * the key: a payment row is keyed by its payment ID (one batch per payment, as before); a refund row by
--    'refund:' || its refund ID. The key is generated from the row (never written), so it cannot disagree with it.
--  * rows stay insert-only (the 0041 trigger), with the same row-level security and provenance check.
ALTER TABLE "settlement_payment_lines" ADD COLUMN "kind" text DEFAULT 'payment' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" ADD COLUMN "refund_id" text;
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" ADD COLUMN "line_key" text GENERATED ALWAYS AS (CASE WHEN "kind" = 'refund' THEN 'refund:' || "refund_id" ELSE "provider_payment_id" END) STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" DROP CONSTRAINT "settlement_payment_lines_org_id_provider_payment_id_pk";
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" ADD CONSTRAINT "settlement_payment_lines_org_id_line_key_pk" PRIMARY KEY ("org_id", "line_key");
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" ADD CONSTRAINT "settlement_payment_lines_kind_chk" CHECK (("kind" = 'payment' AND "refund_id" IS NULL) OR ("kind" = 'refund' AND "refund_id" IS NOT NULL AND length("refund_id") BETWEEN 1 AND 128));
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" DROP CONSTRAINT "settlement_payment_lines_arith_chk";
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" ADD CONSTRAINT "settlement_payment_lines_arith_chk" CHECK (
  ("kind" = 'payment' AND "gross_minor" >= 0 AND "fee_minor" >= 0 AND "gross_minor" - "fee_minor" = "net_minor")
  OR ("kind" = 'refund' AND "gross_minor" < 0 AND "fee_minor" = 0 AND "net_minor" = "gross_minor"));
--> statement-breakpoint
CREATE INDEX "settlement_payment_lines_payment_idx" ON "settlement_payment_lines" ("org_id", "provider_payment_id");
