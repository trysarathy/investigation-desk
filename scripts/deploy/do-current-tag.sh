#!/usr/bin/env bash
# v1 phase 6: the image tag (git sha) the app's ACTIVE deployment runs, or nothing on a first deploy. The deploy
# workflows lint migrations against it (the code that keeps running while the new migrations apply).
#   DIGITALOCEAN_ACCESS_TOKEN=... scripts/deploy/do-current-tag.sh <app-id>
set -euo pipefail
app="${1:?app id}"
[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || { echo "do-current-tag: DIGITALOCEAN_ACCESS_TOKEN is not set" >&2; exit 2; }
curl -fsS --max-time 60 -H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN" "https://api.digitalocean.com/v2/apps/$app" \
  | jq -r '.app.active_deployment.spec.services[0].image.tag // "" | select(test("^[0-9a-f]{40}$"))'
