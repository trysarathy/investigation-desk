import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { deploymentGate, PILOT_SAMPLE_FILES } from "../src/middleware";

const pilot = { CLEARLINE_CONTROL_PILOT: "1" };
describe("pilot gate: the sample files", () => {
  it("serves exactly the three fictional sample files", () => {
    for (const p of PILOT_SAMPLE_FILES) {
      expect(deploymentGate(p, null, pilot).action).toBe("next");
      expect(existsSync(`public${p}`)).toBe(true);
    }
  });
  it("still refuses every other public path, including look-alikes", () => {
    for (const p of ["/samples/", "/samples/other.csv", "/samples/kestrelbay-sample-bank-statement.csv.bak", "/samples/../.env", "/clearline", "/settings"]) {
      expect(deploymentGate(p, null, pilot).action).toBe("not_found");
    }
  });
});
