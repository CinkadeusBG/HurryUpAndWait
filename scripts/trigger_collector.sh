#!/usr/bin/env bash
# Trigger the Collect Wait Times workflow via GitHub API.
# Usage: GITHUB_TOKEN=github_pat_xxx ./scripts/trigger_collector.sh
set -euo pipefail

REPO="${GITHUB_REPO:-CinkadeusBG/HurryUpAndWait}"
WORKFLOW="${GITHUB_WORKFLOW:-collect-wait-times.yml}"
REF="${GITHUB_REF:-main}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: set GITHUB_TOKEN to a PAT with Actions read/write on ${REPO}" >&2
  exit 1
fi

URL="https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches"

HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  -d "{\"ref\":\"${REF}\"}" \
  "${URL}")

if [[ "${HTTP_CODE}" == "204" ]]; then
  echo "Triggered ${WORKFLOW} on ${REF} (HTTP 204)"
  exit 0
fi

echo "Unexpected response: HTTP ${HTTP_CODE}" >&2
exit 1