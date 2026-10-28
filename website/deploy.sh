#!/usr/bin/env bash
# Rebuild the static site and deploy it straight to Vercel (no Git connection).
# Usage (from the repo root):  bash website/deploy.sh
# Reads VERCEL_TOKEN (and optional NEXT_PUBLIC_* values) from investigation-desk/.env. Never prints the token.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/../.env"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (needs a VERCEL_TOKEN=... line)"; exit 1; }
set -a; . "$ENV_FILE"; set +a
[ -n "${VERCEL_TOKEN:-}" ] || { echo "VERCEL_TOKEN is not set in $ENV_FILE"; exit 1; }
export CLEARLINE_ON_VERCEL=1
export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://clearline-site.vercel.app}"

cd "$HERE"
npm ci --silent
rm -rf out && npx next build
# Deploy from a folder named clearline-site, so the Vercel project gets that name.
# Its .vercel/ link file is kept between deploys, so updates go to the same project.
mkdir -p .deploy/clearline-site
find .deploy/clearline-site -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} +
cp -R out/. .deploy/clearline-site/
cd .deploy/clearline-site
npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"
