import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
const sources = [...walk("app"), ...walk("components"), ...walk("lib")].filter(f => /\.(tsx?|css)$/.test(f));
const copySources = sources.filter(f => /\.tsx?$/.test(f));

const PAGES = {
  "/": "app/page.tsx", "/platform": "app/platform/page.tsx", "/connect": "app/connect/page.tsx", "/control": "app/control/page.tsx",
  "/use-cases": "app/use-cases/page.tsx", "/developers": "app/developers/page.tsx", "/trial": "app/trial/page.tsx",
  "/onchain": "app/onchain/page.tsx", "/about": "app/about/page.tsx", "/contact": "app/contact/page.tsx", "/privacy": "app/privacy/page.tsx",
};

test("every required page exists and is listed in ROUTES (nav/sitemap source)", () => {
  const site = read("lib/site.ts");
  for (const [route, file] of Object.entries(PAGES)) {
    assert.ok(fs.existsSync(path.join(root, file)), file + " missing");
    assert.ok(site.includes(`path: "${route}"`), route + " missing from ROUTES");
  }
});

test("every page exports metadata built with pageMeta (title, description, Open Graph)", () => {
  for (const file of Object.values(PAGES)) assert.match(read(file), /export const metadata = pageMeta\(/, file);
  assert.match(read("lib/meta.ts"), /openGraph/);
  assert.match(read("app/sitemap.ts"), /ROUTES/);
  assert.match(read("app/robots.ts"), /sitemap\.xml/);
});

test("every page has a main landmark and exactly one marked main CTA", () => {
  for (const file of Object.values(PAGES)) {
    const s = read(file);
    assert.match(s, /<main id="main">/, file);
    assert.equal((s.match(/<ButtonLink[^>]*\smain>/g) || []).length, 1, file + " must mark exactly one main CTA");
  }
});

test("no banned stage words in copy: live, production, production-ready, enterprise-ready", () => {
  for (const f of copySources) {
    const s = read(f).replace(/aria-live="[a-z]+"/g, "");
    for (const re of [/\blive\b/i, /\bproduction\b/i, /production-ready/i, /enterprise-ready/i])
      assert.equal(re.test(s), false, f + " contains " + re);
  }
});

test("no invented endorsement, traction, fake metrics or logos", () => {
  const phrases = ["trusted by", "our customers include", "testimonial", "case study", "as seen in", "ai-powered", "audit-ready", "guaranteed", "real-time", "fully automated", "backed by"];
  for (const f of copySources) {
    const s = read(f).toLowerCase();
    for (const p of phrases) assert.equal(s.includes(p), false, f + " contains " + p);
    assert.equal(/\d+(\.\d+)?\s?%/.test(read(f).replace(/width:\s*"100%"|height:\s*"100%"/g, "")), false, f + " contains a percentage figure");
    const imgs = [...read(f).matchAll(/<img[^>]*src=\{?"([^"]+)"/g)].map(m => m[1]);
    for (const src of imgs) assert.equal(src, "/founder.jpg", f + " uses image " + src);
  }
  assert.deepEqual(fs.readdirSync(path.join(root, "public")).filter(f => !f.startsWith(".")), ["founder.jpg"], "only the founder photo is a public asset");
});

test("a single product-demo URL constant is used everywhere", () => {
  const site = read("lib/site.ts");
  assert.match(site, /export const PRODUCT_DEMO_URL/);
  assert.match(site, /"https:\/\/clearline-customer-trial\.vercel\.app"/);
  assert.match(site, /TRIAL_URL = PRODUCT_DEMO_URL \+ "\/clearline\/trial"/);
  assert.match(site, /SOFTWARE_URL = PRODUCT_DEMO_URL \+ "\/clearline"/);
  for (const f of sources.filter(f => f !== path.join("lib", "site.ts"))) {
    const s = read(f);
    assert.equal(/clearline-customer-trial|vercel\.app|sarathyv2|investigation-desk-git/.test(s), false, f + " hard-codes a demo host");
  }
  for (const f of ["README.md"]) assert.equal(/sarathyv2|investigation-desk-git/.test(read(f)), false, f + " has a stale demo URL");
  // Pages link to the product only through the derived constants.
  for (const f of copySources) {
    const hrefs = [...read(f).matchAll(/href="(https?:[^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(hrefs, [], f + " has a literal external href");
  }
});

test("founder email and honest contact path are present", () => {
  assert.match(read("lib/site.ts"), /EMAIL = "aashmiin\.k\.2025@accountancy\.smu\.edu\.sg"/);
  const contact = read("app/contact/page.tsx");
  assert.match(contact, /Booking link pending/);
  assert.match(contact, /mailto\(/);
  const form = read("components/ContactForm.tsx");
  assert.match(form, /id !== "FORM_ID"/);
  assert.match(form, /if \(!FORM_ENABLED\) return <EmailPanel \/>/, "no form is shown unless Formspree is configured");
});

test("founder facts match the brief and invent nothing", () => {
  const about = read("app/about/page.tsx");
  assert.match(about, /Aashmiin Kaur/);
  assert.match(about, /Singapore Management University/);
  assert.match(about, /second major in Finance/);
  assert.match(about, /src="\/founder\.jpg"/);
  assert.match(about, /Customers, partners or investors/);
});

test("status model separates provider-reported, evidence-verified and reconciled", () => {
  const dev = read("app/developers/page.tsx");
  for (const t of ["provider_reported_completed", "settlement_evidence_verified", "reconciled", "Webhooks", "Limitations", "Quickstart"]) assert.ok(dev.includes(t), t);
  const status = read("components/Status.tsx");
  assert.match(status, /st-exec/); assert.match(status, /st-evidence/); assert.match(status, /st-recon/);
});

test("design tokens are exported for the console and used by the site", () => {
  const tokens = read("app/tokens.css");
  for (const hex of ["#17212D", "#F5F1E8", "#D04B31", "#E6EDF0", "#A93A24"]) assert.ok(tokens.includes(hex), hex);
  assert.match(read("app/layout.tsx"), /import "\.\/tokens\.css"/);
  assert.ok(fs.existsSync(path.resolve(root, "../docs/design/DESIGN_SYSTEM.md")), "DESIGN_SYSTEM.md missing");
});

test("sample data is fictional and labelled", () => {
  assert.match(read("lib/sample.ts"), /Fictional sample records/);
  assert.match(read("components/PaymentPreview.tsx"), /fictional/i);
});

test("built output (if present) has the email, metadata and no stale hosts", { skip: !fs.existsSync(path.join(root, "out")) }, () => {
  const pages = ["index.html", "platform.html", "developers.html", "trial.html", "about.html", "contact.html", "privacy.html", "connect.html", "control.html", "use-cases.html", "onchain.html"];
  for (const p of pages) {
    const f = path.join(root, "out", p);
    assert.ok(fs.existsSync(f), p + " not built");
    const html = fs.readFileSync(f, "utf8");
    assert.match(html, /<meta property="og:title"/, p);
    assert.match(html, /<meta name="description"/, p);
    assert.match(html, /aashmiin\.k\.2025@accountancy\.smu\.edu\.sg/, p + " lacks founder email");
    assert.equal(/sarathyv2|investigation-desk-git/.test(html), false, p);
  }
});

// Founder-approved facts and terms (13 Nov 2026).
import { readFileSync as _rf } from "node:fs";
test("founder-approved about, trial and privacy wording", () => {
  const about = _rf(new URL("../app/about/page.tsx", import.meta.url), "utf8");
  assert.match(about, /19/); assert.match(about, /second year of Accountancy at Singapore Management University/);
  assert.match(about, /second major in Finance/);
  const trial = _rf(new URL("../app/trial/page.tsx", import.meta.url), "utf8");
  assert.match(trial, /15–20 minutes/); assert.match(trial, /up to five of your closed, redacted cases/);
  assert.match(trial, /agree the scope and how the data will be handled securely/);
  const privacy = _rf(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
  assert.match(privacy, /provisional notice/); assert.match(privacy, /hosted on Vercel/);
  assert.match(privacy, /does not claim compliance/); assert.match(privacy, /confidential financial data is disabled/);
});
