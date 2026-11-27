/**
 * v1 phase 6: the deployment files keep their promises (text checks; no YAML parser is a dependency). Nothing here
 * talks to a cloud API. docs/ops/HOSTING_PROPOSAL.md, docs/ops/DEPLOY_AND_ROLLBACK.md.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const read = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
/** The `- name:`-led steps of one job, as text blocks. */
function steps(workflow: string, job: string): string[] {
  const start = workflow.indexOf(`\n  ${job}:\n`);
  expect(start, job).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const body = next < 0 ? rest : rest.slice(0, next + 3);
  return body.split(/\n {6}- /).slice(1);
}

describe("App Platform specs: staging and production are separate and hold no secret", () => {
  const spec = { staging: read("ops/do/app.staging.yaml"), production: read("ops/do/app.production.yaml") };
  it("each names its own environment, database cluster, bucket and domain, in Singapore", () => {
    for (const [env, s] of Object.entries(spec)) {
      expect(s).toMatch(new RegExp(`key: CLEARLINE_DEPLOY_ENV, value: ${env},`));
      expect(s).toContain(`cluster_name: clearline-pg-${env}`);
      expect(s).toContain(`value: clearline-uploads-${env},`);
      expect(s).toMatch(/^region: sgp$/m);
    }
    expect(spec.staging).toContain("domain: staging.clearlineconnect.org");
    expect(spec.production).toContain("domain: app.clearlineconnect.org");
  });
  it("every SECRET value is a CHANGE_ME placeholder; no demo, test or recorded-chain switch; uploads sealed in s3", () => {
    for (const s of Object.values(spec)) {
      const secrets = [...s.matchAll(/value: ([^,]+), type: SECRET/g)].map((m) => m[1]);
      expect(secrets.length).toBeGreaterThanOrEqual(7);
      for (const v of secrets) expect(v).toMatch(/^CHANGE_ME_/);
      expect(s).not.toMatch(/CLEARLINE_(DEMO_BUILD|TEST_BUILD|CHAIN_RECORDING)|DEMO_MODE/);
      expect(s).toContain("key: CLEARLINE_UPLOAD_STORE, value: s3,");
      expect(s).toContain("key: CLEARLINE_UPLOAD_KEY,");
      expect(s).toMatch(/kind: PRE_DEPLOY[\s\S]*run_command: npx drizzle-kit migrate/);
      expect(s).toMatch(/workers:\n {2}- name: worker[\s\S]*scripts\/jobs\/worker\.ts/);
    }
  });
});

describe("workflows", () => {
  const prod = read(".github/workflows/deploy-production.yml");
  const staging = read(".github/workflows/deploy-staging.yml");
  it("production deploys only by hand, from a verified sha, behind the production environment", () => {
    expect(prod).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(prod).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    expect(prod).toMatch(/deploy:\n {4}name: deploy production\n {4}needs: verify\n[\s\S]*environment:\n {6}name: production/);
    expect(prod).toContain("merge-base --is-ancestor \"$SHA\" origin/release");
    expect(prod).toContain('select(.context == "deployed/staging")');
    expect(prod).not.toMatch(/docker build/);
  });
  it("staging deploys after every gate; both skip every deploy step cleanly without secrets", () => {
    expect(staging).toMatch(/needs: \[ci, control-e2e, merchant-e2e\]/);
    for (const [wf, job] of [[staging, "deploy"], [prod, "deploy"]] as const) {
      const s = steps(wf, job);
      expect(s[0]).toMatch(/^name: Are the deploy secrets configured\?/);
      expect(s[0]).toContain("::notice::");
      for (const later of s.slice(1)) expect(later, later.split("\n")[0]).toMatch(/if: steps\.ready\.outputs\.ok == 'true'/);
    }
  });
  it("every pull request runs every suite (no path filters), and ci lints migrations", () => {
    for (const f of readdirSync(path.resolve(__dirname, "../../.github/workflows"))) {
      const w = read(`.github/workflows/${f}`);
      expect(w, f).not.toMatch(/pull_request:\n {4}paths:/);
    }
    expect(read(".github/workflows/ci.yml")).toMatch(/node scripts\/deploy\/check-migrations\.mjs --base "\$BASE"/);
  });
});

describe("Dockerfile.prod and the Terraform", () => {
  it("the image is a plain build checked for demo and recorded-chain code, and never says where it runs", () => {
    const d = read("Dockerfile.prod");
    expect(d).toContain("check-chain-recording.mjs --expect absent");
    expect(d).toContain("check-chain-recording.mjs --marker demo --expect absent");
    expect(d).not.toMatch(/CLEARLINE_DEPLOY_ENV=|DEMO_MODE|CLEARLINE_TEST_BUILD=1|CLEARLINE_DEMO_BUILD=1/);
    expect(d).toMatch(/^USER node$/m);
  });
  it("one database cluster, bucket and bucket-scoped key per environment; clusters cannot be destroyed by accident", () => {
    const t = read("ops/terraform/main.tf") + read("ops/terraform/variables.tf");
    expect(t).toContain('default     = ["staging", "production"]');
    for (const r of ["digitalocean_database_cluster\" \"pg\"", "digitalocean_spaces_bucket\" \"uploads\"", "digitalocean_spaces_key\" \"uploads\""]) expect(t).toMatch(new RegExp(`${r.replace(/[".]/g, (c) => `\\${c}`)} \\{\\n {2}for_each += var\\.environments`));
    expect(t).toContain('version    = "16"');
    expect(t).toContain("prevent_destroy = true");
    expect(t).toMatch(/acl += "private"/);
  });
});
