"""Arma exportaciones pequeñas en una carpeta temporal, con las columnas exactas de export:data."""

import csv
import itertools
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from export_columns import (
    BOGOTA,
    CHECK_IN_COLUMNS,
    CHECK_INS_FILE,
    RESERVATION_COLUMNS,
    RESERVATIONS_FILE,
    TABLE_LOG_COLUMNS,
    TABLE_LOGS_FILE,
)

RESTAURANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_ids = itertools.count(1)


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def iso(instant: datetime) -> str:
    """Igual que Date.toISOString()."""
    instant = instant.astimezone(timezone.utc)
    return instant.strftime("%Y-%m-%dT%H:%M:%S.") + f"{instant.microsecond // 1000:03d}Z"


def new_id() -> str:
    return str(uuid.UUID(int=next(_ids), version=4))


def reservation(status: str, created: datetime, seconds: int = 300, restaurant_id: str = RESTAURANT_A) -> dict:
    """Una fila de reservations.csv coherente: cierre, no_show, día, hora y segundos."""
    closed = None if status == "active" else created + timedelta(seconds=seconds)
    local = created.astimezone(BOGOTA)
    return {
        "reservation_id": new_id(),
        "diner_pseudonym": "0123456789abcdef",
        "restaurant_id": restaurant_id,
        "restaurant_category": "colombian",
        "table_capacity": 2,
        "party_size": 2,
        "status": status,
        "created_at": iso(created),
        "expires_at": iso(created + timedelta(minutes=15)),
        "expired_at": iso(closed) if status == "expired" else "",
        "cancelled_at": iso(closed) if status == "cancelled" else "",
        "checked_in_at": iso(closed) if status == "completed" else "",
        "no_show": "true" if status == "expired" else "false",
        "day_of_week": local.isoweekday(),
        "hour_of_day": local.hour,
        "seconds_to_expire_or_resolve": "" if closed is None else seconds,
    }


def manual_log(changed_at: datetime, restaurant_id: str = RESTAURANT_A, source: str = "manual") -> dict:
    return {
        "log_id": new_id(),
        "restaurant_id": restaurant_id,
        "table_id": "30000000-0000-4000-8000-000000000001",
        "previous_status": "available",
        "new_status": "occupied",
        "source": source,
        "changed_at": iso(changed_at),
        "actor_type": "restaurant_admin" if source == "manual" else "system",
    }


def write_export(folder: Path, reservations=(), check_ins=(), logs=()) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    for name, columns, rows in (
        (RESERVATIONS_FILE, RESERVATION_COLUMNS, reservations),
        (CHECK_INS_FILE, CHECK_IN_COLUMNS, check_ins),
        (TABLE_LOGS_FILE, TABLE_LOG_COLUMNS, logs),
    ):
        with (folder / name).open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=columns, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
    return folder


def resolved_mix(completed: int, others: int, others_status: str = "cancelled") -> list[dict]:
    """`completed` reservas con check-in y `others` con otro final, repartidas entre el 2 y el 3 de nov (Bogotá)."""
    statuses = ["completed"] * completed + [others_status] * others
    days = (utc("2026-11-02T17:00:00Z"), utc("2026-11-03T17:00:00Z"))
    return [
        reservation(status, days[index % 2] + timedelta(minutes=index)) for index, status in enumerate(statuses)
    ]
