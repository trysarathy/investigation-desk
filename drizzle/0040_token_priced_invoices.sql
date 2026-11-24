-- v1 Phase 0 (approval-only draft): an invoice may be priced directly in a token, e.g. 1,250.00 USDT on TRON stored as
-- 1250000000 base units on the configured contract. Runs as the schema owner. No existing control is relaxed:
--  * exactly one pricing mode per invoice: a fiat amount (amount_minor > 0, as before), or a token price (network and
--    contract of a configured token, base units > 0) with amount_minor NULL. Every existing row is fiat-priced.
--  * `currency` stays NOT NULL: for a token-priced invoice it is the currency the invoice is accounted in.
--  * the price of an invoice never changes once written (a new trigger; status updates are unaffected).
--  * two new difference types for token-priced invoices; the existing ones are unchanged.
ALTER TABLE "invoices" ALTER COLUMN "amount_minor" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "price_network" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "price_token_contract" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "price_token_amount" numeric(78, 0);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pricing_mode_chk" CHECK (
  ("amount_minor" is not null and "price_network" is null and "price_token_contract" is null and "price_token_amount" is null)
  or ("amount_minor" is null and "price_network" is not null and "price_token_contract" is not null and "price_token_amount" is not null and "price_token_amount" > 0));
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_price_token_fk" FOREIGN KEY ("price_network","price_token_contract") REFERENCES "public"."token_config"("network","contract") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION refuse_invoice_price_change() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.price_network IS DISTINCT FROM OLD.price_network
     OR NEW.price_token_contract IS DISTINCT FROM OLD.price_token_contract OR NEW.price_token_amount IS DISTINCT FROM OLD.price_token_amount THEN
    RAISE EXCEPTION 'an invoice''s price is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_price_immutable BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION refuse_invoice_price_change();
--> statement-breakpoint
ALTER TABLE "differences" DROP CONSTRAINT "differences_type_chk";
--> statement-breakpoint
ALTER TABLE "differences" ADD CONSTRAINT "differences_type_chk" CHECK (type in ('sender_side_fee','underpayment','overpayment','requote_after_expiry','rate_difference','provider_fee','refund_netted','timing_prior_batch','timing_next_batch','held_by_provider','partial_payment_open','unexplained','price_token_mismatch','price_token_amount'));
