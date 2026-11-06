#!/bin/sh
set -eu
compiled=$(mktemp -d)
trap 'rm -rf "$compiled"' EXIT HUP INT TERM
./node_modules/.bin/tsc scripts/funding-setup.ts --outDir "$compiled" --module commonjs --moduleResolution node --target es2022 --esModuleInterop --skipLibCheck
node "$compiled/scripts/funding-setup.js" "$@"
