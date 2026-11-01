// Task 6a-2: both screens (/requests/all and /requests/[id]) show the status sentence from paymentStatus().
// The real pages are rendered (server components, streamed to HTML) on a scratch demo day.

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToReadableStream } from "react-dom/server.edge";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PaymentStatusLine } from "@/components/requests/PaymentStatusLine";
import type { PaymentStatus } from "@/lib/requests/status";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/requests",
  useSearchParams: () => new URLSearchParams(), notFound: () => { throw new Error("not found"); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));

const html = async (el: ReactNode) => { const s = await renderToReadableStream(el); await s.allReady; return (await new Response(s).text()).replace(/&#x27;/g, "'"); };
const lines = (h: string) => [...h.matchAll(/<p class="status-line"([^>]*)>([^<]*)</g)].map((m) => ({ attrs: m[1], text: m[2] }));
const SHORT = "Short by 50.00 USDC: ask the customer for the rest, or accept it as settled.";

const env = { dir: process.env.DESK_DATA_DIR, demo: process.env.DEMO_MODE };
let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "status-screens-"));
  process.env.DESK_DATA_DIR = dir;
  process.env.DEMO_MODE = "on";
  const { demoAction } = await import("@/lib/requests/service");
  await demoAction({ kind: "reset" });
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (env.dir === undefined) delete process.env.DESK_DATA_DIR; else process.env.DESK_DATA_DIR = env.dir;
  if (env.demo === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = env.demo;
});

describe("both screens show the sentence", () => {
  it("/requests/all: one sentence per request row, none announced (19 rows refresh every 5 s)", async () => {
    const All = (await import("@/app/requests/all/page")).default;
    const l = lines(await html(await All({ searchParams: Promise.resolve({}) })));
    expect(l).toHaveLength(19);
    expect(l.map((x) => x.text)).toContain(SHORT);
    expect(l.every((x) => !x.attrs.includes("role="))).toBe(true);
  });

  it("/requests/[id]: the sentence under the title, in a role=status region", async () => {
    const Detail = (await import("@/app/requests/[id]/page")).default;
    const l = lines(await html(await Detail({ params: Promise.resolve({ id: "DEMO-1042" }), searchParams: Promise.resolve({}) })));
    expect(l).toHaveLength(1);
    expect(l[0].text).toBe(SHORT);
    expect(l[0].attrs).toContain('role="status"');
    expect(l[0].attrs).toContain('data-status="short"');
  });

  it("the shared line: role=status only when live", () => {
    const s: PaymentStatus = { key: "waiting", sentence: "Waiting for payment: nothing has arrived yet.", nextAction: "x", etaMinutes: null };
    expect(renderToStaticMarkup(createElement(PaymentStatusLine, { s, live: true }))).toContain('role="status"');
    expect(renderToStaticMarkup(createElement(PaymentStatusLine, { s }))).not.toContain("role=");
  });
});
