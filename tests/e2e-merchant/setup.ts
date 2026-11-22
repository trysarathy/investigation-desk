import { expect, type Page, type TestInfo } from "@playwright/test";
import { resetMerchantDatabase } from "./db";
import { api, signIn, signOut } from "./helpers";

/**
 * A fresh database with every entity reconciled through the API (as Payment Operations would from the daily report),
 * one write-off submitted by Finance and one resolution proposed by Payment Operations, so every screen has data to
 * show, including a pending approval with its decision form.
 */
export async function reconciledDemo(page: Page, info: TestInfo) {
  await resetMerchantDatabase();
  await signIn(page, "ops@straits-demo.example", info);
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) expect((await api(page, "POST", "/api/control/merchant/reconcile", { entityId: e })).status()).toBe(200);
  const note = await api(page, "POST", "/api/control/merchant/exceptions/EX-BK-24830/notes", { kind: "evidence", body: "Customer agreed to keep the excess as credit (fictional).", reference: "CR-24830" });
  expect(note.status()).toBe(201);
  const res = await api(page, "POST", "/api/control/merchant/resolutions", { exceptionId: "EX-BK-24830", note: "Customer keeps SGD 145.80 as credit on account.", evidenceIds: [(await note.json()).id] });
  expect(res.status()).toBe(201);
  await signOut(page);
  await signIn(page, "finance@straits-demo.example", info);
  const list = await (await api(page, "GET", "/api/control/merchant/approvals")).json();
  expect((await api(page, "POST", `/api/control/merchant/writeoffs/${encodeURIComponent(list.writeoffsToSubmit[0].id)}/propose`, {})).status()).toBe(201);
  await signOut(page);
  await signIn(page, "ops@dunehaven-demo.example", info);
  expect((await api(page, "POST", "/api/control/merchant/reconcile", { entityId: "ENT-AE-03" })).status()).toBe(200);
  await signOut(page);
}

export const MERCHANT_PAGES = [
  "/control/merchant", "/control/merchant?entity=ENT-SG-02&date=2026-11-25", "/control/merchant/payments", "/control/merchant/payments?result=exception&network=tron",
  "/control/merchant/payments/BK-24817", "/control/merchant/payments/BK-24871", "/control/merchant/exceptions", "/control/merchant/exceptions/EX-BK-24830",
  "/control/merchant/batches", "/control/merchant/batches/B-1125-SGD", "/control/merchant/approvals", "/control/merchant/month-end?entity=ENT-SG-02&month=2026-11",
  "/control/merchant/evidence", "/control/merchant/accounting?entity=ENT-SG-01&month=2026-11",
] as const;
