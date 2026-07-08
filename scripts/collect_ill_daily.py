#!/usr/bin/env python3
"""
Collect end-of-day Lightning Lane prices for WDW parks.

Designed to run once per evening (default 8 PM–11 PM America/New_York) via cron
on the *arr server Docker host. Writes:
  - one row per attraction per park per day into `ill_daily_snapshots` (ILL)
  - one row per park per day into `park_ll_daily_snapshots` (MLL + LLPP)

Usage:
  python collect_ill_daily.py                  # normal evening run (8–11 PM ET)
  python collect_ill_daily.py --schema-only    # apply Turso migrations only
  python collect_ill_daily.py --ignore-hours  # test run anytime

Environment:
  TURSO_DATABASE_URL   libsql://...
  TURSO_AUTH_TOKEN     read-write token
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("collect_ill_daily")

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / "parks_config.json"
SCHEMA_PATHS = [
    SCRIPT_DIR / "sql" / "ill_daily_snapshots.sql",
    SCRIPT_DIR / "sql" / "park_ll_daily_snapshots.sql",
]

LIGHTNING_LANE_PREFIX = "lightninglane_"
MULTI_PASS_PREFIX = "lightninglanemultipass_"
PREMIER_PASS_PREFIX = "premierpass_"
SOLD_OUT_STATES = {"FINISHED", "TEMP_FULL"}


def load_config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def encode_arg(value) -> dict:
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    return {"type": "text", "value": str(value)}


def turso_execute(database_url: str, auth_token: str, sql: str, args: list | None = None) -> None:
    pipeline_url = database_url.replace("libsql://", "https://").rstrip("/") + "/v2/pipeline"
    stmt: dict = {"sql": sql}
    if args:
        stmt["args"] = [encode_arg(arg) for arg in args]

    body = json.dumps({"requests": [{"type": "execute", "stmt": stmt}]}).encode("utf-8")
    request = urllib.request.Request(
        pipeline_url,
        data=body,
        headers={
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Turso HTTP {exc.code}: {detail}") from exc

    results = payload.get("results") or []
    if not results:
        raise RuntimeError(f"Turso returned no results for: {sql[:80]}")

    first = results[0]
    if first.get("type") != "ok":
        raise RuntimeError(f"Turso error: {json.dumps(first)}")


def ensure_schema(database_url: str, auth_token: str) -> None:
    for schema_path in SCHEMA_PATHS:
        if not schema_path.exists():
            log.warning("Schema file missing at %s", schema_path)
            continue

        sql = schema_path.read_text(encoding="utf-8")
        for statement in (part.strip() for part in sql.split(";")):
            if statement:
                turso_execute(database_url, auth_token, statement)


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def eastern_now() -> datetime:
    return datetime.now(ZoneInfo("America/New_York"))


def local_date_key(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%d")


def within_collection_window(config: dict, moment: datetime) -> bool:
    start = int(config.get("collectionHourStart", 20))
    end = int(config.get("collectionHourEnd", 23))
    return start <= moment.hour <= end


def disney_id_from_external_id(external_id: str | None) -> str | None:
    if not external_id:
        return None
    disney_id = external_id.split(";")[0].strip()
    return disney_id or None


def build_attraction_lookup(live_data: list[dict]) -> dict[str, dict]:
    lookup: dict[str, dict] = {}
    for item in live_data:
        if item.get("entityType") != "ATTRACTION":
            continue
        disney_id = disney_id_from_external_id(item.get("externalId"))
        if disney_id:
            lookup[disney_id] = item
    return lookup


def today_operating_purchases(schedule: list[dict], local_date: str) -> list[dict]:
    for entry in schedule:
        if entry.get("date") == local_date and entry.get("type") == "OPERATING":
            return entry.get("purchases") or []
    return []


def paid_return_sold_out(state: str | None) -> bool:
    return state in SOLD_OUT_STATES


def resolve_ill_rows(
    park: dict,
    live_payload: dict,
    schedule_payload: dict,
    local_date: str,
) -> list[dict]:
    live_data = live_payload.get("liveData") or []
    schedule = schedule_payload.get("schedule") or []
    attraction_lookup = build_attraction_lookup(live_data)
    purchases = today_operating_purchases(schedule, local_date)

    rows_by_attraction: dict[str, dict] = {}

    for item in live_data:
        if item.get("entityType") != "ATTRACTION":
            continue

        paid = (item.get("queue") or {}).get("PAID_RETURN_TIME") or {}
        price = paid.get("price") or {}
        amount = price.get("amount")
        if amount is None:
            continue

        attraction_id = item["id"]
        rows_by_attraction[attraction_id] = {
            "attraction_id": attraction_id,
            "attraction_name": item.get("name") or "Attraction",
            "price_cents": int(amount),
            "sold_out": paid_return_sold_out(paid.get("state")),
            "source": "live",
        }

    for purchase in purchases:
        purchase_id = purchase.get("id") or ""
        if not purchase_id.startswith(LIGHTNING_LANE_PREFIX):
            continue

        disney_id = purchase_id[len(LIGHTNING_LANE_PREFIX) :]
        attraction = attraction_lookup.get(disney_id)
        if not attraction:
            log.warning(
                "No live attraction match for schedule ILL %s in %s",
                purchase_id,
                park.get("shortName"),
            )
            continue

        attraction_id = attraction["id"]
        if attraction_id in rows_by_attraction:
            continue

        price = purchase.get("price") or {}
        amount = price.get("amount")
        if amount is None:
            continue

        rows_by_attraction[attraction_id] = {
            "attraction_id": attraction_id,
            "attraction_name": attraction.get("name") or purchase.get("name") or "Attraction",
            "price_cents": int(amount),
            "sold_out": not bool(purchase.get("available", True)),
            "source": "schedule",
        }

    collected_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )

    rows = []
    for row in rows_by_attraction.values():
        rows.append(
            {
                "park_id": park["id"],
                "park_name": park["name"],
                "local_date": local_date,
                "collected_at": collected_at,
                **row,
            }
        )

    return rows


def resolve_park_ll_row(
    park: dict,
    schedule_payload: dict,
    local_date: str,
) -> dict | None:
    schedule = schedule_payload.get("schedule") or []
    purchases = today_operating_purchases(schedule, local_date)

    multi = next(
        (purchase for purchase in purchases if purchase.get("id", "").startswith(MULTI_PASS_PREFIX)),
        None,
    )
    premier = next(
        (purchase for purchase in purchases if purchase.get("id", "").startswith(PREMIER_PASS_PREFIX)),
        None,
    )

    multi_amount = (multi or {}).get("price", {}).get("amount")
    premier_amount = (premier or {}).get("price", {}).get("amount")

    if multi_amount is None and premier_amount is None:
        return None

    collected_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )

    return {
        "park_id": park["id"],
        "park_name": park["name"],
        "local_date": local_date,
        "collected_at": collected_at,
        "multi_pass_cents": int(multi_amount) if multi_amount is not None else None,
        "multi_pass_sold_out": bool(multi) and not bool(multi.get("available", True)),
        "premier_pass_cents": int(premier_amount) if premier_amount is not None else None,
        "premier_pass_sold_out": bool(premier) and not bool(premier.get("available", True)),
    }


def upsert_park_ll_row(database_url: str, auth_token: str, row: dict) -> None:
    turso_execute(
        database_url,
        auth_token,
        """
        INSERT INTO park_ll_daily_snapshots (
          park_id,
          park_name,
          local_date,
          collected_at,
          multi_pass_cents,
          multi_pass_sold_out,
          premier_pass_cents,
          premier_pass_sold_out
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(park_id, local_date) DO UPDATE SET
          collected_at = excluded.collected_at,
          park_name = excluded.park_name,
          multi_pass_cents = excluded.multi_pass_cents,
          multi_pass_sold_out = excluded.multi_pass_sold_out,
          premier_pass_cents = excluded.premier_pass_cents,
          premier_pass_sold_out = excluded.premier_pass_sold_out
        """,
        [
            row["park_id"],
            row["park_name"],
            row["local_date"],
            row["collected_at"],
            row["multi_pass_cents"],
            1 if row["multi_pass_sold_out"] else 0,
            row["premier_pass_cents"],
            1 if row["premier_pass_sold_out"] else 0,
        ],
    )


def upsert_row(database_url: str, auth_token: str, row: dict) -> None:
    turso_execute(
        database_url,
        auth_token,
        """
        INSERT INTO ill_daily_snapshots (
          park_id,
          park_name,
          local_date,
          collected_at,
          attraction_id,
          attraction_name,
          price_cents,
          sold_out,
          source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(park_id, local_date, attraction_id) DO UPDATE SET
          collected_at = excluded.collected_at,
          attraction_name = excluded.attraction_name,
          price_cents = excluded.price_cents,
          sold_out = excluded.sold_out,
          source = excluded.source
        """,
        [
            row["park_id"],
            row["park_name"],
            row["local_date"],
            row["collected_at"],
            row["attraction_id"],
            row["attraction_name"],
            row["price_cents"],
            1 if row["sold_out"] else 0,
            row["source"],
        ],
    )


def prune_old_rows(database_url: str, auth_token: str, retention_days: int) -> None:
    cutoff = eastern_now().date().toordinal() - retention_days
    cutoff_date = datetime.fromordinal(cutoff).strftime("%Y-%m-%d")
    for table in ("ill_daily_snapshots", "park_ll_daily_snapshots"):
        turso_execute(
            database_url,
            auth_token,
            f"DELETE FROM {table} WHERE local_date < ?",
            [cutoff_date],
        )


def update_metadata(database_url: str, auth_token: str) -> None:
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
    for key in ("last_ill_collected", "last_park_ll_collected"):
        turso_execute(
            database_url,
            auth_token,
            """
            INSERT INTO collection_metadata (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            [key, timestamp],
        )


def collect_park(
    config: dict,
    park: dict,
    database_url: str,
    auth_token: str,
    local_date: str,
) -> int:
    api_base = config["apiBaseUrl"].rstrip("/")
    park_id = park["id"]

    live_payload = fetch_json(f"{api_base}/entity/{park_id}/live")
    time.sleep(float(config.get("requestDelaySeconds", 1.5)))
    schedule_payload = fetch_json(f"{api_base}/entity/{park_id}/schedule")

    park_ll_row = resolve_park_ll_row(park, schedule_payload, local_date)
    if park_ll_row:
        upsert_park_ll_row(database_url, auth_token, park_ll_row)
        log.info(
            "Park LL %s: MLL=$%s sold_out=%s | LLPP=$%s sold_out=%s",
            park.get("shortName"),
            (park_ll_row["multi_pass_cents"] + 99) // 100
            if park_ll_row["multi_pass_cents"] is not None
            else "—",
            park_ll_row["multi_pass_sold_out"],
            (park_ll_row["premier_pass_cents"] + 99) // 100
            if park_ll_row["premier_pass_cents"] is not None
            else "—",
            park_ll_row["premier_pass_sold_out"],
        )

    rows = resolve_ill_rows(park, live_payload, schedule_payload, local_date)
    if not rows and not park_ll_row:
        log.info("No Lightning Lane rows for %s on %s", park.get("shortName"), local_date)
        return 0

    inserted = 1 if park_ll_row else 0
    for row in rows:
        upsert_row(database_url, auth_token, row)
        inserted += 1
        log.info(
            "ILL %s: %s $%s sold_out=%s (%s)",
            park.get("shortName"),
            row["attraction_name"],
            (row["price_cents"] + 99) // 100,
            row["sold_out"],
            row["source"],
        )

    return inserted


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Collect daily WDW Lightning Lane prices (ILL + MLL/LLPP) into Turso"
    )
    parser.add_argument(
        "--schema-only",
        action="store_true",
        help="Apply Turso schema migrations only (no API calls)",
    )
    parser.add_argument(
        "--ignore-hours",
        action="store_true",
        help="Skip the evening collection window check (for testing)",
    )
    args = parser.parse_args()

    database_url = os.environ.get("TURSO_DATABASE_URL", "").strip()
    auth_token = os.environ.get("TURSO_AUTH_TOKEN", "").strip()
    if not database_url or not auth_token:
        log.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN")
        return 1

    if args.schema_only:
        ensure_schema(database_url, auth_token)
        log.info("Schema migration complete (ill_daily_snapshots + park_ll_daily_snapshots)")
        return 0

    config = load_config()
    now = eastern_now()
    local_date = local_date_key(now)

    if not args.ignore_hours and not within_collection_window(config, now):
        log.info(
            "Outside collection window (%s:00–%s:00 ET); skipping",
            config.get("collectionHourStart", 20),
            config.get("collectionHourEnd", 23),
        )
        return 0

    ensure_schema(database_url, auth_token)

    total = 0
    for park in config.get("wdwParks", []):
        try:
            total += collect_park(
                config,
                park,
                database_url,
                auth_token,
                local_date,
            )
        except Exception:
            log.exception("Failed collecting ILL for %s", park.get("shortName"))
        time.sleep(float(config.get("requestDelaySeconds", 1.5)))

    if total:
        update_metadata(database_url, auth_token)
        prune_old_rows(database_url, auth_token, int(config.get("retentionDays", 45)))

    log.info("Lightning Lane collection complete: %s rows for %s", total, local_date)
    return 0


if __name__ == "__main__":
    sys.exit(main())