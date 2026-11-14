// Resolves the Clearline website/software URLs at build time (see clearline-release.json).
// Plain ESM so both next.config.mjs files can import it without a TypeScript step.
import { readFileSync } from 'node:fs';

const HTTPS = /^https:\/\/[a-z0-9.-]+$/;

function check(name, url) {
  if (typeof url !== 'string' || !HTTPS.test(url)) throw new Error(`clearline-release: ${name} must be an https origin without a path, got ${JSON.stringify(url)}`);
  return url;
}

/**
 * @param {{ CLEARLINE_PRODUCT_URL?: string, CLEARLINE_MARKETING_URL?: string, VERCEL_ENV?: string, VERCEL_GIT_COMMIT_REF?: string }} env
 * @param {object} release parsed clearline-release.json
 * @returns {{ product: string, marketing: string, fundingDesk: string, source: 'override'|'preview'|'production' }}
 */
export function resolveReleaseUrls(env, release) {
  const isPairedPreview = env.VERCEL_ENV === 'preview' && release.previewBranches.includes(env.VERCEL_GIT_COMMIT_REF ?? '');
  const base = isPairedPreview ? release.preview : release.production;
  const out = {
    product: check('product', env.CLEARLINE_PRODUCT_URL || base.product),
    marketing: check('marketing', env.CLEARLINE_MARKETING_URL || base.marketing),
    fundingDesk: check('fundingDesk', base.fundingDesk),
  };
  const source = env.CLEARLINE_PRODUCT_URL || env.CLEARLINE_MARKETING_URL ? 'override' : isPairedPreview ? 'preview' : 'production';
  return { ...out, source };
}

export function loadRelease(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
