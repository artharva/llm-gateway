#!/usr/bin/env bash
# Runs the five k6 scenarios one after another and writes a results table.
# Start the stack first (docker compose up -d) and export ADMIN_TOKEN.
#
#   ADMIN_TOKEN=... ./load-tests/run-all.sh            # all scenarios
#   ADMIN_TOKEN=... ./load-tests/run-all.sh cache slow # just these
set -euo pipefail
cd "$(dirname "$0")"

: "${ADMIN_TOKEN:?export ADMIN_TOKEN (the gateway's admin token) first}"
export BASE_URL="${BASE_URL:-http://localhost:8080}"
export MOCK_URL="${MOCK_URL:-http://localhost:4000}"
export RESULTS_DIR="${RESULTS_DIR:-results}"
mkdir -p "$RESULTS_DIR"

scenarios=("$@")
[ ${#scenarios[@]} -eq 0 ] && scenarios=(baseline cache outage slow abuse)

curl -fsS "$BASE_URL/health" >/dev/null || { echo "gateway is not up at $BASE_URL"; exit 1; }

# Throughput depends on the machine, so record it beside the numbers.
cat >"$RESULTS_DIR/machine.json" <<JSON
{
  "cpu": "$(awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null)",
  "cpus": $(nproc 2>/dev/null || sysctl -n hw.ncpu),
  "memory_mb": $(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo null),
  "os": "$(uname -sr)",
  "k6": "$(k6 version | head -1 | awk '{print $2}')",
  "recorded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

status=0
for s in "${scenarios[@]}"; do
  echo "--- $s"
  # A failed threshold is a result worth recording, not a reason to stop the run.
  k6 run --quiet "$s.js" || status=$?
  # Let the breaker cool down and in-flight logs flush before the next scenario.
  sleep 25
done

node summarize.mjs "$RESULTS_DIR"
exit $status
