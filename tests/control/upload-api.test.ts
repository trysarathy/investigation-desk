/**
 * rc7 /api/control/merchant/uploads/** route handlers, called as Next calls them, against the real database:
 * session cookie, organisation selection, exact Origin and Idempotency-Key on every mutation, multipart with a size
 * cap, and JSON the UI can use. Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import { POST as authPOST } from "../../src/app/api/auth/[...all]/route";
import { GET as listGET, POST as uploadPOST } from "../../src/app/api/control/merchant/uploads/route";
import { GET as oneGET } from "../../src/app/api/control/merchant/uploads/[id]/route";
import { GET as previewGET } from "../../src/app/api/control/merchant/uploads/[id]/preview/route";
import { POST as mappingPOST } from "../../src/app/api/control/merchant/uploads/[id]/mapping/route";
import { POST as validatePOST } from "../../src/app/api/control/merchant/uploads/[id]/validate/route";
import { GET as reportGET } from "../../src/app/api/control/merchant/uploads/[id]/report/route";
import { POST as decisionPOST } from "../../src/app/api/control/merchant/uploads/[id]/decision/route";
import { GET as templatesGET, POST as templatesPOST } from "../../src/app/api/control/merchant/uploads/templates/route";

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const BASE = `${ORIGIN}/api/control/merchant/uploads`;
let s: LiveSeed;
const cookies: Record<string, string> = {};
let ip = 90;
let k = 0;
const key = () => `upload-api-${++k}-${Date.now()}`;

async function signIn(email: string) {
  const res = await authPOST(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `198.51.100.${ip++}` }, body: JSON.stringify({ email, password: PASSWORD }),
  }));
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const auth = (email: string, extra: Record<string, string> = {}) => ({ cookie: `${cookies[email]}; clearline_org=${s.slugs.a}`, ...extra });
const multipart = (email: string, file: Blob, fields: Record<string, string>, h: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [k2, v] of Object.entries(fields)) form.set(k2, v);
  form.set("file", file, "Provider export (fictional).csv");
  return new Request(BASE, { method: "POST", headers: auth(email, { origin: ORIGIN, "idempotency-key": key(), ...h }), body: form });
};
const post = (path: string, email: string, body: unknown) =>
  new Request(`${BASE}${path}`, { method: "POST", headers: auth(email, { origin: ORIGIN, "idempotency-key": key(), "content-type": "application/json" }), body: JSON.stringify(body) });
const get = (path: string, email: string) => new Request(`${BASE}${path}`, { headers: auth(email) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const CSV = "Order,Amount,Ccy\nORD-API-1,10.00,SGD\nORD-API-2,\"1,250.50\",SGD\n";
const MAPPING = { fileType: "orders_invoices", columns: { order_id: { header: "Order" }, invoice_amount: { header: "Amount" }, currency: { header: "Ccy" } } };

beforeAll(async () => {
  useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb());
  for (const e of ["finance@live-a.example", "viewer@live-a.example"]) cookies[e] = await signIn(e);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("upload routes", () => {
  it("refuse a foreign Origin, a missing Idempotency-Key, JSON instead of multipart, an oversized file and a Viewer", async () => {
    const file = new Blob([CSV]);
    const fields = { entityId: "ENT-LIVE-SG", fileType: "orders_invoices" };
    expect((await uploadPOST(multipart("finance@live-a.example", file, fields, { origin: "https://attacker.example" }))).status).toBe(403);
    const noKey = multipart("finance@live-a.example", file, fields);
    noKey.headers.delete("idempotency-key");
    expect((await (await uploadPOST(noKey)).json()).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect((await (await uploadPOST(post("", "finance@live-a.example", fields))).json()).error.code).toBe("MULTIPART_REQUIRED");
    const big = await uploadPOST(multipart("finance@live-a.example", new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), fields));
    expect([big.status, (await big.json()).error.code]).toEqual([422, "FILE_TOO_LARGE"]);
    expect((await uploadPOST(multipart("viewer@live-a.example", file, fields))).status).toBe(403);
  });
  it("upload → preview → mapping → validate → report → confirm, as JSON the UI uses", async () => {
    const res = await uploadPOST(multipart("finance@live-a.example", new Blob([CSV]), { entityId: "ENT-LIVE-SG", fileType: "orders_invoices" }));
    expect(res.status).toBe(201);
    const up = await res.json();
    expect(up).toMatchObject({ label: "Your data", upload: { status: "stored", originalName: "Provider export (fictional).csv" }, preview: { headers: ["Order", "Amount", "Ccy"], totalRows: 2 } });
    expect(up.suggestion.suggestion.proposal).toMatchObject({ order_id: { header: "Order" }, invoice_amount: { header: "Amount" }, currency: { header: "Ccy" } });
    const id = up.upload.id as string;
    expect((await (await previewGET(get(`/${id}/preview`, "viewer@live-a.example"), params(id))).json()).preview.rows).toEqual([["ORD-API-1", "10.00", "SGD"], ["ORD-API-2", "1,250.50", "SGD"]]);
    const tpl = await templatesPOST(post("/templates", "finance@live-a.example", { fileType: "orders_invoices", name: "Orders", headers: ["Order", "Amount", "Ccy"], mapping: MAPPING }));
    expect(tpl.status).toBe(201);
    expect((await (await templatesGET(get("/templates?fileType=orders_invoices", "viewer@live-a.example"))).json()).templates).toHaveLength(1);
    const templateId = (await tpl.json()).template.id;
    expect((await (await mappingPOST(post(`/${id}/mapping`, "finance@live-a.example", { templateId }), params(id))).json()).upload).toMatchObject({ status: "mapped", templateVersion: 1 });
    const v = await (await validatePOST(post(`/${id}/validate`, "finance@live-a.example", {}), params(id))).json();
    expect(v.upload).toMatchObject({ status: "validated", counts: { rows: 2, accepted: 2 } });
    const report = await (await reportGET(get(`/${id}/report?page=1&pageSize=1`, "viewer@live-a.example"), params(id))).json();
    expect(report).toMatchObject({ total: 2, page: 1, pageSize: 1, rows: [{ rowNumber: 2, status: "accepted", reasonCodes: [] }] });
    const d = await decisionPOST(post(`/${id}/decision`, "finance@live-a.example", { decision: "confirm", reason: "Orders checked (fictional)", contentSha256: v.upload.contentSha256, rowsSha256: v.upload.rowsSha256 }), params(id));
    expect((await d.json()).upload.status).toBe("confirmed");
    expect((await (await oneGET(get(`/${id}`, "viewer@live-a.example"), params(id))).json()).upload.status).toBe("confirmed");
    expect((await (await listGET(get("", "viewer@live-a.example"))).json()).uploads).toHaveLength(1);
  });
});
