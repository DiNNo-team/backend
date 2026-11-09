"""Lee una carpeta exportada y calcula las métricas de cada restaurante.

Secciones 4.2, 4.3 y 5 de `docs/ia-diseno.md`. Solo usa datos agregados:
nunca lee ni devuelve el seudónimo del comensal.
"""

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from export_columns import BOGOTA, CHECK_INS_FILE, EXPECTED_COLUMNS, RESERVATIONS_FILE, TABLE_LOGS_FILE

RESOLVED_STATUSES = ("completed", "cancelled", "expired")
HIGH_CHECK_IN_RATE = 0.70
LOW_CHECK_IN_RATE = 0.40


class ExportFormatError(Exception):
    """La carpeta no tiene el formato de `npm run export:data`."""


@dataclass
class Slot:
    day_of_week: int
    hour: int
    reservations: int


@dataclass
class RestaurantMetrics:
    restaurant_id: str
    category: str | None
    period_start: date
    period_end: date
    days_in_period: int
    min_resolved: int  # umbral de reservas resueltas para calcular tasas e indicador
    data_sufficiency: str  # "enough" o "insufficient"
    reservations_created: int
    active: int
    resolved: int
    completed: int
    cancelled: int
    expired: int
    check_ins: int
    check_in_rate: float | None
    no_show_rate: float | None
    cancellation_rate: float | None
    avg_minutes_to_resolve: float | None
    avg_minutes_by_status: dict[str, float]
    reservations_by_day_of_week: dict[int, int]
    reservations_by_date: dict[str, int]
    top_slots: list[Slot]
    manual_changes: int
    manual_changes_per_day: float
    days_with_manual_changes: int
    days_without_manual_changes: int
    reliability_level: str | None  # "alta", "media", "baja"; None sin datos suficientes
    reliability_reasons: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        data = asdict(self)
        data["period_start"] = self.period_start.isoformat()
        data["period_end"] = self.period_end.isoformat()
        return data


def load_export(folder: Path) -> dict[str, pd.DataFrame]:
    """Carga los tres CSV y comprueba que tengan exactamente las columnas esperadas."""
    frames = {}
    for file_name, expected in EXPECTED_COLUMNS.items():
        path = folder / file_name
        if not path.is_file():
            raise ExportFormatError(f"Falta {file_name} en {folder}.")
        frame = pd.read_csv(path, dtype=str, keep_default_na=False)
        if list(frame.columns) != expected:
            missing = [name for name in expected if name not in frame.columns]
            extra = [name for name in frame.columns if name not in expected]
            raise ExportFormatError(
                f"{file_name} no tiene las columnas de export:data. "
                f"Faltan: {missing or 'ninguna'}. Sobran: {extra or 'ninguna'}. "
                "Si solo cambió el orden, revisa que el archivo venga sin editar."
            )
        frames[file_name] = frame

    reservations = frames[RESERVATIONS_FILE]
    for column in ("created_at", "expires_at", "expired_at", "cancelled_at", "checked_in_at"):
        reservations[column] = pd.to_datetime(reservations[column], utc=True, errors="raise")
    for column in ("table_capacity", "party_size", "day_of_week", "hour_of_day"):
        reservations[column] = pd.to_numeric(reservations[column], errors="raise").astype(int)
    # Vacío = la reserva sigue activa.
    reservations["seconds_to_expire_or_resolve"] = pd.to_numeric(
        reservations["seconds_to_expire_or_resolve"].replace("", None), errors="raise"
    )
    frames[CHECK_INS_FILE]["checked_in_at"] = pd.to_datetime(frames[CHECK_INS_FILE]["checked_in_at"], utc=True)
    frames[TABLE_LOGS_FILE]["changed_at"] = pd.to_datetime(frames[TABLE_LOGS_FILE]["changed_at"], utc=True)
    return frames


def bogota_dates(instants: pd.Series) -> pd.Series:
    return instants.dt.tz_convert(BOGOTA).dt.date


def export_period(frames: dict[str, pd.DataFrame]) -> list[date]:
    """Todos los días (hora de Bogotá) entre el primer y el último dato de la exportación."""
    instants = pd.concat(
        [
            frames[RESERVATIONS_FILE]["created_at"],
            frames[CHECK_INS_FILE]["checked_in_at"],
            frames[TABLE_LOGS_FILE]["changed_at"],
        ]
    ).dropna()
    if instants.empty:
        raise ExportFormatError("La exportación no tiene ninguna fila: no hay nada que analizar.")
    days = bogota_dates(instants)
    first, last = min(days), max(days)
    return [first + timedelta(days=offset) for offset in range((last - first).days + 1)]


def rate(part: int, total: int) -> float | None:
    return part / total if total else None


def minutes(seconds: pd.Series) -> float | None:
    return None if seconds.empty else round(float(seconds.mean()) / 60, 1)


def top_slots(reservations: pd.DataFrame, limit: int = 3) -> list[Slot]:
    counts = reservations.groupby(["day_of_week", "hour_of_day"]).size().reset_index(name="count")
    counts = counts.sort_values(["count", "day_of_week", "hour_of_day"], ascending=[False, True, True])
    return [Slot(int(row.day_of_week), int(row.hour_of_day), int(row.count)) for row in counts.head(limit).itertuples()]


def reliability(metrics: RestaurantMetrics) -> tuple[str | None, list[str]]:
    """Regla inicial de la sección 5 del diseño (umbrales por confirmar con el piloto).

    El diseño habla de «días abiertos»; la exportación no trae el historial de
    Abierto/Cerrado ni los horarios, así que el prototipo usa los días del periodo.
    """
    if metrics.data_sufficiency == "insufficient":
        return None, []
    check_in_pct = round(metrics.check_in_rate * 100)
    reasons = [
        f"Tasa de check-in del {check_in_pct} %",
        f"Cambios manuales de mesas en {metrics.days_with_manual_changes} de {metrics.days_in_period} días",
    ]
    most_days = metrics.days_with_manual_changes > metrics.days_in_period / 2
    if metrics.check_in_rate >= HIGH_CHECK_IN_RATE and most_days:
        return "alta", reasons
    if metrics.check_in_rate < LOW_CHECK_IN_RATE or metrics.manual_changes == 0:
        return "baja", reasons
    return "media", reasons


def restaurant_metrics(
    restaurant_id: str, frames: dict[str, pd.DataFrame], period: list[date], min_resolved: int
) -> RestaurantMetrics:
    reservations = frames[RESERVATIONS_FILE]
    reservations = reservations[reservations["restaurant_id"] == restaurant_id]
    check_ins = frames[CHECK_INS_FILE]
    check_ins = check_ins[check_ins["restaurant_id"] == restaurant_id]
    logs = frames[TABLE_LOGS_FILE]
    manual = logs[(logs["restaurant_id"] == restaurant_id) & (logs["source"] == "manual")]

    by_status = reservations["status"].value_counts()
    completed, cancelled, expired = (int(by_status.get(status, 0)) for status in RESOLVED_STATUSES)
    resolved_rows = reservations[reservations["status"].isin(RESOLVED_STATUSES)]
    resolved = len(resolved_rows)
    seconds = resolved_rows["seconds_to_expire_or_resolve"]

    categories = [value for value in reservations["restaurant_category"].unique() if value]
    manual_days = set(bogota_dates(manual["changed_at"]))
    created_days = bogota_dates(reservations["created_at"]).value_counts()

    metrics = RestaurantMetrics(
        restaurant_id=restaurant_id,
        category=categories[0] if categories else None,
        period_start=period[0],
        period_end=period[-1],
        days_in_period=len(period),
        min_resolved=min_resolved,
        data_sufficiency="enough" if resolved >= min_resolved else "insufficient",
        reservations_created=len(reservations),
        active=int(by_status.get("active", 0)),
        resolved=resolved,
        completed=completed,
        cancelled=cancelled,
        expired=expired,
        check_ins=len(check_ins),
        check_in_rate=rate(completed, resolved),
        no_show_rate=rate(expired, resolved),
        cancellation_rate=rate(cancelled, resolved),
        avg_minutes_to_resolve=minutes(seconds),
        avg_minutes_by_status={
            status: minutes(seconds[resolved_rows["status"] == status])
            for status in RESOLVED_STATUSES
            if (resolved_rows["status"] == status).any()
        },
        reservations_by_day_of_week={
            day: int((reservations["day_of_week"] == day).sum()) for day in range(1, 8)
        },
        reservations_by_date={day.isoformat(): int(created_days.get(day, 0)) for day in period},
        top_slots=top_slots(reservations),
        manual_changes=len(manual),
        manual_changes_per_day=round(len(manual) / len(period), 1),
        days_with_manual_changes=len(manual_days),
        days_without_manual_changes=len(period) - len(manual_days),
        reliability_level=None,
    )
    metrics.reliability_level, metrics.reliability_reasons = reliability(metrics)
    return metrics


def compute_all(frames: dict[str, pd.DataFrame], min_resolved: int) -> list[RestaurantMetrics]:
    period = export_period(frames)
    restaurant_ids = sorted(
        set(frames[RESERVATIONS_FILE]["restaurant_id"]) | set(frames[TABLE_LOGS_FILE]["restaurant_id"])
    )
    return [restaurant_metrics(restaurant_id, frames, period, min_resolved) for restaurant_id in restaurant_ids]
