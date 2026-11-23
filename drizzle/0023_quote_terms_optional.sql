-- rc7: a provider export often lists payments, not quotes. A quote's terms that the file does not carry are stored as
-- NULL (never derived or assumed); the engine abstains on orders whose quote lacks terms (M3.quote.terms_unknown).
ALTER TABLE "merchant_quotes" ALTER COLUMN "quoted_base_units" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchant_quotes" ALTER COLUMN "rate" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchant_quotes" ALTER COLUMN "rate_source" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchant_quotes" ALTER COLUMN "rate_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchant_quotes" ALTER COLUMN "created_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchant_quotes" ALTER COLUMN "expires_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ALTER COLUMN "requested_minor" DROP NOT NULL;
--> statement-breakpoint
-- Only uploaded rows may leave terms out: seeded and adapter-ingested quotes keep every term.
ALTER TABLE "merchant_quotes" ADD CONSTRAINT "merchant_quotes_terms_chk" CHECK ("upload_id" is not null or ("quoted_base_units" is not null and "rate" is not null and "rate_source" is not null and "rate_at" is not null and "created_at" is not null and "expires_at" is not null));
