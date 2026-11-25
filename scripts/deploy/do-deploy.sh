#!/usr/bin/env bash
# v1 phase 6: point a DigitalOcean App Platform app at one image tag (a git commit sha already pushed to the registry)
# and wait for the deployment. Used by deploy-staging.yml, deploy-production.yml and for a rollback (same command with
# the previous sha). Talks to the DigitalOcean API with curl and jq only.
#
#   DIGITALOCEAN_ACCESS_TOKEN=... scripts/deploy/do-deploy.sh <app-id> <image-tag>
#
# The app's current spec is read and only `image.tag` of every service, worker and job is changed, so the encrypted
# secrets App Platform holds (EV[...] values) are kept and never pass through this script's output or GitHub. The
# pre-deploy migrate job in the spec runs first; if it fails, App Platform keeps the old version serving.
# Prints the deployment id, phase and the tag; never the spec, env values or the token.
set -euo pipefail
app="${1:?app id}"; tag="${2:?image tag (git sha)}"
[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || { echo "do-deploy: DIGITALOCEAN_ACCESS_TOKEN is not set" >&2; exit 2; }
[[ "$tag" =~ ^[0-9a-f]{40}$ ]] || { echo "do-deploy: the tag must be a full 40-character git sha" >&2; exit 2; }
API=https://api.digitalocean.com/v2
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
call() { curl -fsS --max-time 60 -H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN" -H "Content-Type: application/json" "$@"; }

call "$API/apps/$app" > "$TMP/app.json"
jq --arg t "$tag" '{spec: (.app.spec
  | (.services // []) |= map(if .image then .image.tag = $t else . end)
  | (.workers // []) |= map(if .image then .image.tag = $t else . end)
  | (.jobs // []) |= map(if .image then .image.tag = $t else . end))}' "$TMP/app.json" > "$TMP/update.json"
n="$(jq '[.spec.services[]?, .spec.workers[]?, .spec.jobs[]? | select(.image)] | length' "$TMP/update.json")"
[ "$n" -gt 0 ] || { echo "do-deploy: the app has no image-based component to update" >&2; exit 3; }
before="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
call -X PUT --data @"$TMP/update.json" "$API/apps/$app" > /dev/null
echo "do-deploy: spec updated ($n components -> ${tag:0:12}); waiting for the deployment"

for _ in $(seq 1 120); do # up to 30 minutes
  sleep 15
  call "$API/apps/$app/deployments?per_page=5" > "$TMP/deps.json"
  dep="$(jq -r --arg b "$before" '[.deployments[] | select(.created_at >= $b)] | sort_by(.created_at) | last | (.id // "") + " " + (.phase // "")' "$TMP/deps.json")"
  id="${dep% *}"; phase="${dep#* }"
  [ -n "$id" ] || continue
  case "$phase" in
    ACTIVE) echo "do-deploy: deployment $id ACTIVE (${tag:0:12})"; exit 0 ;;
    ERROR|CANCELED|SUPERSEDED) echo "do-deploy: deployment $id ended $phase; the previous version keeps serving" >&2; exit 1 ;;
    *) echo "do-deploy: deployment $id $phase" ;;
  esac
done
echo "do-deploy: timed out waiting; check the app's deployments in the DigitalOcean console" >&2
exit 1
