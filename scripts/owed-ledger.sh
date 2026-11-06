#!/bin/sh
set -eu
compiled=$(mktemp -d)
trap 'rm -rf "$compiled"' EXIT HUP INT TERM
./node_modules/.bin/tsc scripts/owed-ledger.ts --outDir "$compiled" --module commonjs --moduleResolution node --target es2022 --skipLibCheck
node "$compiled/scripts/owed-ledger.js" "$@"
