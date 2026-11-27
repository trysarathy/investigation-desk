/**
 * rc7 phase 3b: sales invoices from the merchant's accounting ledger (a ledger export uploaded through the same
 * upload → mapping → validation → confirmation → normalise flow, or a read-only pull from a Xero demo company or a
 * QuickBooks sandbox rendered as the same file). Reference data for month-end only: the matching engine never reads
 * it. Exact minor units (bigint), provenance on every row. Security: drizzle/0026_ledger_invoices.sql.
 */
import { sql } from "drizzle-orm";
import { bigint, check, date, foreignKey, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";
import { merchantEntities } from "./merchant-schema";

const money = (name: string) => bigint(name, { mode: "bigint" });

export const LEDGER_INVOICE_STATUSES = ["draft", "open", "paid", "void"] as const;

export const ledgerInvoices = pgTable("ledger_invoices", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  entityId: text("entity_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  orderRef: text("order_ref"),
  contact: text("contact"),
  // v1 Phase 5.3 (0084, was 0072): the order reference sealed (with a blind index, it is compared with orders) and the contact sealed
  orderRefEnc: text("order_ref_enc"), orderRefBidx: text("order_ref_bidx"), contactEnc: text("contact_enc"),
  currency: text("currency").notNull(),
  totalMinor: money("total_minor").notNull(),
  amountDueMinor: money("amount_due_minor"),
  amountPaidMinor: money("amount_paid_minor"),
  status: text("status").notNull(),
  issuedOn: date("issued_on"),
  dueOn: date("due_on"),
  ledgerId: text("ledger_id"),
  uploadId: uuid("upload_id").notNull(),
  sourceRow: integer("source_row").notNull(),
  mappingTemplateId: uuid("mapping_template_id"),
  mappingTemplateVersion: integer("mapping_template_version"),
  uploadedBy: text("uploaded_by").notNull().references(() => users.id),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.entityId, t.invoiceNumber] }),
  foreignKey({ columns: [t.orgId, t.entityId], foreignColumns: [merchantEntities.orgId, merchantEntities.id], name: "ledger_invoices_entity_fk" }),
  check("ledger_invoices_cur_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  check("ledger_invoices_status_chk", sql`${t.status} in ('draft','open','paid','void')`),
  check("ledger_invoices_amount_chk", sql`${t.totalMinor} >= 0 and coalesce(${t.amountDueMinor}, 0) >= 0 and coalesce(${t.amountPaidMinor}, 0) >= 0`),
]);
