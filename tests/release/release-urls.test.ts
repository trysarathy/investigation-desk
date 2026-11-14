import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error plain ESM helper without type declarations
import { resolveReleaseUrls } from "../../release-urls.mjs";

const release = JSON.parse(readFileSync(new URL("../../clearline-release.json", import.meta.url), "utf8"));

describe("clearline-release.json resolution", () => {
  it("defaults to production when not a Vercel preview", () => {
    expect(resolveReleaseUrls({}, release)).toMatchObject({ ...release.production, source: "production" });
    expect(resolveReleaseUrls({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "rc3/clearline-app" }, release).source).toBe("production");
  });
  it("pairs previews only for the listed release branches", () => {
    for (const ref of release.previewBranches) {
      expect(resolveReleaseUrls({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ref }, release)).toMatchObject({ ...release.preview, source: "preview" });
    }
    expect(resolveReleaseUrls({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "some/other-branch" }, release).source).toBe("production");
  });
  it("lets an explicit override win and rejects anything but a bare https origin", () => {
    expect(resolveReleaseUrls({ CLEARLINE_PRODUCT_URL: "https://example.test" }, release)).toMatchObject({ product: "https://example.test", source: "override" });
    for (const bad of ["http://x.test", "https://x.test/path", "javascript:alert(1)", "https://x.test/?q"]) {
      expect(() => resolveReleaseUrls({ CLEARLINE_MARKETING_URL: bad }, release)).toThrow(/https origin/);
    }
  });
  it("preview hostnames are short enough that Vercel does not truncate them (<= 63 chars)", () => {
    for (const url of Object.values(release.preview) as string[]) expect(new URL(url).hostname.split(".")[0].length).toBeLessThanOrEqual(63);
  });
});
