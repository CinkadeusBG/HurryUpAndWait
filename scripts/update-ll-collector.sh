#!/usr/bin/env bash
# Deploy or update the nightly Lightning Lane collector on the *arr server.
#
# Collects:
#   - park_ll_daily_snapshots  (Multi Pass + Premier Pass per park per day)
#   - ill_daily_snapshots      (Individual Lightning Lane per attraction per day)
#
# Prerequisites: Python 3.9+, git, cron
#
# Quick start (on *arr server after git pull):
#   cd /path/to/HurryUpAndWait/scripts
#   cp env.example env.ll-collector   # fill in Turso URL + RW token
#   chmod 600 env.ll-collector
#   ./update-ll-collector.sh --schema-only
#   ./update-ll-collector.sh --test            # --ignore-hours one-off run
#   ./update-ll-collector.sh --install-cron
#
# Options:
#   --schema-only     Apply Turso table migrations only
#   --test            Run a one-off collection (--ignore-hours)
#   --install-cron    Append crontab.ll-collector.example to user crontab (once)
#   --install-dir=X   Target path (default: directory containing this script)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$SCRIPT_DIR}"
ENV_FILE="${ENV_FILE:-$INSTALL_DIR/env.ll-collector}"
PYTHON="${PYTHON:-python3}"
LOG_FILE="${LOG_FILE:-/var/log/hurryupandwait-ll-collector.log}"
CRON_MARKER="hurryupandwait-ll-collector"

SCHEMA_ONLY=false
TEST_RUN=false
INSTALL_CRON=false

for arg in "$@"; do
  case "$arg" in
    --schema-only) SCHEMA_ONLY=true ;;
    --test) TEST_RUN=true ;;
    --install-cron) INSTALL_CRON=true ;;
    --install-dir=*) INSTALL_DIR="${arg#*=}" ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

cd "$INSTALL_DIR"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "ERROR: $PYTHON not found (need Python 3.9+)" >&2
  exit 1
fi

"$PYTHON" -c "from zoneinfo import ZoneInfo" 2>/dev/null || {
  echo "ERROR: Python zoneinfo unavailable — upgrade to 3.9+" >&2
  exit 1
}

for required in collect_ill_daily.py parks_config.json sql/ill_daily_snapshots.sql sql/park_ll_daily_snapshots.sql; do
  if [[ ! -f "$required" ]]; then
    echo "ERROR: missing $INSTALL_DIR/$required — git pull or copy scripts/ first" >&2
    exit 1
  fi
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: create $ENV_FILE from env.example (Turso URL + RW token)" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

if [[ -z "${TURSO_DATABASE_URL:-}" || -z "${TURSO_AUTH_TOKEN:-}" ]]; then
  echo "ERROR: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in $ENV_FILE" >&2
  exit 1
fi

run_collector() {
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
  cd "$INSTALL_DIR"
  "$PYTHON" collect_ill_daily.py "$@"
}

if $SCHEMA_ONLY; then
  echo "Applying Turso schema (ILL + park LL tables)..."
  run_collector --schema-only
  echo "Done."
  exit 0
fi

if $TEST_RUN; then
  echo "Running test collection (ignore-hours + force)..."
  run_collector --ignore-hours
  echo "Check Turso for rows in ill_daily_snapshots and park_ll_daily_snapshots."
  exit 0
fi

if $INSTALL_CRON; then
  CRON_LINE="0 23 * * * . $ENV_FILE && cd $INSTALL_DIR && $PYTHON collect_ill_daily.py >> $LOG_FILE 2>&1"
  if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
    echo "Cron entry already installed (marker: $CRON_MARKER)."
    crontab -l | grep "$CRON_MARKER" || true
    exit 0
  fi
  touch "$LOG_FILE" 2>/dev/null || LOG_FILE="$INSTALL_DIR/ll-collector.log"
  CRON_LINE="0 23 * * * . $ENV_FILE && cd $INSTALL_DIR && $PYTHON collect_ill_daily.py >> $LOG_FILE 2>&1 # $CRON_MARKER"
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo "Installed cron (11 PM daily). Log: $LOG_FILE"
  exit 0
fi

echo "Nothing to do. Try: --schema-only | --test | --install-cron" >&2
exit 1