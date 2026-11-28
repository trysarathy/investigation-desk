import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "../src/components/ui/logic";

/** The exceptions queue's keys are listed in the shortcut sheet; approving still has none. */
describe("exception shortcuts", () => {
  it("lists a (assign) and e (evidence), and no approve key", () => {
    const keys = SHORTCUTS.map((s) => s.keys.join("+"));
    expect(keys).toEqual(expect.arrayContaining(["j", "k", "Enter", "a", "e"]));
    expect(SHORTCUTS.find((s) => s.keys[0] === "a")?.does).toMatch(/assign/i);
    expect(SHORTCUTS.find((s) => s.keys[0] === "e")?.does).toMatch(/evidence/i);
    expect(SHORTCUTS.some((s) => /approv/i.test(s.does))).toBe(false);
  });
});
