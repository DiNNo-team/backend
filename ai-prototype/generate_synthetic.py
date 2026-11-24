"""Genera una carpeta de CSV sintéticos con el formato de `npm run export:data`.

Tres restaurantes ficticios durante varios días (14 por defecto):
- uno que valida casi todos los códigos y actualiza sus mesas a diario;
- uno con muchas reservas vencidas sin check-in y casi sin cambios manuales;
- uno nuevo, con tan pocas reservas que el informe dice "datos insuficientes".

Los datos son inventados y reproducibles (misma semilla, mismos CSV). No
representan a ningún restaurante ni comensal real.

Uso:
    python generate_synthetic.py --output datos-sinteticos
"""

import argparse
import csv
import random
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
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

RESERVATION_TTL = timedelta(minutes=15)


@dataclass(frozen=True)
class Profile:
    """Comportamiento de un restaurante ficticio."""

    category: str
    table_capacities: tuple[int, ...]
    reservations_per_day: float
    outcome_weights: tuple[float, float, float]  # completed, cancelled, expired
    manual_update_chance: float  # probabilidad de actualizar mesas a mano cada día


PROFILES = (
    Profile("colombian", (2, 2, 4, 4, 4, 6, 6, 8), 4.0, (0.78, 0.10, 0.12), 0.95),
    Profile("italian", (2, 4, 4, 6, 8), 3.0, (0.35, 0.20, 0.45), 0.15),
    Profile("cafe", (2, 2, 4), 0.4, (0.60, 0.20, 0.20), 0.50),
)

# Franjas de almuerzo y comida, en hora de Bogotá (más peso al mediodía).
BUSY_HOURS = (12, 12, 13, 13, 13, 14, 19, 19, 20, 20, 21)


def iso_utc(instant: datetime) -> str:
    """Igual que Date.toISOString(): UTC, milisegundos y Z."""
    utc = instant.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def bogota_parts(instant: datetime) -> tuple[int, int]:
    local = instant.astimezone(BOGOTA)
    return local.isoweekday(), local.hour


def new_id(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def pseudonym(rng: random.Random) -> str:
    return f"{rng.getrandbits(64):016x}"


class Exporter:
    """Acumula las filas de los tres CSV."""

    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.reservations: list[list[object]] = []
        self.check_ins: list[list[object]] = []
        self.table_logs: list[list[object]] = []

    def log(
        self,
        restaurant_id: str,
        table_id: str,
        previous: str,
        new: str,
        source: str,
        at: datetime,
        actor: str,
    ) -> None:
        self.table_logs.append(
            [new_id(self.rng), restaurant_id, table_id, previous, new, source, iso_utc(at), actor]
        )


def pick_table(tables: list[tuple[str, int]], party_size: int) -> tuple[str, int]:
    """La mesa más pequeña que alcanza (regla de asignación de §12.1)."""
    fitting = [table for table in tables if table[1] >= party_size]
    return min(fitting, key=lambda table: table[1])


def add_reservation(
    exporter: Exporter,
    restaurant_id: str,
    profile: Profile,
    tables: list[tuple[str, int]],
    diners: list[str],
    created_at: datetime,
    outcome: str,
) -> None:
    rng = exporter.rng
    largest = max(capacity for _, capacity in tables)
    party_size = min(rng.choice((1, 2, 2, 2, 3, 4, 4, 5, 6)), largest)
    table_id, capacity = pick_table(tables, party_size)
    reservation_id = new_id(rng)
    expires_at = created_at + RESERVATION_TTL
    expired_at = cancelled_at = checked_in_at = None

    exporter.log(restaurant_id, table_id, "available", "reserved", "reservation", created_at, "diner")
    if outcome == "completed":
        checked_in_at = created_at + timedelta(seconds=rng.randint(120, 840))
        exporter.log(
            restaurant_id, table_id, "reserved", "occupied", "reservation", checked_in_at, "restaurant_admin"
        )
        day_of_week, hour = bogota_parts(checked_in_at)
        exporter.check_ins.append(
            [new_id(rng), reservation_id, restaurant_id, iso_utc(checked_in_at), day_of_week, hour]
        )
    elif outcome == "cancelled":
        cancelled_at = created_at + timedelta(seconds=rng.randint(60, 600))
        exporter.log(restaurant_id, table_id, "reserved", "available", "reservation", cancelled_at, "diner")
    elif outcome == "expired":
        # El barrido corre cada 15 s: expired_at queda un poco después de expires_at.
        expired_at = expires_at + timedelta(seconds=rng.randint(0, 15))
        exporter.log(restaurant_id, table_id, "reserved", "available", "system", expired_at, "system")

    closed_at = cancelled_at or expired_at or checked_in_at
    seconds = None if closed_at is None else round((closed_at - created_at).total_seconds())
    day_of_week, hour = bogota_parts(created_at)
    exporter.reservations.append(
        [
            reservation_id,
            rng.choice(diners),
            restaurant_id,
            profile.category,
            capacity,
            party_size,
            outcome,
            iso_utc(created_at),
            iso_utc(expires_at),
            iso_utc(expired_at) if expired_at else "",
            iso_utc(cancelled_at) if cancelled_at else "",
            iso_utc(checked_in_at) if checked_in_at else "",
            "true" if outcome == "expired" else "false",
            day_of_week,
            hour,
            "" if seconds is None else seconds,
        ]
    )


def add_manual_updates(
    exporter: Exporter, restaurant_id: str, tables: list[tuple[str, int]], day: date
) -> None:
    """Cambios a mano del restaurante en un día: mesas que se ocupan y se liberan."""
    rng = exporter.rng
    for _ in range(rng.randint(2, 6)):
        table_id, _ = rng.choice(tables)
        hour = rng.choice(BUSY_HOURS)
        start = datetime(day.year, day.month, day.day, hour, rng.randint(0, 59), tzinfo=BOGOTA)
        end = start + timedelta(minutes=rng.randint(40, 110))
        exporter.log(restaurant_id, table_id, "available", "occupied", "manual", start, "restaurant_admin")
        exporter.log(restaurant_id, table_id, "occupied", "available", "manual", end, "restaurant_admin")


def generate(start: date, days: int, seed: int) -> Exporter:
    rng = random.Random(seed)
    exporter = Exporter(rng)
    diners = [pseudonym(rng) for _ in range(30)]
    outcomes = ("completed", "cancelled", "expired")

    for profile in PROFILES:
        restaurant_id = new_id(rng)
        tables = [(new_id(rng), capacity) for capacity in profile.table_capacities]
        for offset in range(days):
            day = start + timedelta(days=offset)
            if rng.random() < profile.manual_update_chance:
                add_manual_updates(exporter, restaurant_id, tables, day)
            # Más reservas el viernes y el sábado, y variación de un día a otro.
            mean = profile.reservations_per_day * (1.5 if day.isoweekday() in (5, 6) else 1.0)
            count = max(0, round(rng.gauss(mean, mean * 0.5)))
            for _ in range(count):
                local = datetime(
                    day.year, day.month, day.day, rng.choice(BUSY_HOURS), rng.randint(0, 59),
                    rng.randint(0, 59), rng.randint(0, 999) * 1000, tzinfo=BOGOTA,
                )
                outcome = rng.choices(outcomes, weights=profile.outcome_weights)[0]
                add_reservation(exporter, restaurant_id, profile, tables, diners, local, outcome)

        # Una reserva todavía activa al momento de exportar (no cuenta como resuelta).
        last_day = start + timedelta(days=days - 1)
        local = datetime(last_day.year, last_day.month, last_day.day, 21, 50, tzinfo=BOGOTA)
        add_reservation(exporter, restaurant_id, profile, tables, diners, local, "active")

    exporter.reservations.sort(key=lambda row: row[7])
    exporter.check_ins.sort(key=lambda row: row[3])
    exporter.table_logs.sort(key=lambda row: row[6])
    return exporter


def write_csv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera CSV sintéticos con el formato de export:data.")
    parser.add_argument("--output", required=True, type=Path, help="Carpeta donde se escriben los CSV.")
    parser.add_argument("--start", default="2026-10-26", help="Primer día, en hora de Bogotá (AAAA-MM-DD).")
    parser.add_argument("--days", type=int, default=14, help="Cantidad de días (por defecto 14).")
    parser.add_argument("--seed", type=int, default=42, help="Semilla para repetir los mismos datos.")
    args = parser.parse_args()
    if args.days < 1:
        parser.error("--days debe ser 1 o más.")

    exporter = generate(date.fromisoformat(args.start), args.days, args.seed)
    args.output.mkdir(parents=True, exist_ok=True)
    write_csv(args.output / RESERVATIONS_FILE, RESERVATION_COLUMNS, exporter.reservations)
    write_csv(args.output / CHECK_INS_FILE, CHECK_IN_COLUMNS, exporter.check_ins)
    write_csv(args.output / TABLE_LOGS_FILE, TABLE_LOG_COLUMNS, exporter.table_logs)
    print(
        f"Listo: {len(exporter.reservations)} reservas, {len(exporter.check_ins)} check-ins y "
        f"{len(exporter.table_logs)} registros de bitácora en {args.output}"
    )


if __name__ == "__main__":
    main()
