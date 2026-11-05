#!/usr/bin/env bash
# Local development only. Forwarded port must remain private.
set -eu
script_dir="$(cd "$(dirname "$0")" && pwd)"
state_dir="${HOME}/.clearline-synthetic-desk"
mkdir -p "$state_dir"
chmod 700 "$state_dir"
# The launcher owns the workspace marker and refuses unrelated directories.
if [ ! -e "$state_dir/SYNTHETIC-WORKSPACE" ] && [ -z "$(ls -A "$state_dir")" ]; then
  printf '%s\n' 'Local synthetic workspace only.' > "$state_dir/SYNTHETIC-WORKSPACE"
fi
if [ ! -f "$state_dir/SYNTHETIC-WORKSPACE" ]; then exit 1; fi
log="$state_dir/startup.log"
umask 077
nohup python3 "$script_dir/run_full_desk.py" --directory "$state_dir" > "$log" 2>&1 < /dev/null &
desk_pid=$!
for attempt in $(seq 1 35); do
  if ! kill -0 "$desk_pid" 2>/dev/null; then cat "$log"; exit 1; fi
  if python3 -c 'import urllib.request as u; u.urlopen("http://127.0.0.1:8765/api/health",timeout=1)' 2>/dev/null; then
    echo 'Clearline is ready: open private forwarded port 8765.'; exit 0
  fi
  sleep 1
done
cat "$log"
exit 1
