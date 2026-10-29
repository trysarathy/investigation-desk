// Builds the Clearline working paper v0.3 from paper.html.
//
//   npm install && node build.mjs
//
// Needs Playwright with Chromium (global or local). Steps: draw the figures (figures.mjs), expand the
// source markers, then print three PDFs with Chromium:
//   Clearline_Whitepaper_v0.3.pdf            clean copy
//   Clearline_Whitepaper_v0.3_review.pdf     same text, every claim labelled VERIFIED / ASSUMPTION / GUESS
//   Clearline_Executive_Summary_v0.3.pdf     page 1 on its own
//
// Markers in paper.html:
//   [[key]]          a numbered reference to REFS[key] (numbered in order of first use)
//   {{V}} {{V:path}} {{A}} {{G}}   claim labels (shown only in the review copy)
//   <!--fig:id-->    an inline hand-drawn figure from figures/id.svg
//   <!--code:id-->   a code excerpt from excerpts.mjs
//   <!--refs-->      the numbered reference list
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderFigures, loadChromium } from "./figures.mjs";
import { EXCERPTS } from "./excerpts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, ".build");

export const REFS = {
  reap: `Reap, "Stablecoin Statistics &amp; Data 2026", 14 Aug 2026, reporting BCG × Allium, McKinsey/Artemis, the BIS, DefiLlama and EY-Parthenon. https://reap.global/blog/stablecoin-statistics-2026`,
  bvp: `Bessemer Venture Partners, "Stablecoins: from DeFi primitive to global financial infrastructure", 22 Apr 2026. https://www.bvp.com/atlas/stablecoins-from-defi-primitive-to-global-financial-infrastructure`,
  poison: `Cointelegraph, "Address poisoning: copy-paste mistake leads to $50M USDT loss", 20 Dec 2025. https://cointelegraph.com/news/address-poisoning-copy-paste-mistake-50m-usdt-loss`,
  poisontx: `Etherscan, transaction 0xc0514a79…6a0f. https://etherscan.io/tx/0xc0514a795f065fce8a3e1238a1ba480e8a792d45f6431ee4ba8d800bedd86a0f`,
  gd: `Gibson Dunn, "Singapore Publishes Draft Legislation to Implement Its Stablecoin Framework", Sep 2026. https://www.gibsondunn.com/singapore-publishes-draft-legislation-to-implement-its-stablecoin-framework/`,
  hkord: `Hong Kong Government News, "Stablecoins laws effective Aug 1", 6 Jun 2025. https://www.news.gov.hk/eng/2025/06/20250606/20250606_140750_137.html`,
  hklic: `Charltons, "HKMA Issues First Stablecoin Issuer Licences", Apr 2026. https://www.charltonslaw.com/hkma-issues-first-stablecoin-issuer-licences/`,
  genius: `U.S. Government Publishing Office, Public Law 119-27, 18 Jul 2025. https://www.govinfo.gov/metadata/pkg/PLAW-119publ27/mods.xml`,
  occ: `Decrypt, "OCC finalizes GENIUS Act stablecoin rules ahead of January deadline", 21 Oct 2026. https://decrypt.co/381502/occ-finalizes-genius-act-stablecoin-rules-ahead-of-january-deadline`,
  eba: `European Banking Authority, "Asset-referenced and e-money tokens (MiCA)". https://eba.europa.eu/regulation-and-policy/asset-referenced-and-e-money-tokens-mica`,
  fsma: `FSMA (Belgium), "Crypto-asset service providers: end of the transitional period", 25 Jun 2026. https://www.fsma.be/en/news/crypto-assets-service-providers-end-transitional-period`,
  stripe: `Stripe Docs, "Stablecoin payments". https://docs.stripe.com/crypto/stablecoins`,
  bridge: `Stripe, "Stripe completes Bridge acquisition", 4 Feb 2025. https://stripe.com/us/newsroom/news/stripe-completes-bridge-acquisition`,
  hitpay: `HitPay, "Accept Crypto". https://hitpayapp.com/crypto-payment-gateway-hitpay`,
  safe: `Safe, "Safe{Wallet} gets even safer: introducing Blockaid integration", 16 Sep 2024. https://safe.global/blog/safe-wallet-gets-even-safer-introducing-blockaid-integration`,
  fireblocks: `Fireblocks Developers, "Manage Destination Addresses". https://developers.fireblocks.com/docs/whitelist-addresses`,
  rfar: `Request Finance, "Accounts receivable". https://www.request.finance/accounts-receivable`,
  request: `Request Finance Help Center, "Accounting integrations overview". https://help.request.finance/en/articles/13038304-accounting-integrations-overview`,
  rnpn: `Request Network Docs, "How payment networks work". https://docs.request.network/advanced/protocol-overview/how-payment-networks-work`,
  bitwave: `Bitwave, "Stablecoin B2B payments". https://www.bitwave.io/request-a-demo-stablecoin-b2b-payments`,
  tres: `TRES Finance, "Crypto accounting". https://tres.finance/lpp/crypto-accounting`,
  cryptio: `Cryptio, "Cryptio: the obvious choice for NetSuite users", 15 Jan 2026. https://blog.cryptio.co/cryptio-the-obvious-choice-for-netsuite-users`,
  eip681: `ERC-681, "URL Format for Transaction Requests". https://ercs.ethereum.org/ERCS/erc-681`,
  erc7699: `ERC-7699, "ERC-20 Transfer Reference Extension" (a proposal). https://ercs.ethereum.org/ERCS/erc-7699`,
  solpay: `Solana Pay specification, version 1. https://solana.com/docs/tools/solana-pay/specification/version1`,
  bip70: `Bitcoin Optech, "BIP70 payment protocol". https://bitcoinops.org/en/topics/bip70-payment-protocol/`,
  finality: `Tatum Docs, "EVM block finality and confidence". https://docs.tatum.io/docs/evm-block-finality-and-confidence`,
  fasb: `Crowe, "FASB proposes cash equivalents guidance for stablecoins", 25 Aug 2026. https://www.crowe.com/insights/take-into-account/fasb-proposes-cash-equivalents-guidance-for-stablecoins`,
  xero: `Xero Developer, "Granular scopes" FAQ. https://developer.xero.com/faq/granular-scopes`,
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const linkify = (s) => s.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>');

/** A light TypeScript/JSON highlighter: comments, strings, numbers and a few keywords. */
function highlight(code) {
  const tokens = /(\/\/[^\n]*)|(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(export|const|function|return|if|new|as)\b|\b(\d+(?:\.\d+)?)\b/g;
  let out = "", last = 0, m;
  while ((m = tokens.exec(code))) {
    out += esc(code.slice(last, m.index));
    const [t] = m;
    out += m[1] ? `<span class="cm">${esc(t)}</span>` : m[2] ? `<span class="st">${esc(t)}</span>` : m[3] ? `<span class="kw">${t}</span>` : `<span class="nu">${t}</span>`;
    last = m.index + t.length;
  }
  return out + esc(code.slice(last));
}

function expand(html) {
  const order = [];
  html = html.replace(/\[\[(\w+)\]\]/g, (_, k) => {
    if (!REFS[k]) throw new Error(`Unknown reference ${k}`);
    if (!order.includes(k)) order.push(k);
    return `<sup class="ref">${order.indexOf(k) + 1}</sup>`;
  });
  html = html.replace(/\{\{([VAG])(?::([^}]*))?\}\}/g, (_, k, src) => {
    const label = { V: "VERIFIED", A: "ASSUMPTION", G: "GUESS" }[k];
    return `<span class="c ${k.toLowerCase()}">${label}${src ? `: <span class="src">${esc(src)}</span>` : ""}</span>`;
  });
  html = html.replace(/<!--fig:([\w-]+)-->/g, (_, id) =>
    readFileSync(path.join(HERE, "figures", `${id}.svg`), "utf8").replace(/<\?xml[^>]*>\s*/, "").replace(/<!--[\s\S]*?-->\s*/, ""));
  html = html.replace(/<!--code:(\w+)-->/g, (_, id) => {
    const x = EXCERPTS[id];
    return `<div class="excerpt"><div class="head"><b>${esc(x.title)}</b><span class="path">${esc(x.path)}</span></div><pre>${highlight(x.code)}</pre>`;
  });
  html = html.replace("<!--refs-->", `<ol class="refs">${order.map((k) => `<li>${linkify(REFS[k])}</li>`).join("")}</ol>`);
  const unused = Object.keys(REFS).filter((k) => !order.includes(k));
  if (unused.length) console.warn("Unused references:", unused.join(", "));
  return html;
}

const footer = (note) => `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:6.5pt;color:#8a93a3;padding:0 19mm;display:flex;justify-content:space-between;">
  <span>Clearline · Working paper v0.3 · 29 October 2026${note}</span><span class="pageNumber"></span></div>`;

async function main() {
  if (!process.argv.includes("--no-figures")) await renderFigures();
  mkdirSync(OUT, { recursive: true });
  const src = expand(readFileSync(path.join(HERE, "paper.html"), "utf8"));
  // The built page sits next to the source so fonts/ and style.css resolve.
  const variants = [
    { file: "Clearline_Whitepaper_v0.3.pdf", html: src, note: "" },
    { file: "Clearline_Whitepaper_v0.3_review.pdf", html: src.replace("<body>", '<body class="review">'), note: " · REVIEW COPY: claims labelled" },
  ];
  const chromium = loadChromium();
  const browser = await chromium.launch();
  for (const v of variants) {
    const page = await browser.newPage();
    const tmp = path.join(HERE, `.paper-${v.note ? "review" : "clean"}.html`);
    writeFileSync(tmp, v.html);
    await page.goto(`file://${tmp}`, { waitUntil: "load" });
    // Load every bundled face before printing, so no page is laid out with a fallback font.
    await page.evaluate(async () => { await Promise.all([...document.fonts].map((f) => f.load().catch(() => null))); await document.fonts.ready; });
    const opts = { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer(v.note) };
    await page.pdf({ ...opts, path: path.join(HERE, v.file) });
    if (!v.note) await page.pdf({ ...opts, displayHeaderFooter: false, path: path.join(HERE, "Clearline_Executive_Summary_v0.3.pdf"), pageRanges: "1" });
    copyFileSync(tmp, path.join(OUT, path.basename(tmp)));
    await page.close();
    console.log("pdf", v.file);
  }
  await browser.close();
}

await main();
