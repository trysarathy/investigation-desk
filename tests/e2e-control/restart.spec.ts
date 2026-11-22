import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { E2E, serverEnv } from "./env";
import { paymentIdFor, REDWOOD, signIn } from "./helpers";

/*
 * Persistence across a real server restart: this spec starts its OWN `next start` (the same build, the same database)
 * on a second port, writes through it, stops that process, starts a new one and reads the data back. It only ever
 * stops the process it started.
 */

const PORT = E2E.port + 1; // a second port next to the suite's server (3198 by default); the projects run one after the other (workers: 1)

async function waitFor(url: string, up: boolean, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await fetch(url).then(() => true, () => false);
    if (ok === up) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not ${up ? "start" : "stop"} in time`);
}

async function start(port: number): Promise<ChildProcess> {
  const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(port)], { env: { ...process.env, ...serverEnv(port) }, detached: true, stdio: "ignore" });
  await waitFor(`http://127.0.0.1:${port}/control/sign-in`, true);
  return child;
}

async function stop(child: ChildProcess, port: number) {
  if (child.pid && child.exitCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    process.kill(-child.pid, "SIGTERM"); // this spec's own process group only
    await exited;
  }
  await waitFor(`http://127.0.0.1:${port}/control/sign-in`, false);
}

test("notes, case details and sessions survive stopping and starting the server", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const port = PORT;
  const base = `http://127.0.0.1:${port}`;
  let server = await start(port);
  try {
    const ctx = await browser.newContext({ baseURL: base });
    const page = await ctx.newPage();
    await signIn(page, "ops@lumen.example", info);
    const id = await paymentIdFor(page, REDWOOD);
    await page.goto(`/control/payments/${id}`);
    const note = `Restart probe ${info.project.name} ${Date.now()} (fictional)`;
    await page.getByLabel("Add a note").fill(note);
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByTestId("notes")).toContainText(note);

    await stop(server, port);
    expect(await fetch(`${base}/control/sign-in`).then(() => "up", () => "down")).toBe("down");
    server = await start(port);

    // the session row and the note are both in PostgreSQL: the same browser session still works after the restart
    await page.reload();
    await expect(page.getByTestId("signed-in-as")).toContainText("ops@lumen.example");
    await expect(page.getByTestId("notes")).toContainText(note);
    await ctx.close();
  } finally {
    await stop(server, port);
  }
});
