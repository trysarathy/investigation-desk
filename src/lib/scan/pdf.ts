import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ScanReport } from "./types";
export async function scanPdf(report: ScanReport) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    readFileSync(
      path.join(
        process.cwd(),
        "node_modules/@fontsource/inter/files/inter-latin-400-normal.woff",
      ),
    ),
    { subset: true },
  );
  const bold = await pdf.embedFont(
    readFileSync(
      path.join(
        process.cwd(),
        "node_modules/@fontsource/inter/files/inter-latin-600-normal.woff",
      ),
    ),
    { subset: true },
  );
  pdf.setTitle("Company Scan - " + report.company);
  pdf.setSubject("Read-only transfer observations; limitations included");
  let page = pdf.addPage([595, 842]),
    y = 780,
    n = 1;
  const ink = rgb(0.09, 0.1, 0.13),
    muted = rgb(0.36, 0.38, 0.42),
    blue = rgb(0.23, 0.36, 0.86);
  function clean(s: string) {
    return s.replace(/[^\x20-\x7e]/g, "-");
  }
  function header() {
    page.drawText("INVESTIGATION DESK  /  COMPANY SCAN", {
      x: 42,
      y: 805,
      size: 9,
      font: bold,
      color: blue,
    });
    page.drawText(String(n), { x: 540, y: 28, size: 9, font, color: muted });
  }
  header();
  function text(s: string, size = 10, weight = false) {
    const f = weight ? bold : font;
    const words = clean(s).split(/\s+/);
    let line = "";
    const draw = () => {
      if (y < 65) {
        page = pdf.addPage([595, 842]);
        n++;
        y = 770;
        header();
      }
      page.drawText(line, {
        x: 42,
        y,
        size,
        font: f,
        color: weight ? ink : muted,
      });
      y -= size + 7;
    };
    for (const word of words) {
      if (f.widthOfTextAtSize(word, size) > 505) {
        if (line) {
          draw();
          line = "";
        }
        for (const char of word) {
          if (f.widthOfTextAtSize(line + char, size) > 505) {
            draw();
            line = "";
          }
          line += char;
        }
        continue;
      }
      if (f.widthOfTextAtSize(line + " " + word, size) > 505 && line) {
        draw();
        line = "";
      } // hashes fit at 8 pt in the appendix
      line += (line ? " " : "") + word;
    }
    if (line) draw();
  }
  text(report.company, 24, true);
  text(
    `${report.days}-day window | ${report.status.toUpperCase()} | ${report.demo ? "FICTIONAL DEMO" : "PUBLIC CHAIN OBSERVATIONS"}`,
    10,
    true,
  );
  y -= 12;
  text(
    `Started ${report.startedAt}. Finished ${report.finishedAt ?? "In progress"}.`,
  );
  text(
    `${report.transfers.length} incoming observations | ${report.transfers.filter((t) => t.signal !== "none").length} review signals`,
    16,
    true,
  );
  text(
    "Confirmed problem payments: not assessed. USD loss: not established.",
    11,
    true,
  );
  text(
    "Company ownership is user-supplied. This report is not a claim that the named company lost funds or failed to credit customers.",
  );
  y -= 12;
  text("Coverage and limitations", 14, true);
  for (const c of report.coverage) text(c);
  for (const e of report.errors) text("INCOMPLETE: " + e, 10, true);
  y -= 12;
  text("Top observed signals", 14, true);
  text(
    `Contract differs from issuer list: ${report.transfers.filter((t) => t.signal === "contract_mismatch").length}. Verify token identity and policy.`,
  );
  text(
    `Zero-value transfers: ${report.transfers.filter((t) => t.signal === "zero_value").length}. Not evidence of loss or poisoning by themselves.`,
  );
  text(
    "All other observations have no signal in the limited checks run; they are not certified normal payments.",
  );
  y -= 12;
  text("Address scope", 14, true);
  for (const a of report.addresses) text(`${a.chain}: ${a.address}`, 9);
  y -= 12;
  text("Provider evidence", 14, true);
  for (const source of report.sources ?? []) {
    text(source.url, 8);
    text(`SHA-256: ${source.sha256}`, 8);
  }
  y -= 12;
  text("Transfer evidence appendix", 14, true);
  for (const t of report.transfers) {
    if (y < 160) {
      page = pdf.addPage([595, 842]);
      n++;
      y = 770;
      header();
    }
    text(
      `${t.amount} ${t.symbol} | ${t.chain} | ${t.at} | ${t.signal}`,
      10,
      true,
    );
    text(`Hash: ${t.hash}`, 8);
    text(`Contract: ${t.contract}`, 8);
    text(`Source: ${t.source || "Fictional: no public source"}`, 8);
    text(`Evidence SHA-256: ${t.evidenceHash}`, 8);
    y -= 5;
  }
  text(
    "Credit status requires authorized company records. No private keys or signing used.",
    9,
  );
  return pdf.save();
}
