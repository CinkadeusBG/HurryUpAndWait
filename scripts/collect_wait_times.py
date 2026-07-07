#!/usr/bin/env python3
"""
Background collector for ThemeParks.wiki wait times.

Polls WDW and Universal Orlando parks, appends snapshots to per-park daily JSON
files under data/parks/{parkId}/{YYYY-MM-DD}.json, prunes entries older than 45 days,
and optionally commits + pushes changes to the repository.

Designed to run from GitHub Actions on a 5-minute cron (operating hours only).
Rate limit: ~7 API calls per run with 1.5s delay (~4.7 calls/min), well under 300/min.
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DATA_DIR = REPO_ROOT / "data" / "parks"
CONFIG_PATH = SCRIPT_DIR / "parks_config.json"
MANIFEST_PATH = REPO_ROOT / "data" / "manifest.json"

MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("collect_wait_times")


def load_config() -> dict[str, Any]:
    with CONFIG_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def is_within_operating_hours(config: dict[str, Any], now: datetime | None = None) -> bool:
    """Return True when local park time is between configured operating hours (default 8 AM–midnight)."""
    tz = ZoneInfo(config.get("timezone", "America/New_York"))
    local_now = (now or datetime.now(timezone.utc)).astimezone(tz)
    start_hour = int(config.get("operatingHourStart", 8))
    end_hour = int(config.get("operatingHourEnd", 24))
    hour = local_now.hour
    return start_hour <= hour < end_hour


def fetch_live_data(api_base: str, park_id: str) -> dict[str, Any]:
    """Fetch live park data with retries and exponential backoff."""
    url = f"{api_base.rstrip('/')}/entity/{park_id}/live"
    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "HurryUpAndWait-Collector/1.0 (+https://github.com/cinkadeusbg/HurryUpAndWait)"},
            )
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            log.warning("Fetch attempt %s/%s failed for %s: %s", attempt, MAX_RETRIES, park_id, exc)
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)

    raise RuntimeError(f"Failed to fetch live data for park {park_id}") from last_error


def extract_wait_time(item: dict[str, Any]) -> int | None:
    queue = item.get("queue") or {}
    standby = queue.get("STANDBY") or {}
    wait = standby.get("waitTime")
    return wait if isinstance(wait, int) else None


def build_snapshot_entries(
    live_response: dict[str, Any],
    collected_at: datetime,
) -> list[dict[str, Any]]:
    """Convert live API items into compact historical entries (rides/attractions only)."""
    entries: list[dict[str, Any]] = []
    iso_timestamp = collected_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for item in live_response.get("liveData", []):
        if item.get("entityType") != "ATTRACTION":
            continue

        entry: dict[str, Any] = {
            "timestamp": iso_timestamp,
            "attractionId": item["id"],
            "name": item.get("name", "Unknown"),
            "status": item.get("status", "UNKNOWN"),
            "waitTime": extract_wait_time(item),
            "entityType": "ATTRACTION",
        }
        entries.append(entry)

    return entries


def daily_file_path(park_id: str, day: date) -> Path:
    return DATA_DIR / park_id / f"{day.isoformat()}.json"


def load_daily_file(path: Path, park: dict[str, str], day: date, timezone_name: str) -> dict[str, Any]:
    if path.exists():
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)

    return {
        "parkId": park["id"],
        "parkName": park["name"],
        "date": day.isoformat(),
        "timezone": timezone_name,
        "entries": [],
    }


def append_entries(path: Path, document: dict[str, Any], new_entries: list[dict[str, Any]], collected_at: datetime) -> bool:
    """Append snapshot entries; skip if an identical timestamp batch already exists."""
    if not new_entries:
        return False

    batch_ts = new_entries[0]["timestamp"]
    existing_ts = {entry["timestamp"] for entry in document.get("entries", [])}
    if batch_ts in existing_ts:
        log.info("Skipping duplicate batch at %s for %s", batch_ts, path)
        return False

    document["lastCollectedAt"] = collected_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    document.setdefault("entries", []).extend(new_entries)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    log.info("Wrote %s entries to %s", len(new_entries), path.relative_to(REPO_ROOT))
    return True


def prune_old_files(config: dict[str, Any]) -> int:
    """Delete daily files older than retentionDays. Returns count of removed files."""
    retention_days = int(config.get("retentionDays", 45))
    cutoff = date.today() - timedelta(days=retention_days)
    removed = 0

    if not DATA_DIR.exists():
        return 0

    for park_dir in DATA_DIR.iterdir():
        if not park_dir.is_dir():
            continue
        for file_path in park_dir.glob("*.json"):
            try:
                file_date = date.fromisoformat(file_path.stem)
            except ValueError:
                continue
            if file_date < cutoff:
                file_path.unlink()
                removed += 1
                log.info("Pruned old file %s", file_path.relative_to(REPO_ROOT))

        # Remove empty park directories
        if park_dir.exists() and not any(park_dir.iterdir()):
            park_dir.rmdir()

    return removed


def build_manifest(config: dict[str, Any]) -> dict[str, Any]:
    parks_manifest: dict[str, Any] = {}

    for park in config["parks"]:
        park_dir = DATA_DIR / park["id"]
        dates: list[str] = []
        if park_dir.exists():
            dates = sorted(path.stem for path in park_dir.glob("*.json"))
        parks_manifest[park["id"]] = {
            "name": park["name"],
            "shortName": park.get("shortName", park["name"]),
            "dates": dates,
        }

    return {
        "lastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "retentionDays": config.get("retentionDays", 45),
        "parks": parks_manifest,
    }


def write_manifest(config: dict[str, Any]) -> None:
    manifest = build_manifest(config)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST_PATH.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    log.info("Updated manifest with %s parks", len(manifest["parks"]))


def git_commit_and_push(changed: bool) -> None:
    """Commit data changes when running inside GitHub Actions."""
    if not changed:
        log.info("No data changes to commit")
        return

    if not (REPO_ROOT / ".git").exists():
        log.info("Not a git repository; skipping commit")
        return

    subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], check=True, cwd=REPO_ROOT)
    subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True, cwd=REPO_ROOT)
    subprocess.run(["git", "add", "data/"], check=True, cwd=REPO_ROOT)

    status = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO_ROOT)
    if status.returncode == 0:
        log.info("No staged changes after git add")
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subprocess.run(
        ["git", "commit", "-m", f"chore(data): collect wait times {timestamp}"],
        check=True,
        cwd=REPO_ROOT,
    )
    # Rebase in case another workflow run committed while this job was collecting.
    pull = subprocess.run(
        ["git", "pull", "--rebase", "origin", "main"],
        cwd=REPO_ROOT,
    )
    if pull.returncode != 0:
        log.error("git pull --rebase failed; aborting push")
        raise RuntimeError("Failed to rebase before push")

    subprocess.run(["git", "push"], check=True, cwd=REPO_ROOT)
    log.info("Committed and pushed data updates")


def collect(config: dict[str, Any], *, commit: bool, force: bool = False) -> int:
    if not force and not is_within_operating_hours(config):
        tz = ZoneInfo(config.get("timezone", "America/New_York"))
        local_now = datetime.now(timezone.utc).astimezone(tz)
        log.info(
            "Outside operating hours (%s local); skipping collection",
            local_now.strftime("%H:%M %Z"),
        )
        return 0

    api_base = config["apiBaseUrl"]
    delay = float(config.get("requestDelaySeconds", 1.5))
    tz_name = config.get("timezone", "America/New_York")
    local_today = datetime.now(ZoneInfo(tz_name)).date()
    collected_at = datetime.now(timezone.utc)
    any_changes = False

    for index, park in enumerate(config["parks"]):
        if index > 0:
            time.sleep(delay)

        log.info("Collecting %s (%s)", park["name"], park["id"])
        live = fetch_live_data(api_base, park["id"])
        entries = build_snapshot_entries(live, collected_at)

        path = daily_file_path(park["id"], local_today)
        document = load_daily_file(path, park, local_today, tz_name)
        if append_entries(path, document, entries, collected_at):
            any_changes = True

    pruned = prune_old_files(config)
    if pruned:
        any_changes = True

    if any_changes:
        write_manifest(config)

    if commit:
        git_commit_and_push(any_changes)

    return 0


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    commit = "--commit" in args
    force = "--force" in args

    config = load_config()

    if not force and not is_within_operating_hours(config):
        log.info("Exiting: outside operating hours (use --force to override)")
        return 0

    try:
        return collect(config, commit=commit, force=force)
    except Exception:
        log.exception("Collection failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())