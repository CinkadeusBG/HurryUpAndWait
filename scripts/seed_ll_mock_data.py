#!/usr/bin/env python3
"""
Seed Turso with mock Lightning Lane history for local / UI testing.

Fetches today's live ILL + park MLL/LLPP prices as baselines, then backfills
at least two weeks of plausible daily snapshots with price drift and sold-out days.

Usage:
  python seed_ll_mock_data.py --schema-only   # ensure tables exist
  python seed_ll_mock_data.py --dry-run       # print counts, no writes
  python seed_ll_mock_data.py                 # insert 16 days (default)
  python seed_ll_mock_data.py --days 21

Environment (or scripts/env.ll-collector):
  TURSO_DATABASE_URL
  TURSO_AUTH_TOKEN
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from collect_ill_daily import (  # noqa: E402
    LIGHTNING_LANE_PREFIX,
    MULTI_PASS_PREFIX,
    PREMIER_PASS_PREFIX,
    SOLD_OUT_STATES,
    build_attraction_lookup,
    ensure_schema,
    fetch_json,
    load_config,
    local_date_key,
    today_operating_purchases,
    turso_execute,
    update_metadata,
    upsert_park_ll_row,
    upsert_row,
)

log = logging.getLogger("seed_ll_mock_data")

DEFAULT_DAYS = 16
PRICE_STEP_CENTS = 100


def load_env_file() -> None:
    env_path = SCRIPT_DIR / "env.ll-collector"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def round_price_cents(value: int) -> int:
    return max(PRICE_STEP_CENTS, int(round(value / PRICE_STEP_CENTS) * PRICE_STEP_CENTS))


def collection_timestamp(local_date: str, hour: int = 23) -> str:
    eastern = ZoneInfo("America/New_York")
    moment = datetime.strptime(local_date, "%Y-%m-%d").replace(
        hour=hour, minute=15, second=0, tzinfo=eastern
    )
    return moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def fetch_ill_baselines(config: dict, local_date: str) -> dict[str, list[dict]]:
    baselines: dict[str, list[dict]] = {}
    api_base = config["apiBaseUrl"].rstrip("/")

    for park in config["wdwParks"]:
        live_payload = fetch_json(f"{api_base}/entity/{park['id']}/live")
        schedule_payload = fetch_json(f"{api_base}/entity/{park['id']}/schedule")
        attraction_lookup = build_attraction_lookup(live_payload.get("liveData") or [])
        purchases = today_operating_purchases(
            schedule_payload.get("schedule") or [], local_date
        )

        rows: list[dict] = []
        seen: set[str] = set()

        for item in live_payload.get("liveData") or []:
            if item.get("entityType") != "ATTRACTION":
                continue
            paid = (item.get("queue") or {}).get("PAID_RETURN_TIME") or {}
            amount = (paid.get("price") or {}).get("amount")
            if amount is None:
                continue
            attraction_id = item["id"]
            seen.add(attraction_id)
            rows.append(
                {
                    "attraction_id": attraction_id,
                    "attraction_name": item.get("name") or "Attraction",
                    "price_cents": int(amount),
                    "sold_out": paid.get("state") in SOLD_OUT_STATES,
                    "source": "live",
                }
            )

        for purchase in purchases:
            purchase_id = purchase.get("id") or ""
            if not purchase_id.startswith(LIGHTNING_LANE_PREFIX):
                continue
            disney_id = purchase_id[len(LIGHTNING_LANE_PREFIX) :]
            attraction = attraction_lookup.get(disney_id)
            if not attraction:
                continue
            attraction_id = attraction["id"]
            if attraction_id in seen:
                continue
            amount = (purchase.get("price") or {}).get("amount")
            if amount is None:
                continue
            rows.append(
                {
                    "attraction_id": attraction_id,
                    "attraction_name": attraction.get("name")
                    or purchase.get("name")
                    or "Attraction",
                    "price_cents": int(amount),
                    "sold_out": not bool(purchase.get("available", True)),
                    "source": "schedule",
                }
            )

        baselines[park["id"]] = rows
        log.info(
            "%s: %s ILL baseline attractions",
            park.get("shortName"),
            len(rows),
        )

    return baselines


def fetch_park_ll_baselines(config: dict, local_date: str) -> dict[str, dict]:
    baselines: dict[str, dict] = {}
    api_base = config["apiBaseUrl"].rstrip("/")

    for park in config["wdwParks"]:
        schedule_payload = fetch_json(f"{api_base}/entity/{park['id']}/schedule")
        purchases = today_operating_purchases(
            schedule_payload.get("schedule") or [], local_date
        )
        multi = next(
            (p for p in purchases if str(p.get("id", "")).startswith(MULTI_PASS_PREFIX)),
            None,
        )
        premier = next(
            (p for p in purchases if str(p.get("id", "")).startswith(PREMIER_PASS_PREFIX)),
            None,
        )
        multi_amount = (multi or {}).get("price", {}).get("amount")
        premier_amount = (premier or {}).get("price", {}).get("amount")
        if multi_amount is None and premier_amount is None:
            log.warning("No park LL baseline for %s", park.get("shortName"))
            continue

        baselines[park["id"]] = {
            "multi_pass_cents": int(multi_amount) if multi_amount is not None else None,
            "multi_pass_sold_out": bool(multi) and not bool(multi.get("available", True)),
            "premier_pass_cents": int(premier_amount)
            if premier_amount is not None
            else None,
            "premier_pass_sold_out": bool(premier)
            and not bool(premier.get("available", True)),
        }
        log.info(
            "%s: MLL %s / LLPP %s",
            park.get("shortName"),
            baselines[park["id"]]["multi_pass_cents"],
            baselines[park["id"]]["premier_pass_cents"],
        )

    return baselines


def date_range(days: int, end: datetime) -> list[str]:
    dates: list[str] = []
    for offset in range(days - 1, -1, -1):
        dates.append(local_date_key(end - timedelta(days=offset)))
    return dates


def sold_out_chance(local_date: str) -> float:
    weekday = datetime.strptime(local_date, "%Y-%m-%d").weekday()
    return 0.34 if weekday >= 5 else 0.14


def extrapolate_ill_price(
    base_cents: int,
    day_index: int,
    total_days: int,
    local_date: str,
    attraction_id: str,
    rng: random.Random,
) -> int:
    progress = day_index / max(total_days - 1, 1)
    historical_discount = int((1 - progress) * 500)
    weekend_boost = 200 if datetime.strptime(local_date, "%Y-%m-%d").weekday() >= 5 else 0
    jitter = rng.randint(-250, 250)
    return round_price_cents(base_cents - historical_discount + weekend_boost + jitter)


def extrapolate_park_price(
    base_cents: int | None,
    day_index: int,
    total_days: int,
    local_date: str,
    rng: random.Random,
) -> int | None:
    if base_cents is None:
        return None
    progress = day_index / max(total_days - 1, 1)
    historical_discount = int((1 - progress) * 300)
    weekend_boost = 100 if datetime.strptime(local_date, "%Y-%m-%d").weekday() >= 5 else 0
    jitter = rng.randint(-150, 150)
    return round_price_cents(base_cents - historical_discount + weekend_boost + jitter)


def build_mock_rows(
    config: dict,
    days: int,
    seed: int,
) -> tuple[list[dict], list[dict]]:
    eastern = ZoneInfo(config.get("timezone", "America/New_York"))
    end = datetime.now(eastern)
    dates = date_range(days, end)
    today = local_date_key(end)
    rng = random.Random(seed)

    ill_baselines = fetch_ill_baselines(config, today)
    park_baselines = fetch_park_ll_baselines(config, today)

    ill_rows: list[dict] = []
    park_rows: list[dict] = []

    for day_index, local_date in enumerate(dates):
        collected_at = collection_timestamp(local_date)
        chance = sold_out_chance(local_date)

        for park in config["wdwParks"]:
            park_id = park["id"]
            park_ll = park_baselines.get(park_id)
            if park_ll:
                day_rng = random.Random(f"{seed}:park:{park_id}:{local_date}")
                park_rows.append(
                    {
                        "park_id": park_id,
                        "park_name": park["name"],
                        "local_date": local_date,
                        "collected_at": collected_at,
                        "multi_pass_cents": extrapolate_park_price(
                            park_ll["multi_pass_cents"],
                            day_index,
                            len(dates),
                            local_date,
                            day_rng,
                        ),
                        "multi_pass_sold_out": day_rng.random() < (chance * 0.55),
                        "premier_pass_cents": extrapolate_park_price(
                            park_ll["premier_pass_cents"],
                            day_index,
                            len(dates),
                            local_date,
                            day_rng,
                        ),
                        "premier_pass_sold_out": day_rng.random() < (chance * 0.12),
                    }
                )

            for attraction in ill_baselines.get(park_id, []):
                day_rng = random.Random(
                    f"{seed}:ill:{attraction['attraction_id']}:{local_date}"
                )
                sold_out = day_rng.random() < chance
                ill_rows.append(
                    {
                        "park_id": park_id,
                        "park_name": park["name"],
                        "local_date": local_date,
                        "collected_at": collected_at,
                        "attraction_id": attraction["attraction_id"],
                        "attraction_name": attraction["attraction_name"],
                        "price_cents": extrapolate_ill_price(
                            attraction["price_cents"],
                            day_index,
                            len(dates),
                            local_date,
                            attraction["attraction_id"],
                            day_rng,
                        ),
                        "sold_out": sold_out,
                        "source": attraction["source"],
                    }
                )

    return ill_rows, park_rows


def write_rows(
    database_url: str,
    auth_token: str,
    ill_rows: list[dict],
    park_rows: list[dict],
) -> None:
    for row in ill_rows:
        upsert_row(database_url, auth_token, row)
    for row in park_rows:
        upsert_park_ll_row(database_url, auth_token, row)
    update_metadata(database_url, auth_token)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Seed mock Lightning Lane history in Turso")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="Days of history")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed for reproducibility")
    parser.add_argument("--schema-only", action="store_true", help="Apply schema only")
    parser.add_argument("--dry-run", action="store_true", help="Build rows without writing")
    args = parser.parse_args()

    if args.days < 14:
        parser.error("--days must be at least 14 for table testing")

    load_env_file()
    database_url = os.environ.get("TURSO_DATABASE_URL", "").strip()
    auth_token = os.environ.get("TURSO_AUTH_TOKEN", "").strip()

    if args.schema_only or not args.dry_run:
        if not database_url or not auth_token:
            log.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (or scripts/env.ll-collector)")
            return 1

    config = load_config()

    if args.schema_only:
        ensure_schema(database_url, auth_token)
        log.info("Schema applied")
        return 0

    ill_rows, park_rows = build_mock_rows(config, args.days, args.seed)
    dates = sorted({row["local_date"] for row in park_rows})
    log.info(
        "Built %s ILL rows and %s park LL rows across %s days (%s .. %s)",
        len(ill_rows),
        len(park_rows),
        len(dates),
        dates[0] if dates else "?",
        dates[-1] if dates else "?",
    )

    if args.dry_run:
        print(json.dumps({"illRows": len(ill_rows), "parkRows": len(park_rows), "dates": dates}, indent=2))
        return 0

    ensure_schema(database_url, auth_token)
    write_rows(database_url, auth_token, ill_rows, park_rows)
    log.info("Mock Lightning Lane history seeded successfully")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())