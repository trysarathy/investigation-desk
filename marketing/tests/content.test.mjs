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
    const s = read(f).replace(/aria-live="[a-z]+"/g, "").replace(/not a shared production ledger/gi, ""); // the engine's own negative disclaimer is allowed
    for (const re of [/\blive\b/i, /\bproduction\b/i, /production-ready/i, /enterprise-ready/i])
      assert.equal(re.test(s), false, f + " contains " + re);
  }
});

test("no invented endorsement, traction, fake metrics or logos", () => {
  const phrases = ["trusted by", "our customers include", "testimonial", "case study", "as seen in", "ai-powered", "audit-ready", "guaranteed", "real-time", "fully automated", "backed by"];
  for (const f of copySources) {
    const s = read(f).toLowerCase();
    for (const p of phrases) assert.equal(s.includes(p), false, f + " contains " + p);
    // The engine's acceptance thresholds (ACCEPTED_OVERAGE_BPS 1%, MAX_APPROVED_OVERAGE_BPS 50%) are rules, not metrics.
    assert.equal(/\d+(\.\d+)?\s?%/.test(read(f).replace(/width:\s*"100%"|height:\s*"100%"/g, "").replace("an over-amount of up to 1% by one person, above 1% and up to 50% only with", "")), false, f + " contains a percentage figure");
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

// Status names must match the TESTED engine (src/lib/clearline/types.ts on the engine branch).
const ENGINE = {
  execution: ["created", "quoted", "approved", "submitted", "in_transit", "provider_reported_completed", "awaiting_information", "on_hold", "failed", "returned", "cancelled", "expired"],
  settlement: ["none", "observed", "pending_finality", "verified", "contradicted"],
  settlementScope: ["none", "provider_report", "bank_statement", "onchain_transfer"],
  reconciliation: ["not_started", "pending", "matched", "partially_matched", "exception"],
};
const unionOf = (src, name) => {
  const m = src.match(new RegExp("export type " + name + " =([^;]+);"));
  assert.ok(m, name + " type missing");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map(x => x[1]).sort();
};

test("Status.tsx types are exactly the engine's three status dimensions", () => {
  const st = read("components/Status.tsx");
  assert.deepEqual(unionOf(st, "ExecState"), [...ENGINE.execution].sort());
  assert.deepEqual(unionOf(st, "SettlementState"), [...ENGINE.settlement].sort());
  assert.deepEqual(unionOf(st, "SettlementScope"), [...ENGINE.settlementScope].sort());
  assert.deepEqual(unionOf(st, "ReconState"), [...ENGINE.reconciliation].sort());
  assert.match(st, /st-exec/); assert.match(st, /st-settlement/); assert.match(st, /st-recon/);
});

test("pre-engine status names are gone everywhere", () => {
  // lib/investigations.ts is generated from the engine; its prose (e.g. "not yet reconciled to a statement") is the engine's own.
  const files = [...sources.filter(f => !f.endsWith("investigations.ts")), "../docs/design/DESIGN_SYSTEM.md", "README.md"];
  for (const f of files) {
    const s = fs.readFileSync(path.resolve(root, f), "utf8");
    for (const re of [/settlement_evidence_verified/, /\bunreconciled\b/, /\breconciled\b/, /st-evidence/, /EvidenceStatus/, /\bev-(none|provider)/])
      assert.equal(re.test(s), false, f + " still contains " + re);
  }
  // The old fictional reconciliation line from the legacy prototype must not reappear.
  for (const f of copySources) assert.equal(/INV-2026-008|SGD 148\.93/.test(read(f)), false, f);
});

test("Developers page documents the v1 engine API, three status fields and limitations", () => {
  const dev = read("app/developers/page.tsx");
  assert.match(dev, /"\/api\/clearline\/test\/v1"/);
  for (const ep of ["/intents", "/intents/{intentId}/quotes", "/instructions/{id}/approve", "/events/simulate", "/events/webhook", "/webhooks/verify",
    "/reconciliation/statement-lines", "/exceptions", "/liquidity", "/funding-advances", "/repayments", "/investigations/{intentId}"]) assert.ok(dev.includes(ep), ep);
  for (const t of ["execution", "settlement", "settlementScope", "reconciliation", "provider_reported_completed", "pending_finality", "partially_matched", "not_started", "bank_statement", "Idempotency-Key", "persisted"]) assert.ok(dev.includes(t), t);
  assert.match(dev, /beneficiary&rsquo;s credit can still be unknown/);
  for (const t of ["Quickstart", "Webhooks", "Limitations", "No persistence", "Sandbox only"]) assert.ok(dev.includes(t), t);
  assert.equal(/"\/api\/clearline\/test"\s*;/.test(dev), false, "legacy unversioned base must not be the quickstart base");
});

test("Funding Desk is described as a tested projection, not a shared ledger or an unlinked prototype", () => {
  const all = copySources.map(read).join("\n");
  assert.equal(/not yet linked to Connect|does not share records with Connect|not yet share persisted records/.test(all), false);
  assert.match(read("lib/sample.ts"), /Not a shared production ledger/);
  for (const f of ["app/control/page.tsx", "app/use-cases/page.tsx", "app/platform/page.tsx"]) assert.match(read(f), /projection/, f);
  assert.match(read("app/control/page.tsx"), /not a shared production ledger/);
});

test("sample data is derived from the engine's s1–s5 scenarios", () => {
  const s = read("lib/sample.ts");
  for (const sc of ["s1_success", "s2_returned", "s3_hold", "s4_chain", "s5_funding"]) assert.ok(s.includes(`"${sc}"`), sc);
  assert.match(s, /src\/lib\/clearline\/sample\.ts/);
  assert.equal(/core\.ts/.test(s), false, "sample must not be derived from the legacy core.ts");
  for (const v of ["SGD 24,651.37", "USD 12,784.90", "SGD 8,839.50", "USDC 6,427.830000", "SGD 50,000.00", "SGD 30,000.00", "SGD 20,000.00", "RPY-SEABRIGHT-0001", "RC_AMOUNT_ONLY_CANDIDATES", "Indicative sandbox quote — not executable"]) assert.ok(s.includes(v), v);
});

test("design tokens are exported for the console and used by the site", () => {
  const tokens = read("app/tokens.css");
  for (const hex of ["#101827", "#376BEB", "#FFFFFF", "#F8FAFC", "#DCE7FF", "#64748B", "#17212D"]) assert.ok(tokens.includes(hex), hex);
  assert.match(read("app/layout.tsx"), /import "\.\/tokens\.css"/);
  assert.ok(fs.existsSync(path.resolve(root, "../docs/design/DESIGN_SYSTEM.md")), "DESIGN_SYSTEM.md missing");
});

test("returns match engine CHANGE 2: reconciliation exception + returnStatus; exceptions carry due dates", () => {
  const s = read("lib/sample.ts");
  const s2 = s.slice(s.indexOf('scenario: "s2_returned"'), s.indexOf('scenario: "s3_hold"'));
  assert.match(s2, /reconciliation: "exception"/, "a provider-reported return is a reconciliation exception");
  assert.match(s2, /returnStatus: "confirmed_by_statement"/);
  assert.equal(/reconciliation: "pending"/.test(s2), false, "s2 must no longer be pending");
  assert.match(s, /returnStatus\?: "provider_reported" \| "confirmed_by_statement"/);
  for (const d of ["2026-11-13", "2026-11-15", "2026-11-17"]) assert.ok(s.includes(`dueDate: "${d}"`), d);
  const uc = read("app/use-cases/page.tsx");
  assert.match(uc, /<ReconStatus state="exception" \/> <span className="caption mono">returnStatus: confirmed_by_statement/);
  assert.equal(/ExecStatus state="returned" \/> <SettlementStatus state="none" \/> <ReconStatus state="pending"/.test(uc), false);
  const dev = read("app/developers/page.tsx");
  for (const t of ["returnStatus", "provider_reported", "confirmed_by_statement", "returned_payout", "dueDate"]) assert.ok(dev.includes(t), t);
  assert.match(read("app/control/page.tsx"), /<ExceptionsTable \/>/);
  assert.match(read("../docs/design/DESIGN_SYSTEM.md"), /returnStatus/);
});

test("OpenAPI link derives from PRODUCT_DEMO_URL; legacy test endpoints are not linked; maker-checker caveat present", () => {
  assert.match(read("lib/site.ts"), /OPENAPI_URL = PRODUCT_DEMO_URL \+ "\/clearline\/docs\/openapi\.yaml"/);
  const dev = read("app/developers/page.tsx");
  assert.ok((dev.match(/href=\{OPENAPI_URL\}/g) || []).length >= 1, "Developers links the OpenAPI document");
  assert.match(dev, /workflow rule, not an authentication boundary/);
  assert.match(dev, /any caller can choose any simulated actor/);
  assert.match(dev, /nothing is stored server-side/);
  assert.match(dev, /410 endpoint_retired/);
  // No page or component may reference the retired unversioned endpoints.
  for (const f of copySources) {
    const s = read(f);
    for (const m of s.matchAll(/api\/clearline\/test(\/[A-Za-z0-9_-]+)?/g)) assert.equal(m[1], "/v1", f + " references a retired endpoint: " + m[0]);
  }
});

test("engine CHANGE 3 claims: holds, chain attribution, provider reports, cancellation, request limits", () => {
  const dev = read("app/developers/page.tsx"), control = read("app/control/page.tsx"), onchain = read("app/onchain/page.tsx");
  // Holds: precise release path, no bare "never released automatically" claim in site copy (engine-quoted text in sample.ts is allowed).
  for (const s of [dev, control]) {
    assert.match(s, /partner reports the release and the assigned (compliance )?reviewer records a release decision/);
    assert.equal(/Holds are never released automatically/.test(s), false);
  }
  // Chain: no vague "exact reference" attribution; the precise engine rule instead.
  assert.equal(/by its exact reference/.test(onchain), false);
  for (const s of [dev, onchain]) {
    assert.match(s, /USDC payout on the Base Sepolia route/);
    assert.match(s, /one (payout per transaction hash|transaction hash can evidence only one payout)/);
    assert.match(s, /reconciliation becomes (<code className="inline">)?matched(<\/code>)? only (when|if) the provider (had )?reported the same transaction hash/);
  }
  assert.match(dev, /precondition_failed/); assert.match(dev, /contradictory_evidence/);
  // Provider settlement reports never reconcile on their own.
  assert.match(dev, /never allocated and never reconciles on its own/); assert.match(dev, /RC_PROVIDER_REPORT_ONLY/);
  // No cancellation after submission.
  assert.match(dev, /only before submission \(created, quoted, approved\)/);
  // Request limits.
  for (const t of ["512 KB", "1,000 items", "32 levels"]) assert.ok(dev.includes(t), t);
});

test("sample data is fictional and labelled", () => {
  assert.match(read("lib/sample.ts"), /Fictional sample records/);
  assert.match(read("lib/sample.ts"), /Every organisation, provider, person and amount is fictional/);
  assert.match(read("components/InvestigationView.tsx"), /fictional/i);
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


// ---- v2 brand: Midnight & Electric Blue (13 Nov 2026) ----
const hexL = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = hexL(a), y = hexL(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const tokenValue = name => { const m = read("app/tokens.css").match(new RegExp("--cl-" + name + ":\\s*(#[0-9A-Fa-f]{6})")); assert.ok(m, "token --cl-" + name + " missing"); return m[1].toUpperCase(); };

test("palette: the seven approved colours are the brand tokens, with the console roles defined", () => {
  const want = { midnight: "#101827", blue: "#376BEB", white: "#FFFFFF", canvas: "#F8FAFC", ice: "#DCE7FF", slate: "#64748B", text: "#17212D" };
  for (const [k, v] of Object.entries(want)) assert.equal(tokenValue(k), v, k);
  const tokens = read("app/tokens.css");
  for (const role of ["--cl-page", "--cl-surface", "--cl-selected", "--cl-action", "--cl-link", "--cl-nav-bg", "--cl-text-secondary"]) assert.ok(tokens.includes(role + ":"), role);
  assert.match(tokens, /copies THIS FILE VERBATIM from\s+\* marketing\/app\/tokens\.css/);
  const doc = read("../docs/design/DESIGN_SYSTEM.md");
  assert.match(doc, /v2\.0 "Midnight & Electric Blue"/);
  assert.match(doc, /\*\*Superseded:\*\*.*orange-red.*green brand direction/);
});

test("old palette hexes are gone from site code", () => {
  const files = [...sources, "app/icon.svg", "tailwind.config.ts", "README.md", ...walk("tests").filter(f => !f.endsWith("content.test.mjs"))];
  for (const f of files) {
    const s = read(f).toUpperCase();
    for (const hex of ["#D04B31", "#A93A24", "#B33D28", "#F5F1E8", "#F08A6E", "#E6EDF0"]) assert.equal(s.includes(hex), false, f + " still uses " + hex);
  }
  for (const v of ["--cl-ivory", "--cl-signal", "--cl-bluegrey", "--cl-ink"]) for (const f of sources) assert.equal(read(f).includes(v + ")") || read(f).includes(v + ":"), false, f + " uses retired token " + v);
});

test("no raw colours outside the token file (OG image excepted: it cannot read CSS variables)", () => {
  for (const f of sources.filter(f => !f.endsWith("tokens.css") && !f.endsWith("opengraph-image.tsx") && !f.endsWith("layout.tsx")))
    assert.equal(/#[0-9A-Fa-f]{6}\b/.test(read(f).replace(/^\s*\/\/.*$/gm, "")), false, f + " has a raw hex colour; use a token");
});

test("contrast: every documented pairing is computed correctly, and allowed pairs meet WCAG", () => {
  const doc = read("../docs/design/DESIGN_SYSTEM.md");
  const rows = [...doc.matchAll(/^\| ([^|]*#[0-9A-F]{6}[^|]*) \| ([^|]+) \| ([\d.]+):1 \| ([^|]+) \| ([^|]+) \|$/gm)];
  assert.ok(rows.length >= 30, "contrast table has " + rows.length + " rows");
  const named = { White: "#FFFFFF", "Off-white": "#F8FAFC", Ice: "#DCE7FF", Midnight: "#101827", "Midnight-2": "#1A2436" };
  for (const [, fg, bg, documented, needs, result] of rows) {
    const f = fg.match(/#[0-9A-F]{6}/)[0];
    const b = (bg.match(/#[0-9A-F]{6}/) || [named[bg.trim()]])[0];
    assert.ok(b, "unknown background " + bg);
    const r = Math.floor(ratio(f, b) * 100) / 100;
    assert.equal(r.toFixed(2), documented, fg + " on " + bg);
    const need = parseFloat(needs);
    if (!Number.isNaN(need)) assert.equal(ratio(f, b) >= need ? "pass" : "**fail**", result.trim(), fg + " on " + bg);
  }
  // The pairs the brief names explicitly, and their accessible variants.
  for (const pair of ["Slate #64748B | Off-white", "Electric Blue #376BEB (text) | White", "Electric Blue #376BEB (text) | Midnight", "White (button label) | Electric Blue #376BEB", "Blue-text #2F5BD0 | Off-white", "Blue-on-midnight #8FB0FF | Midnight", "Slate-strong #4F5D73 | Ice"])
    assert.ok(doc.includes("| " + pair + " |"), "contrast row missing: " + pair);
  // Live checks on the token values the site actually uses for text.
  const T = tokenValue;
  assert.ok(ratio(T("on-midnight"), T("blue")) >= 4.5, "white on Electric Blue");
  assert.ok(ratio(T("blue-text"), T("canvas")) >= 4.5 && ratio(T("blue-text"), T("ice")) >= 4.5, "link blue");
  assert.ok(ratio(T("blue-on-midnight"), T("midnight")) >= 4.5, "blue on midnight");
  assert.ok(ratio(T("slate"), T("canvas")) >= 4.5 && ratio(T("slate-strong"), T("ice")) >= 4.5, "secondary text");
  assert.ok(ratio(T("on-midnight-muted"), T("midnight")) >= 4.5 && ratio(T("on-midnight-muted"), T("midnight-2")) >= 4.5, "muted on midnight");
  assert.ok(ratio(T("blue"), T("canvas")) < 4.5, "Electric Blue on canvas is documented as failing; keep it out of text");
  for (const t of ["success", "warning", "danger", "info", "neutral"]) {
    assert.ok(ratio(T(t), T(t + "-bg")) >= 4.5, t + " on tint"); assert.ok(ratio(T(t), "#FFFFFF") >= 4.5, t + " on white");
  }
  for (const [fg, bg] of [["focus", "white"], ["focus", "canvas"], ["focus", "ice"], ["focus-on-midnight", "midnight"], ["line-strong", "white"], ["line-strong", "canvas"], ["midnight-control", "midnight"]])
    assert.ok(ratio(T(fg), T(bg)) >= 3, fg + " on " + bg + " (non-text 3:1)");
  // Electric Blue is never used as a text colour in site CSS (only fills, borders and focus).
  const css = read("app/globals.css");
  assert.equal(/(^|[;{\s])color:\s*var\(--cl-(blue|action|focus)\)/m.test(css), false, "Electric Blue used as text colour");
});

test("semantic financial colours: provider claims are never green or blue; green only for evidence", () => {
  const st = read("components/Status.tsx");
  const tone = (map, key) => { const m = st.match(new RegExp("const " + map + "[^=]*= \\{([\\s\\S]*?)\\};")); assert.ok(m, map); const t = m[1].match(new RegExp("\\b" + key + ': "([a-z]+)"')); assert.ok(t, map + "." + key); return t[1]; };
  for (const k of ["submitted", "in_transit", "provider_reported_completed"]) assert.equal(tone("execTone", k), "neutral", k);
  for (const k of ["failed", "returned"]) assert.equal(tone("execTone", k), "danger", k);
  for (const k of ["awaiting_information", "on_hold"]) assert.equal(tone("execTone", k), "warning", k);
  assert.equal(tone("settlementTone", "verified"), "success");
  for (const k of ["observed", "pending_finality"]) assert.equal(tone("settlementTone", k), "warning", k);
  assert.equal(tone("settlementTone", "contradicted"), "danger");
  assert.equal(tone("reconTone", "matched"), "success"); assert.equal(tone("reconTone", "exception"), "danger");
  assert.equal(/tone-info|"info"/.test(st.replace(/Tone \| "info"/, "")), false, "no status uses the info (blue) tone");
  // Human label first, exact API value as secondary detail.
    assert.match(st, /className="st-api"/);
});

test("homepage: approved hero, CTAs, investigation view from the sample records, and required sections", () => {
  const home = read("app/page.tsx");
  assert.match(home, /Every payment\. <em>One clear answer\.<\/em>/);
  assert.match(home, /Clearline connects payment instructions, provider events and financial evidence&mdash;so operations teams can understand what happened and what needs attention\./);
  assert.match(home, /<ButtonLink href=\{TRIAL_URL\} main>Explore Clearline<\/ButtonLink>/);
  assert.match(home, /mailto\("A payment problem"\)\} variant="secondary" onMidnight>Talk about a payment problem/);
  assert.match(home, /Booking link pending/);
  assert.match(home, /<InvestigationView \/>/);
  const iv = read("components/InvestigationView.tsx");
  assert.match(iv, /from "@\/lib\/investigations"/); assert.equal(/<img|\.png|\.jpg/.test(iv), false, "investigation view is HTML, not an image");
  for (const t of ["Execution", "Settlement evidence", "Reconciliation", "is-hl"]) assert.ok(iv.includes(t), t);
  for (const id of ["story-title", "products-title", "together", "cases-title", "stage-title", "founder-title", "contact-title"]) assert.ok(home.includes(`id="${id}"`), id);
  assert.match(home, /<Disclosure headingId="home-disclosure" \/>/);
  assert.match(home, /19, in her second year of Accountancy at Singapore Management University, with a second major in Finance/);
});

test("engine CHANGE 5: under-amount reports, reports on terminal payouts and partial bank lines are described exactly", () => {
  const dev = read("app/developers/page.tsx"), control = read("app/control/page.tsx"), uc = read("app/use-cases/page.tsx");
  // F2: under-amount provider report → unmatched_reconciliation / RC_UNDER_AMOUNT_REPORT, reconciliation exception, settlement not upgraded.
  for (const s of [dev, control]) {
    assert.match(s, /RC_UNDER_AMOUNT_REPORT/); assert.match(s, /unmatched_reconciliation/);
    assert.match(s, /settlement is not upgraded/);
    assert.match(s, /RC_REPORT_ON_TERMINAL_PAYOUT/); assert.match(s, /contradictory_evidence/);
    assert.match(s, /failed, cancelled, expired or returned|<code className="inline">failed<\/code>, <code className="inline">cancelled<\/code>, <code className="inline">expired<\/code> or <code className="inline">returned<\/code>/);
    assert.match(s, /settlement (and scope are|is left) unchanged/);
    assert.match(s, /RC_PARTIAL_AMOUNT/);
    assert.match(s, /<AmountDifferenceTable \/>/);
  }
  assert.match(dev, /expectedMinor, reportedMinor, differenceMinor, currency, source, statementLineId, requiredNextAction/);
  assert.match(dev, /investigate\(\)\.amountDifferences/);
  assert.match(dev, /exception_raised/); assert.match(dev, /contradictory_exception_raised/);
  assert.match(dev, /supplierPaidBasis/); assert.match(dev, /ENGINE_LABELS\.advanceState\.supplier_paid/);
  assert.match(uc, /RC_UNDER_AMOUNT_REPORT/); assert.match(uc, /RC_REPORT_ON_TERMINAL_PAYOUT/);
  // The six engine rules now live on Platform (#rules).
  const platform = read("app/platform/page.tsx");
  assert.match(platform, /RC_UNDER_AMOUNT_REPORT/); assert.match(platform, /RC_PARTIAL_AMOUNT/); assert.match(platform, /RC_REPORT_ON_TERMINAL_PAYOUT/);
  // The structured difference uses the engine's own F2 wording and arithmetic.
  const s = read("lib/sample.ts");
  assert.match(s, /expected: "SGD 10,000\.00", reported: "SGD 4,000\.00", difference: "SGD 6,000\.00"/);
  assert.match(s, /Ask the provider to explain the SGD 6,000\.00 shortfall \(fees, partial settlement or a further report\) and obtain the bank statement line for the payout\. Do not treat the payout as settled until the full amount is evidenced\./);
  assert.match(s, /supplierPaidBasis: "verified_settlement"/);
  // Never claim a short report settles or reconciles.
  for (const f of copySources) assert.equal(/under-amount[^.]*\b(matched|verified|settled in full)\b/i.test(read(f)), false, f);
  const doc = read("../docs/design/DESIGN_SYSTEM.md");
  for (const t of ["RC_UNDER_AMOUNT_REPORT", "RC_REPORT_ON_TERMINAL_PAYOUT", "amountDifference", "supplierPaidBasis"]) assert.ok(doc.includes(t), t);
});

test("status labels are the engine's exact HUMAN_LABELS strings (labels.ts @ 0490e40)", () => {
  const st = read("components/Status.tsx");
  const map = name => { const m = st.match(new RegExp("export const " + name + "[^=]*= \\{([\\s\\S]*?)\\};")); assert.ok(m, name); return Object.fromEntries([...m[1].matchAll(/([a-z_]+): "([^"]*)"/g)].map(x => [x[1], x[2]])); };
  assert.deepEqual(map("EXEC_LABEL"), { created: "Created", quoted: "Quoted", approved: "Approved — not yet sent", submitted: "Sent to provider", in_transit: "Provider reports in transit", provider_reported_completed: "Provider reports completed", awaiting_information: "Provider requests information", on_hold: "On hold with the partner", failed: "Provider reports failed", returned: "Provider reports returned", cancelled: "Cancelled", expired: "Expired" });
  assert.deepEqual(map("SETTLEMENT_LABEL"), { none: "No settlement evidence", observed: "Settlement observed (not verified)", pending_finality: "Awaiting finality", verified: "Settlement verified", contradicted: "Settlement evidence contradicted" });
  assert.deepEqual(map("SCOPE_LABEL"), { none: "No evidence", provider_report: "Provider report only", bank_statement: "Bank statement", onchain_transfer: "On-chain transfer (synthetic testnet)" });
  assert.deepEqual(map("RECON_LABEL"), { not_started: "Not started", pending: "Awaiting statement", matched: "Matched", partially_matched: "Partially matched", exception: "Needs review" });
  // Same summary shape as the engine's describeStatus: "Settlement verified (Bank statement)".
  assert.match(st, /\{SETTLEMENT_LABEL\[state\]\}\{sc && <> \(\{SCOPE_LABEL\[sc\]\}\)<\/>\}/);
  const doc = read("../docs/design/DESIGN_SYSTEM.md");
  for (const l of ["Approved — not yet sent", "Settlement observed (not verified)", "Needs review", "Awaiting statement", "On-chain transfer (synthetic testnet)", "Supplier paid (provider-reported)"]) assert.ok(doc.includes(l), l);
});

test("no banned claims (content-marketer list) in site copy", () => {
  for (const f of copySources) {
    const s = read(f).toLowerCase();
    for (const p of ["soc 2", "soc2", "compliant", "posts automatically", "integrates with", "zero errors", "zero false", "free trial", "for free", "bank-grade", "military-grade", "instant settlement", "seamless"]) assert.equal(s.includes(p), false, f + " contains " + p);
  }
});

test("internal links resolve to a built route or an in-page anchor", () => {
  const routes = new Set(ROUTE_PATHS());
  for (const f of copySources) {
    for (const m of read(f).matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)) assert.ok(routes.has(m[1] === "" ? "/" : m[1]) || m[1] === "/replay", f + " links to unknown route " + m[1]);
  }
  for (const m of read("app/page.tsx").matchAll(/href="\/trial#([a-z-]+)"/g)) assert.match(read("app/trial/page.tsx"), new RegExp('id="' + m[1] + '"'));
  assert.match(read("app/privacy/page.tsx"), /href="\/trial#historical"/); assert.match(read("app/trial/page.tsx"), /id="historical"/);
});
function ROUTE_PATHS() { return [...read("lib/site.ts").matchAll(/path: "([^"]+)"/g)].map(m => m[1]); }

test("release URLs: clearline-release.json resolves production by default and the paired software preview on rc3 previews", async () => {
  const { resolveReleaseUrls, loadRelease } = await import("../release-urls.mjs");
  const release = loadRelease(new URL("../clearline-release.json", import.meta.url));
  assert.equal(resolveReleaseUrls({}, release).product, release.production.product);
  assert.equal(resolveReleaseUrls({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "rc3/clearline-site" }, release).product, release.preview.product);
  assert.equal(resolveReleaseUrls({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "other" }, release).product, release.production.product);
  assert.throws(() => resolveReleaseUrls({ CLEARLINE_PRODUCT_URL: "http://insecure.test" }, release));
});

// ---- rc3: accuracy guards, disclosure, founder facts, links (13 Nov 2026) ----
const walkAll = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(d =>
  ["node_modules", ".next", "out", ".git"].includes(d.name) ? [] : d.isDirectory() ? walkAll(path.join(dir, d.name)) : [path.join(dir, d.name)]);

test("rc3 accuracy: no copy describes an unbuilt capability as working", () => {
  const forbidden = [
    /\b(executes?|sends?|moves?) (real |live )?(money|funds|payouts?) (for|on behalf of)/i, /\bwe (hold|safeguard|custody) (your |client |customer )?(funds|money|assets)\b/i, /\bnon-custodial wallet\b/i,
    /connected to (your|real|licensed) (bank|provider|wallet)s?(?! is)/i, /\bconnects to (your|real) bank/i, /\bintegrat(ed|es) with (banks?|providers?|wallets?)\b/i,
    /\blicensed (by|under)\b/i, /\b(certified|accredited|approved by MAS|regulated by)\b/i, /\bin use (at|by)\b/i, /\bour (customers|clients|partners)\b/i,
    /\bused by\b/i, /\bpartnered with\b/i, /\bpilot customers?\b/i, /\breal chain reads? (are|is) (live|working|available)/i,
    /\bmakes? (the )?compliance decisions? for\b/i, /\bapproves? (the )?credit\b/i, /\bautomatically (releases?|clears?|approves?)\b/i, /\bauto-(release|clear|approve)/i,
    /\bin development on testnet\b/i, /real chain reads in development/i,
    /Funding Desk (is|as) a (separate|standalone|second) product/i,
  ];
  for (const f of copySources) {
    const s = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // copy only, not code comments
    for (const re of forbidden) assert.equal(re.test(s), false, f + " matches forbidden claim " + re);
  }
  // Onchain items with no code are labelled design only; nothing on Onchain uses an "in development" stage.
  const onchain = read("app/onchain/page.tsx");
  assert.match(onchain, /Safe payout proposals and evidence fingerprints are a design only: no code exists for them/);
  assert.equal(/kind="development"|"development"/.test(onchain), false);
  // The removed stage kinds do not come back.
  const shared = read("components/Shared.tsx");
  assert.match(shared, /export type StageKind = "synthetic" \| "prototype" \| "design" \| "none";/);
  for (const f of copySources) assert.equal(/kind="(illustrative|development)"|"illustrative"\]|Illustrative UI/.test(read(f)), false, f);
});

test("rc3 disclosure: one source, precise working / not built / out of scope, shown on Home, Platform and Trial", () => {
  const d = read("lib/disclosure.ts");
  for (const t of ["WORKING_TODAY", "NOT_BUILT", "OUT_OF_SCOPE"]) assert.match(d, new RegExp("export const " + t));
  for (const t of ["No licensed provider, bank or wallet is connected", "No real chain is read", "No user accounts, authentication or server-side storage", "Safe payout proposals and evidence fingerprints are a design only", "Uploads are disabled"]) assert.ok(d.includes(t), t);
  const scope = d.match(/OUT_OF_SCOPE = "([^"]+)"/)[1];
  for (const t of ["payouts with real money", "hold funds or keys", "real banking or wallet credentials", "lend", "credit decisions", "compliance decisions"]) assert.ok(scope.includes(t), "out of scope lacks " + t);
  for (const f of ["app/page.tsx", "app/platform/page.tsx", "app/trial/page.tsx"]) assert.match(read(f), /<Disclosure headingId="[a-z-]+" \/>/, f);
  assert.match(read("components/Shared.tsx"), /WORKING_TODAY\.map/);
});

test("rc3 product view is generated from the tested engine and uses the console's labels", () => {
  const inv = read("lib/investigations.ts");
  assert.match(inv, /^\/\* GENERATED by scripts\/engine-investigations\.gen\.ts/);
  assert.match(inv, /rc3\/clearline-app @ [0-9a-f]{7}/);
  const data = JSON.parse(inv.slice(inv.indexOf("INVESTIGATIONS: Investigation[] = ") + 34, inv.lastIndexOf(";")));
  assert.deepEqual(data.map(d => d.scenario), ["s1_success", "s2_returned", "s3_hold", "s4_chain", "s5_funding"]);
  // The generated statuses agree with the hand-kept sample tables.
  const sample = read("lib/sample.ts");
  for (const d of data) {
    const block = sample.slice(sample.indexOf(`scenario: "${d.scenario}", reference`));
    for (const k of ["execution", "settlement", "settlementScope", "reconciliation"]) assert.ok(block.slice(0, 900).includes(`${k}: "${d.status[k]}"`), d.scenario + " " + k);
    assert.ok(sample.includes(d.amount), d.amount);
  }
  // Engine summaries (describeStatus), as of rc3/clearline-app 338861c.
  assert.equal(data[1].summary, "Provider reports returned · Settlement evidence contradicted (Bank statement) · Needs review");
  // Console section names and truth questions (pages/Investigation.tsx).
  const iv = read("components/InvestigationView.tsx");
  for (const t of ["Three separate truths — never one badge", "What the provider reported", "What independent evidence establishes", "Whether the records match", "Evidence timeline", "Findings", "Who owns the next step", "Still unknown", "Financially outstanding", "Console <span"]) assert.ok(iv.includes(t), t);
  assert.equal(/from "@\/lib\/sample"/.test(iv), false);
});

test("rc3 trial cases follow the console's guided trial", () => {
  const c = read("lib/cases.ts");
  const titles = [...c.slice(c.indexOf("TRIAL_CASES"), c.indexOf("TRY_CONNECT")).matchAll(/title: "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(titles, ["Successful payment", "Returned payout", "Compliance hold", "Base Sepolia finality delay", "Funding exposure"]);
  assert.match(c, /Try your own payment|Then try Connect/);
});

test("rc3 Funding Desk: Control's specialist workflow, linked through FUNDING_DESK_URL", () => {
  assert.match(read("lib/site.ts"), /FUNDING_DESK_URL = PRODUCT_DEMO_URL \+ "\/mentor-demo"/);
  const control = read("app/control/page.tsx");
  assert.match(control, /id="funding-desk"/); assert.match(control, /a specialist workflow in Control/);
  assert.match(control, /not a separate product/); assert.match(control, /href=\{FUNDING_DESK_URL\}/);
  for (const f of copySources) assert.equal(/mentor-demo/.test(read(f)) && !f.endsWith("site.ts"), false, f + " hard-codes the Funding Desk path");
});

test("rc3 founder facts: exact, modest, and the photo is never upscaled", () => {
  const about = read("app/about/page.tsx"), home = read("app/page.tsx");
  assert.match(about, /I&rsquo;m 19 and in my second year of Accountancy at Singapore Management University, with a second major in Finance\. I&rsquo;m building Clearline in Singapore\./);
  assert.match(home, /19, in her second year of Accountancy at Singapore Management University, with a second major in Finance\. Building Clearline in Singapore\./);
  for (const s of [about, home]) assert.equal(/years? of experience|former|ex-|serial|award|CPA|CFA|Forbes/i.test(s.replace(/@\/|ExtLink/g, "")), false);
  // public/founder.jpg is 120 × 150; no <img> or CSS shows it larger.
  for (const f of copySources) for (const m of read(f).matchAll(/founder\.jpg"[^>]*width=\{(\d+)\} height=\{(\d+)\}/g)) assert.ok(+m[1] <= 120 && +m[2] <= 150, f + " displays the photo at " + m[1] + "×" + m[2]);
  assert.match(read("app/globals.css"), /\.founder-photo \{ width: 120px; height: 150px;/);
});

test("rc3 contact: a working mailto to the founder, no invented booking URL, no data collection", () => {
  assert.match(read("lib/site.ts"), /mailto = \(subject: string\) => "mailto:" \+ EMAIL \+ "\?subject=" \+ encodeURIComponent\(subject\)/);
  for (const f of ["app/page.tsx", "app/contact/page.tsx", "app/about/page.tsx", "components/Shared.tsx"]) assert.match(read(f), /mailto\(/, f);
  assert.match(read("lib/site.ts"), /BOOKING_URL: string \| undefined = envBooking && envBooking\.startsWith\("https:\/\/"\) \? envBooking : undefined/);
  for (const f of copySources) assert.equal(/calendly\.com|cal\.com\/|savvycal|zcal/i.test(read(f)), false, f + " invents a booking URL");
  for (const f of ["app/contact/page.tsx", "app/page.tsx", "app/privacy/page.tsx"]) assert.match(read(f), /(Do not|do not|Never) send payment records/, f);
});

test("rc3 links: no Vercel host outside lib/site.ts and the release files", () => {
  const allowed = new Set([path.join("lib", "site.ts"), "clearline-release.json", "release-urls.mjs", path.join("tests", "content.test.mjs")]);
  for (const f of walkAll(".").map(f => path.normalize(f)).filter(f => !allowed.has(f) && !/\.(jpg|png|ico|tsbuildinfo)$/.test(f) && f !== "package-lock.json")) {
    assert.equal(/vercel\.app/.test(read(f)), false, f + " hard-codes a vercel.app host");
  }
  assert.equal(/vercel\.app/.test(fs.readFileSync(path.resolve(root, "../docs/design/DESIGN_SYSTEM.md"), "utf8")), false, "DESIGN_SYSTEM.md");
  // Product CTAs use the derived constants only.
  for (const f of copySources) assert.equal(/href=\{?["'`]\/clearline/.test(read(f)), false, f + " links a product path without site.ts");
});

test("rc3 hero copy is exactly the approved wording", () => {
  const home = read("app/page.tsx");
  assert.match(home, /<h1 id="hero-title" className="h1">Every payment\. <em>One clear answer\.<\/em><\/h1>/);
  assert.match(home, /<p className="lede">Clearline connects payment instructions, provider events and financial evidence&mdash;so operations teams can understand what happened and what needs attention\.<\/p>/);
  assert.match(read("app/layout.tsx"), /"Clearline \| Every payment\. One clear answer\."/);
});

test("rc3 every page is present, built (when out/ exists) and reachable from the header or footer", () => {
  const nav = read("components/Header.tsx") + read("components/Shared.tsx");
  for (const [route, file] of Object.entries(PAGES)) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
    if (route !== "/") assert.ok(nav.includes(`"${route}"`), route + " not linked from header or footer");
    if (fs.existsSync(path.join(root, "out"))) assert.ok(fs.existsSync(path.join(root, "out", route === "/" ? "index.html" : route.slice(1) + ".html")), route + " not built");
  }
  assert.equal(Object.keys(PAGES).length, 11);
});

test("rc3 no real bank, payment company or institution is named in sample data or copy (outside an explicit disclaimer)", () => {
  // Case-sensitive brand names, word-bounded, so ordinary words ("otherwise", "a filled circle") do not match.
  const names = ["DBS", "OCBC", "UOB", "HSBC", "Citi", "Citibank", "Citigroup", "JPMorgan", "J.P. Morgan", "JP Morgan", "Chase", "Standard Chartered", "StanChart",
    "Maybank", "CIMB", "Barclays", "Deutsche Bank", "Bank of America", "Wells Fargo", "BNP Paribas", "Santander", "Goldman Sachs", "Morgan Stanley", "Bank of China",
    "ICBC", "Mizuho", "MUFG", "SMBC", "Revolut", "Wise", "Airwallex", "Payoneer", "Stripe", "Adyen", "Nium", "Thunes", "Rapyd", "Visa", "Mastercard", "SWIFT",
    "Fireblocks", "Circle Internet", "Coinbase", "Binance", "Paxos", "MAS", "Monetary Authority"];
  const re = new RegExp("(^|[^A-Za-z])(" + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![A-Za-z])");
  // An explicit disclaimer on the same line ("not a real bank", "no real bank is named") is the only exception.
  const disclaimer = /not a real (bank|institution|company)|no real (bank|institution) is named/i;
  const data = ["lib/sample.ts", "lib/investigations.ts", "lib/cases.ts", "lib/disclosure.ts"];
  for (const f of [...new Set([...data, ...copySources])]) {
    read(f).split("\n").forEach((line, i) => {
      const m = line.match(re);
      if (m && !disclaimer.test(line)) assert.fail(`${f}:${i + 1} names a real institution ("${m[2]}"): ${line.trim().slice(0, 120)}`);
    });
  }
  // The engine's fictional statement line ids are used, not the retired bank-named ones.
  assert.match(read("lib/sample.ts"), /SIMBANK-0001/); assert.match(read("lib/investigations.ts"), /SIMBANK-0002/);
  // Self-check: the guard does catch a real name.
  assert.ok(re.test("Debit SGD 1.00 · DBS-SIM-0001") && re.test("via HSBC") && !re.test("otherwise a filled circle"));
});

test("rc3 return position: net zero and beneficiary unpaid are stated in the engine's own words, never merged", () => {
  const inv = read("lib/investigations.ts");
  const data = JSON.parse(inv.slice(inv.indexOf("INVESTIGATIONS: Investigation[] = ") + 34, inv.lastIndexOf(";")));
  const s2 = data.find(d => d.scenario === "s2_returned");
  // The engine (rc3/clearline-app 338861c+) demonstrates net zero on the sample return: debit SIMBANK-0002, return credit SIMBANK-0006.
  assert.equal(s2.returnStatusText, "Return confirmed on the statement");
  assert.deepEqual({ code: s2.returnPosition.code, zero: s2.returnPosition.netMovementZero, paid: s2.returnPosition.beneficiaryPaid }, { code: "RT_NET_ZERO", zero: true, paid: false });
  const ENGINE_TEXT = "The debit and the return credit (USD 12,784.90 each) net to zero on the statement. The beneficiary was not paid.";
  assert.equal(s2.returnPosition.text, ENGINE_TEXT);
  assert.deepEqual(s2.status, { execution: "returned", settlement: "contradicted", settlementScope: "bank_statement", reconciliation: "exception" });
  assert.match(read("components/InvestigationView.tsx"), /p\.returnPosition\.text/);
  // Control quotes the engine's sentence exactly (as HTML entities for the quotes).
  assert.ok(read("app/control/page.tsx").includes("&ldquo;" + ENGINE_TEXT + "&rdquo;"), "Control must quote the engine's return-position text");
  // Wherever copy says net zero, it also says the beneficiary/supplier was not paid in the same sentence or the next.
  for (const f of copySources.filter(f => !f.endsWith("investigations.ts"))) {
    const s = read(f);
    for (const m of s.matchAll(/net (movement )?(is |ends at |to )?zero/gi)) {
      const around = s.slice(Math.max(0, m.index - 200), m.index + 260);
      assert.match(around, /(beneficiary|supplier)[^.]{0,40}(not|never|unpaid|was never)|unpaid|not paid/i, f + ": net zero stated without 'beneficiary not paid': " + around.replace(/\s+/g, " ").slice(0, 160));
    }
  }
  // The homepage story and the sample tables follow the new statement: debit SIMBANK-0002, then return credit SIMBANK-0006.
  const sample = read("lib/sample.ts");
  assert.match(sample, /lineId: "SIMBANK-0002", direction: "debit"/); assert.match(sample, /lineId: "SIMBANK-0006", direction: "credit", kind: "return"/);
  assert.match(read("app/page.tsx"), /One payout\. Five messages\./);
});

test("rc3 console features shipped at 7e521f5 are disclosed exactly, as console features with no v1 endpoint", () => {
  const d = read("lib/disclosure.ts");
  const working = d.slice(d.indexOf("WORKING_TODAY"), d.indexOf("NOT_BUILT"));
  for (const t of [
    "view the engine's synthetic case report in place, marked fictional, and download it as JSON or CSV",
    "Reset one guided case to its starting state, leaving the other cases and anything you created untouched; it refuses, with the reason, if one of your records depends on that case. The whole workspace can also be reset.",
    "Filter and search Payments, Investigations and Exceptions, with the filters kept in the URL, and assign owners to exceptions and cases through the engine.",
    'Every switch is labelled \\"Simulated role — not sign-in or access control\\".',
    "open the Funding Desk workflow from Treasury & Funding",
    "The case report and the per-case reset are console features; no v1 endpoint exposes them.",
  ]) assert.ok(working.includes(t), "disclosure lacks: " + t);
  // Nothing claims an API for them.
  for (const f of copySources) {
    const s = read(f);
    assert.equal(/(GET|POST) [^\s<]*(report|reset)/i.test(s), false, f + " claims an API endpoint for the case report or reset");
    assert.equal(/(api|endpoint)[^.]{0,40}(exposes|returns|provides) the (case report|per-case reset)/i.test(s), false, f);
  }
  // Trial and Developers say they are console-only.
  assert.match(read("app/trial/page.tsx"), /The v1 test API does not expose them\./);
  assert.match(read("app/trial/page.tsx"), /CONSOLE_TOOLS\.map/);
  assert.match(read("app/developers/page.tsx"), /Console only, not in the API: the synthetic case report \(JSON or CSV, marked fictional\), the per-case reset/);
  const cases = read("lib/cases.ts");
  for (const t of ["Case report", "Reset one case", "Simulated roles", "Simulated role — not sign-in or access control"]) assert.ok(cases.includes(t), t);
  // Workspace repair is not described as shipped.
  for (const f of copySources) assert.equal(/repair(s|ed)? (your|saved|old) workspace/i.test(read(f)), false, f);
});

test("rc3 exceptions: due dates are set at creation, owners are assigned by a person (QA L3)", () => {
  // The engine creates exceptions unassigned (exceptions.ts openException: ownerId only if given; dueDate = explicit or
  // creation date + EXCEPTION_DUE_DAYS); resolving needs an owner (OWNER_REQUIRED). 2 of the 4 sample exceptions have none.
  const claims = [/(exception|disagreement)s? (gets?|has|have|with|carr(y|ies)) an owner/i, /with an owner and a due ?date/i, /each with an owner/i,
    /every (exception|disagreement)[^.]{0,40}\bowner\b(?![^.]{0,60}(assign|person))/i, /exceptions? with (its|their) owner and due/i, /turns disagreements into exceptions with an owner/i];
  for (const f of [...copySources.filter(f => !f.endsWith("investigations.ts")), "../docs/design/DESIGN_SYSTEM.md"]) {
    const s = read(f);
    for (const re of claims) assert.equal(re.test(s), false, f + " claims exceptions are created with an owner: " + re);
  }
  // The sample shows the truth: some exceptions unassigned.
  const sample = read("lib/sample.ts");
  const ex = sample.slice(sample.indexOf("export const SAMPLE_EXCEPTIONS"));
  assert.equal((ex.match(/owner: "Unassigned"/g) || []).length, 2, "two sample exceptions are unassigned, as in the engine");
  // The correct wording is present where the claim used to be.
  assert.match(read("lib/disclosure.ts"), /anything else becomes an exception in the queue with a due date set by severity, and a person assigns its owner\./);
  assert.match(read("app/control/page.tsx"), /The engine creates every exception with a due date: an explicit date, or the creation date plus 1 day \(critical, high\), 3 days \(medium\) or 5 days \(low\)\. It creates them unassigned\./);
  assert.match(read("app/developers/page.tsx"), /OWNER_REQUIRED/);
  assert.match(sample, /critical and high 1 day, medium 3 days, low 5 days from creation, unless a date is set explicitly/);
});

test("rc3 supplierPaidBasis and supplier_paid labels quoted on the site are the engine's exact HUMAN_LABELS (fa303fd)", () => {
  const inv = read("lib/investigations.ts");
  const labels = JSON.parse(inv.slice(inv.indexOf("ENGINE_LABELS = ") + 16, inv.indexOf(" as const;", inv.indexOf("ENGINE_LABELS = "))));
  assert.deepEqual(labels.supplierPaidBasis, {
    none: "Supplier not shown as paid",
    provider_reported: "Provider reports the supplier paid (not verified)",
    verified_settlement: "Supplier payout verified by independent evidence",
  });
  assert.equal(labels.advanceState.supplier_paid, "Supplier paid (provider-reported)");
  const allowed = new Set([...Object.values(labels.supplierPaidBasis), labels.advanceState.supplier_paid]);
  // Every literal supplier-paid label in copy or the design doc must be one of the engine's strings.
  const files = [...copySources.filter(f => !f.endsWith("investigations.ts")), "../docs/design/DESIGN_SYSTEM.md"];
  // Labels are quoted with typographic quotes in copy and the design doc; table row headers and code are not labels.
  const quoted = /(?:&ldquo;|“)((?:Supplier (?:paid|payout|not shown)|Provider reports the supplier)[^”&]*?)(?:&rdquo;|”)/g;
  for (const f of files) for (const m of read(f).matchAll(quoted)) assert.ok(allowed.has(m[1]), `${f} quotes "${m[1]}", not an engine label`);
  // Retired wordings are gone.
  for (const f of files) for (const old of ["Supplier paid (provider-reported) — not verified", "Supplier paid — provider-reported only", "Supplier paid — verified"]) assert.equal(read(f).includes(old), false, f + " still says " + old);
  // The funding table and Developers render the labels from the generated engine data, not literals.
  assert.match(read("components/Tables.tsx"), /ENGINE_LABELS\.supplierPaidBasis\[f\.supplierPaidBasis\]/);
  for (const k of ["none", "provider_reported", "verified_settlement"]) assert.match(read("app/developers/page.tsx"), new RegExp("ENGINE_LABELS\\.supplierPaidBasis\\." + k));
});

test("rc3 acceptance is described with the engine's limits and as a console step", () => {
  const d = read("lib/disclosure.ts");
  assert.ok(d.includes("an over-amount of up to 1% by one person, above 1% and up to 50% only with a second, different person's approval, or a late value date up to 60 days after submission. A currency mismatch is never accepted."));
  const dev = read("app/developers/page.tsx");
  assert.match(dev, /Accepting a disagreeing bank debit \(over-amount or late value date\) is a console step/);
  assert.match(dev, /generic <code className="inline">POST \/actions<\/code> applies any engine action, including <code className="inline">resolve<\/code> with <code className="inline">acceptDifference<\/code> and <code className="inline">approve_acceptance<\/code>/);
  for (const f of copySources) assert.equal(/accept[^.]{0,60}currency mismatch(?! is never)/i.test(read(f)), false, f);
});
