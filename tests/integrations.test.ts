import { expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlack, equalSecret } from "../src/lib/integrations/verify";
it("authenticates Slack raw bytes and rejects stale or changed payloads", () => {
  const time = "1800000000",
    body = "text=abc&team_id=T1",
    secret = "test-secret";
  const sig =
    "v0=" +
    createHmac("sha256", secret).update(`v0:${time}:${body}`).digest("hex");
  expect(verifySlack(body, time, sig, secret, 1800000000000)).toBe(true);
  expect(verifySlack(body + "x", time, sig, secret, 1800000000000)).toBe(false);
  expect(verifySlack(body, time, sig, secret, 1800000600000)).toBe(false);
  expect(verifySlack(body, time, sig, "", 1800000000000)).toBe(false);
  expect(equalSecret("short", "longer")).toBe(false);
});
