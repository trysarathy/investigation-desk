ALTER TABLE "merchant_policy" ADD COLUMN "tolerance_combine" text DEFAULT 'larger' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_policy" ADD CONSTRAINT "merchant_policy_combine_chk" CHECK ("merchant_policy"."tolerance_combine" in ('smaller', 'larger'));--> statement-breakpoint
-- Founder decision (rc7): existing policies move to the per-currency "larger of" default. Only rows still on the
-- old rc6 default (5.00 / 5.00 in minor units 500) are changed, one revision up, so a hand-tuned policy is kept.
UPDATE "merchant_policy" p SET
  "tolerance_abs_minor" = CASE e."functional_currency" WHEN 'AED' THEN 2000 ELSE 500 END,
  "writeoff_threshold_minor" = CASE e."functional_currency" WHEN 'AED' THEN 2000 ELSE 500 END,
  "revision" = p."revision" + 1, "updated_at" = now()
FROM "merchant_entities" e
WHERE e."org_id" = p."org_id" AND e."id" = p."entity_id" AND p."tolerance_abs_minor" = 500 AND p."writeoff_threshold_minor" = 500;
