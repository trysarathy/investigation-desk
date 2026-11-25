-- v1 Phase 5.3, EXPAND step of the field-encryption migration (docs/security/ENCRYPTION_V1.md).
-- Runs as the schema owner. Every plaintext column stays as it is, with every existing constraint, index and trigger;
-- each gains a sealed copy (<column>_enc: AES-256-GCM under the organisation's data key) and, where values are
-- compared, a blind index (<column>_bidx: HMAC-SHA256 under the organisation's index key, exact value).
-- New rows get both from the application; existing rows from the backfill (scripts/crypto/keys.ts backfill).
-- The CONTRACT step (drop the plaintext columns) is documented in docs/security/ENCRYPTION_V1.md and NOT part of
-- any migration.
--
-- Changed controls (listed in the report as a security-control change):
--   * chain_reads and ledger_invoices were append-only for everyone (refuse_change on UPDATE). Their UPDATE trigger
--     now refuses every update EXCEPT one, made by the table's owner (key maintenance), that changes nothing but the
--     sealed values and fills a missing blind index. The runtime role still has no UPDATE privilege on either table,
--     and DELETE keeps refuse_change unchanged.
--   * chain_transfers keeps keep_chain_fact unchanged; a second trigger stops anyone but the owner from changing a
--     sealed value and stops everyone from changing a blind index once written.
--   * merchant_quotes, payment_links and address_facts get the same second trigger.

ALTER TABLE merchant_quotes ADD COLUMN deposit_address_enc text, ADD COLUMN deposit_address_bidx text;
--> statement-breakpoint
ALTER TABLE payment_links ADD COLUMN deposit_address_enc text, ADD COLUMN deposit_address_bidx text;
--> statement-breakpoint
ALTER TABLE chain_transfers ADD COLUMN from_address_enc text, ADD COLUMN from_address_bidx text, ADD COLUMN to_address_enc text, ADD COLUMN to_address_bidx text, ADD COLUMN prior_hops_enc text;
--> statement-breakpoint
ALTER TABLE address_facts ADD COLUMN address_enc text, ADD COLUMN address_bidx text;
--> statement-breakpoint
ALTER TABLE chain_reads ADD COLUMN address_enc text, ADD COLUMN address_bidx text;
--> statement-breakpoint
ALTER TABLE ledger_invoices ADD COLUMN order_ref_enc text, ADD COLUMN order_ref_bidx text, ADD COLUMN contact_enc text;
--> statement-breakpoint

-- Shape: a sealed value is ce1.<data key version>.<base64url>; an index is 64 hex characters; a column with an index
-- has both or neither; no sealed value without its plaintext while the plaintext column exists.
ALTER TABLE merchant_quotes ADD CONSTRAINT merchant_quotes_deposit_sealed_chk CHECK ((deposit_address_enc IS NULL) = (deposit_address_bidx IS NULL)
  AND (deposit_address_enc IS NULL OR deposit_address_enc ~ '^ce1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+$') AND (deposit_address_bidx IS NULL OR deposit_address_bidx ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint
ALTER TABLE payment_links ADD CONSTRAINT payment_links_deposit_sealed_chk CHECK ((deposit_address_enc IS NULL) = (deposit_address_bidx IS NULL)
  AND (deposit_address_enc IS NULL OR deposit_address_enc ~ '^ce1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+$') AND (deposit_address_bidx IS NULL OR deposit_address_bidx ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint
ALTER TABLE chain_transfers ADD CONSTRAINT chain_transfers_sealed_chk CHECK ((from_address_enc IS NULL) = (from_address_bidx IS NULL) AND (to_address_enc IS NULL) = (to_address_bidx IS NULL)
  AND (from_address_enc IS NULL OR from_address_enc ~ '^ce1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+$') AND (to_address_enc IS NULL OR to_address_enc ~ '^ce1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+$')
  AND (from_address_bidx IS NULL OR from_address_bidx ~ '^[0-9a-f]{64}$') AND (to_address_bidx IS NULL OR to_address_bidx ~ '^[0-9a-f]{64}$')
  AND (prior_hops IS NOT NULL OR prior_hops_enc IS NULL) AND (prior_hops_enc IS NULL OR prior_hops_enc ~ '^ce1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+$'));
--> statement-breakpoint
ALTER TABLE address_facts ADD CONSTRAINT address_facts_sealed_chk CHECK ((address_enc IS NULL) = (address_bidx IS NULL)
  AND (address_enc IS NULL OR address_enc ~ '^ce1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+$') AND (address_bidx IS NULL OR address_bidx ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint
ALTER TABLE chain_reads ADD CONSTRAINT chain_reads_sealed_chk CHECK ((address_enc IS NULL) = (address_bidx IS NULL) AND (address IS NOT NULL OR address_enc IS NULL)
  AND (address_enc IS NULL OR address_enc ~ '^ce1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+$') AND (address_bidx IS NULL OR address_bidx ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint
ALTER TABLE ledger_invoices ADD CONSTRAINT ledger_invoices_sealed_chk CHECK ((order_ref_enc IS NULL) = (order_ref_bidx IS NULL)
  AND (order_ref IS NOT NULL OR order_ref_enc IS NULL) AND (contact IS NOT NULL OR contact_enc IS NULL)
  AND (order_ref_enc IS NULL OR order_ref_enc ~ '^ce1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+$') AND (contact_enc IS NULL OR contact_enc ~ '^ce1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]+$')
  AND (order_ref_bidx IS NULL OR order_ref_bidx ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint

-- Equality on the blind index works exactly as on the plaintext: the same uniqueness for deposit addresses (the
-- plaintext unique indexes stay until the contract step) and indexed lookups for the compared columns.
CREATE UNIQUE INDEX merchant_quotes_deposit_bidx_uq ON merchant_quotes (org_id, network, deposit_address_bidx) WHERE deposit_address_bidx IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX payment_links_deposit_bidx_uq ON payment_links (org_id, network, deposit_address_bidx) WHERE deposit_address_bidx IS NOT NULL;
--> statement-breakpoint
CREATE INDEX chain_transfers_to_bidx_idx ON chain_transfers (org_id, network, to_address_bidx);
--> statement-breakpoint
CREATE INDEX address_facts_bidx_idx ON address_facts (org_id, network, address_bidx);
--> statement-breakpoint
CREATE INDEX ledger_invoices_order_ref_bidx_idx ON ledger_invoices (org_id, order_ref_bidx);
--> statement-breakpoint

-- Sealed values are written on insert by the application; afterwards only key maintenance (the table's owner:
-- backfill, re-encryption after a rotation) may re-seal them, never remove them. A blind index, once written, never
-- changes. TG_ARGV: sealed columns, index columns, and 'only' when nothing else of the row may ever change.
CREATE FUNCTION guard_sealed_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  enc text[] := string_to_array(TG_ARGV[0], ',');
  bidx text[] := string_to_array(TG_ARGV[1], ',');
  only_sealed boolean := TG_ARGV[2] = 'only';
  n jsonb := to_jsonb(NEW);
  o jsonb := to_jsonb(OLD);
  c text;
  sealed_changed boolean := false;
  maintainer boolean := pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'USAGE');
BEGIN
  FOREACH c IN ARRAY bidx LOOP
    IF (o ->> c) IS NOT NULL AND (n ->> c) IS DISTINCT FROM (o ->> c) THEN
      RAISE EXCEPTION '%.%: a blind index never changes once written', TG_TABLE_NAME, c USING ERRCODE = 'check_violation';
    END IF;
    IF (n ->> c) IS DISTINCT FROM (o ->> c) THEN sealed_changed := true; END IF;
  END LOOP;
  FOREACH c IN ARRAY enc LOOP
    IF (n ->> c) IS DISTINCT FROM (o ->> c) THEN
      IF (n ->> c) IS NULL THEN
        RAISE EXCEPTION '%.%: a sealed value is never removed', TG_TABLE_NAME, c USING ERRCODE = 'check_violation';
      END IF;
      sealed_changed := true;
    END IF;
  END LOOP;
  IF sealed_changed AND NOT maintainer THEN
    RAISE EXCEPTION '%: sealed values are written on insert; only key maintenance re-seals them', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF only_sealed AND (NOT maintainer OR (n - enc - bidx) IS DISTINCT FROM (o - enc - bidx)) THEN
    RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION guard_sealed_update() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER merchant_quotes_sealed_guard BEFORE UPDATE ON merchant_quotes FOR EACH ROW EXECUTE FUNCTION guard_sealed_update('deposit_address_enc', 'deposit_address_bidx', '');
--> statement-breakpoint
CREATE TRIGGER payment_links_sealed_guard BEFORE UPDATE ON payment_links FOR EACH ROW EXECUTE FUNCTION guard_sealed_update('deposit_address_enc', 'deposit_address_bidx', '');
--> statement-breakpoint
CREATE TRIGGER chain_transfers_sealed_guard BEFORE UPDATE ON chain_transfers FOR EACH ROW EXECUTE FUNCTION guard_sealed_update('from_address_enc,to_address_enc,prior_hops_enc', 'from_address_bidx,to_address_bidx', '');
--> statement-breakpoint
CREATE TRIGGER address_facts_sealed_guard BEFORE UPDATE ON address_facts FOR EACH ROW EXECUTE FUNCTION guard_sealed_update('address_enc', 'address_bidx', '');
--> statement-breakpoint
-- chain_reads: UPDATE was refused for everyone; now refused for everyone except key maintenance re-sealing (DELETE unchanged)
DROP TRIGGER chain_reads_append_only ON chain_reads;
--> statement-breakpoint
CREATE TRIGGER chain_reads_append_only BEFORE DELETE ON chain_reads FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER chain_reads_sealed_only BEFORE UPDATE ON chain_reads FOR EACH ROW EXECUTE FUNCTION guard_sealed_update('address_enc', 'address_bidx', 'only');
--> statement-breakpoint
-- ledger_invoices: the same (retention, the owner, still deletes rows as before)
DROP TRIGGER ledger_invoices_no_change ON ledger_invoices;
--> statement-breakpoint
CREATE TRIGGER ledger_invoices_no_change BEFORE UPDATE ON ledger_invoices FOR EACH ROW EXECUTE FUNCTION guard_sealed_update('order_ref_enc,contact_enc', 'order_ref_bidx', 'only');
