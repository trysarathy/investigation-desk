import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  authenticate,
  AuthRequired,
  assertOrigin,
  readBody,
  login,
  logout,
  fundingNow,
  fundingStore,
  advanceClock,
  privateSettings,
  fundingDirectory,
} from "@/lib/funding/server";
import { reviewAdvance } from "@/lib/funding/review";
import { fundingLedger } from "@/lib/funding/ledger";
import { columns, importCsv } from "@/lib/funding/imports";
import {
  type ImportKind,
  type ColumnMapping,
  amount,
  compare,
  visible,
  instant,
} from "@/lib/funding/model";
import { sub, sum } from "@/lib/payments/money";
import {
  buildOutputs,
  digest,
  outputTables,
  openColumns,
  exceptionColumns,
} from "@/lib/funding/outputs";
import { buildEvidence, canonicalJson } from "@/lib/funding/evidence";

import { exportCsv } from "@/lib/advances/ledger";
import { zipStored, workbook } from "@/lib/funding/outputs/xlsx";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const enabled = () => {
  if (process.env.CLEARLINE_FUNDING_ONLY !== "1")
    throw Error("Funding desk is not enabled.");
};
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function GET(request: Request) {
  try {
    enabled();
    const { session, user, data, config } = await authenticate(request),
      at = fundingNow(config),
      ledger = fundingLedger(data, at);
    return response({
      user,
      columns,
      csrf: session.csrf,
      at,
      simulation: config.simulation,
      revision: data.revision,
      data: {
        ...data,
        advances: data.advances.filter((a) => visible(a, at)),
        customers: data.customers.filter((a) => visible(a, at)),
        payouts: data.payouts.filter((a) => visible(a, at)),
        receipts: data.receipts.filter((a) => visible(a, at)),
        cash: data.cash.filter((a) => visible(a, at)),
        imports: [],
        events: data.events.filter((e) => Date.parse(e.at) <= Date.parse(at)),
      },
      ledger,
      reviews: Object.fromEntries(
        data.advances
          .filter((a) => visible(a, at))
          .map((a) => [a.id, reviewAdvance(data, a.id, at)]),
      ),
      digest: digest(data, at, config.simulation).email,
    });
  } catch (e) {
    if (
      e instanceof AuthRequired &&
      new URL(request.url).searchParams.get("session") === "1"
    )
      return response({ authenticated: false });
    return response(
      { error: e instanceof Error ? e.message : "Cannot load the desk." },
      e instanceof AuthRequired ? 401 : 500,
    );
  }
}
export async function POST(request: Request) {
  try {
    enabled();
    assertOrigin(request);
    const body = await readBody(request);
    if (body.action === "login") {
      const { token } = await login(
        body.email as string,
        body.password as string,
      );
      const res = response({ ok: true });
      res.cookies.set("clearline_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.CLEARLINE_ORIGIN?.startsWith("https://"),
        path: "/",
        maxAge: 8 * 3600,
      });
      return res;
    }
    const { session, user, data, config } = await authenticate(request);
    if (request.headers.get("x-csrf-token") !== session.csrf)
      throw Error("Reload the desk before submitting.");
    if (
      body.actor_id !== undefined ||
      body.role !== undefined ||
      body.engine_version !== undefined
    )
      throw Error("Identity and policy are set by the server.");
    const at = fundingNow(config);
    if (body.action === "logout") {
      logout(request);
      const res = response({ ok: true });
      res.cookies.set("clearline_session", "", {
        httpOnly: true,
        path: "/",
        maxAge: 0,
      });
      return res;
    }
    if (body.action === "export") {
      const format = body.format;
      if (format === "evidence") {
        const pack = buildEvidence(
          data,
          body.advance_id as string,
          at,
          config.simulation,
        );
        return download(
          zipStored({
            "evidence.zip": pack.archive,
            "evidence-hashes.json": canonicalJson(pack.hashes),
          }),
          "evidence-review.zip",
          "application/zip",
        );
      }
      const tables = outputTables(data, at, config.simulation),
        report = digest(data, at, config.simulation);
      let outputs: Record<string, string | Buffer> = {
        "open-advances.csv": exportCsv(tables.open, openColumns),
        "exceptions.csv": exportCsv(tables.exceptions, exceptionColumns),
        "digest-email.txt": report.email + "\n",
        "digest-slack.txt": report.slack + "\n",
        "digest-webhook.json": JSON.stringify(report.payload, null, 2) + "\n",
      };
      if (format === "open-xlsx")
        outputs["open-advances.xlsx"] = workbook(
          openColumns,
          tables.open,
          new Set([
            "approved_amount",
            "paid",
            "repaid",
            "written_off",
            "outstanding",
            "remaining_commitment",
          ]),
        ).bytes;
      if (["journals", "xero", "netsuite"].includes(String(format)))
        outputs = buildOutputs(
          data,
          at,
          await privateSettings(),
          config.simulation,
        );
      const names: Record<string, string> = {
        "open-csv": "open-advances.csv",
        "open-xlsx": "open-advances.xlsx",
        exceptions: "exceptions.csv",
        digest: "digest-email.txt",
        slack: "digest-slack.txt",
        webhook: "digest-webhook.json",
        journals: "journals-generic.csv",
        xero: "journals-xero.csv",
        netsuite: "journals-netsuite.csv",
      };
      const name = names[String(format)];
      if (!name || !outputs[name])
        throw Error(
          "This format is unavailable. Confirm the provider accounting mappings first.",
        );
      return download(
        outputs[name],
        name,
        name.endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/plain; charset=utf-8",
      );
    }
    if (body.action === "clock") {
      if (user.role === "viewer")
        throw Error("A viewer cannot change the simulation.");
      await advanceClock(body.at as string);
      return response({ ok: true });
    }
    if (
      ["prepare", "approve", "decline", "write_off"].includes(
        String(body.action),
      )
    ) {
      await fundingStore().act(
        {
          action: body.action as
            "prepare" | "approve" | "decline" | "write_off",
          actor_id: user.id,
          advance_id: body.advance_id as string,
          reason: body.reason as string,
          at,
          users: [],
          ...(body.action === "write_off"
            ? { amount: body.amount as string }
            : {}),
        },
        body.revision as number,
      );
      return response({ ok: true });
    }
    if (user.role !== "operator")
      throw Error("Only an operator can import evidence or classify cash.");
    await fundingStore().update(async (current) => {
      if (current.revision !== body.revision)
        throw Error("Records changed. Reload before importing.");
      let kind = body.kind as ImportKind,
        text = body.text as string,
        filename = body.filename as string,
        mapping = body.mapping as ColumnMapping | undefined;
      if (body.action === "sample-payout" || body.action === "sample-receipt") {
        if (!config.simulation) throw Error("Sample actions are disabled.");
        kind = body.action === "sample-payout" ? "payouts" : "receipts";
        text = await readFile(
          path.join(fundingDirectory(), `${kind}.csv`),
          "utf8",
        );
        filename = `synthetic-${kind}.csv`;
        mapping = Object.fromEntries(columns[kind].map((k) => [k, k]));
      } else if (body.action === "cash") {
        kind = "cash";
        const observed = body.effective_at as string;
        if (instant(observed) > instant(at))
          throw Error(
            "The observed bank balance time cannot be in the future.",
          );
        const balance = String(body.balance),
          restricted = [body.safeguarded, body.pending, body.buffer].map(
            String,
          );
        [balance, ...restricted].forEach(amount);
        const free = sub(balance, sum(restricted));
        if (compare(free, "0") < 0)
          throw Error("Restricted portions exceed the balance.");
        const id = randomBytes(12).toString("hex");
        const rows = [
          "free",
          "safeguarded customer money",
          "pending payouts",
          "buffer",
        ].map((classification, i) =>
          [
            `${id}-${i}`,
            observed,
            at,
            id,
            body.account,
            balance,
            body.currency,
            classification,
            [free, ...restricted][i],
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(","),
        );
        mapping =
          current.mappings.cash ??
          Object.fromEntries(columns.cash.map((k) => [k, k]));
        text =
          columns.cash
            .map((k) => `"${mapping![k].replace(/"/g, '""')}"`)
            .join(",") +
          "\n" +
          rows.join("\n") +
          "\n";
        filename = "provider-cash-classification.csv";
      } else if (body.action !== "import")
        throw Error("Choose a supported action.");
      if (typeof text !== "string" || typeof filename !== "string")
        throw Error("Select a CSV file.");
      return [importCsv(current, kind, text, mapping, filename, at), undefined];
    });
    return response({ ok: true });
  } catch (e) {
    return response(
      {
        error:
          e instanceof Error ? e.message : "The action could not be completed.",
      },
      e instanceof AuthRequired ? 401 : 400,
    );
  }
}
function download(value: string | Buffer, name: string, type: string) {
  return new Response(
    new Uint8Array(typeof value === "string" ? Buffer.from(value) : value),
    {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
