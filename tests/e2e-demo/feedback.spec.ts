import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { a11y, guard, resetDemo, settled, signIn, switchTo } from "./demo";
import { demoQuery } from "./db";
import { DEMO_E2E, DEMO_USERS } from "./env";

/*
 * "Note feedback" on every screen of the demo build: one note per demo login, saved with the screen, its route, the
 * role (from the session) and the time; `npm run demo:feedback` exports them; a reset saves them to .demo/feedback
 * before it drops the database (the template has none), and the export still includes them. Demo · fictional data.
 */
const OUT = path.join(DEMO_E2E.root, "test-results", "demo-feedback");
const BACKUPS = path.join(DEMO_E2E.root, ".demo", "feedback");
const exportFeedback = () => {
  execFileSync(path.join(DEMO_E2E.root, "node_modules/.bin/tsx"), [path.join(DEMO_E2E.root, "scripts/demo/feedback.ts")], { cwd: DEMO_E2E.root, env: { ...process.env, CLEARLINE_DEMO_FEEDBACK_OUT: OUT }, encoding: "utf8" });
  return readFileSync(path.join(OUT, `FEEDBACK_${new Date().toISOString().slice(0, 10)}.md`), "utf8");
};

test("Note feedback: saved per screen and role, exported, kept across a reset", async ({ page }, info) => {
  test.setTimeout(600_000);
  resetDemo();
  rmSync(OUT, { recursive: true, force: true });
  // a presenter's own saved notes are set aside for the test and put back afterwards
  const kept = `${BACKUPS}.kept-by-test`;
  if (existsSync(BACKUPS)) { rmSync(kept, { recursive: true, force: true }); renameSync(BACKUPS, kept); }
  try {
    const g = guard(page);
    const plan = [
      { who: "finance", path: "/control/merchant/payments/BK-24823", screen: "BK-24823", role: "finance" },
      { who: "approver", path: "/control/merchant/approvals", screen: "Approvals", role: "approver" },
      { who: "viewer", path: "/control/merchant/month-end?entity=NW-SG&month=2026-11", screen: "Month-end", role: "viewer" },
      { who: "admin", path: "/control/merchant/settings", screen: "Settings", role: "admin" },
      { who: "ops", path: "/control/merchant/provider/pilot", screen: "Pilot metrics", role: "provider_ops" },
    ] as const;
    for (const [i, p] of plan.entries()) {
      if (i === 0) await signIn(page, DEMO_USERS[p.who]);
      else await switchTo(page, DEMO_USERS[p.who]);
      await page.goto(p.path);
      await settled(page);
      await page.waitForLoadState("networkidle"); // hydrated: the toggle has its handler
      const toggle = page.getByTestId("feedback-toggle");
      await toggle.focus();
      await page.keyboard.press("Enter");
      const box = page.getByLabel(/^Feedback on this screen/);
      await expect(box).toBeFocused();
      await page.keyboard.type(`Note ${i + 1} from ${p.who} (fictional).`);
      if (i === 0) await a11y(page, info, "feedback form open");
      await page.getByTestId("feedback-save").click();
      await expect(page.getByTestId("feedback-status")).toContainText("Feedback saved for");
      await expect(page.getByTestId("feedback-form")).toBeHidden();
      await expect(toggle).toBeFocused();
      g.check();
    }
    const rows = await demoQuery<{ role: string; screen: string; route: string; note: string; email: string }>("select f.role, f.screen, f.route, f.note, u.email from demo_feedback f join users u on u.id = f.user_id order by f.created_at");
    expect(rows.map((r) => [r.email, r.role, r.route, r.note])).toEqual(plan.map((p, i) => [DEMO_USERS[p.who], p.role, p.path, `Note ${i + 1} from ${p.who} (fictional).`]));
    for (const [i, r] of rows.entries()) expect(r.screen, r.route).toContain(plan[i].screen);
    // an empty note is not saved
    await page.getByTestId("feedback-toggle").click();
    await page.getByTestId("feedback-save").click();
    await expect(page.getByTestId("feedback-status")).toContainText("Write a note first.");

    let md = exportFeedback();
    expect(md).toContain("5 note(s) on 5 screen(s).");
    for (const [i, p] of plan.entries()) expect(md).toContain(`Note ${i + 1} from ${p.who} (fictional).`);

    // the reset drops the notes with everything else, after saving them; the export still has them
    const out = resetDemo();
    expect(out).toContain("5 presenter feedback note(s) were saved to .demo/feedback/");
    expect(await demoQuery("select 1 from demo_feedback")).toHaveLength(0);
    md = exportFeedback();
    expect(md).toContain("5 note(s) on 5 screen(s).");
  } finally {
    rmSync(BACKUPS, { recursive: true, force: true });
    if (existsSync(kept)) renameSync(kept, BACKUPS);
  }
});
