"""Informe inteligente por restaurante a partir de una exportación de `npm run export:data`.

Uso:
    python report.py --input datos-sinteticos --output informes

Escribe en --output un `informe-<restaurant_id>.txt` por restaurante y
`metricas.json` con todas las métricas. Si existe la variable de entorno
INSIGHTS_LLM_API_KEY, el texto de recomendaciones lo redacta un modelo de
lenguaje con las métricas agregadas; si no, sale de plantillas.
"""

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from export_columns import CATEGORY_LABELS, DAY_NAMES
from metrics import ExportFormatError, RestaurantMetrics, compute_all, load_export
from narrative import API_KEY_VARIABLE, Narrative, write_narrative

MONTHS = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic")
RELIABILITY_LABELS = {"alta": "Alta", "media": "Media", "baja": "Baja"}


def es_date(day: date) -> str:
    return f"{day.day} {MONTHS[day.month - 1]} {day.year}"


def es_decimal(value: float) -> str:
    return f"{value:.1f}".replace(".", ",")


def es_pct(value: float) -> str:
    return f"{round(value * 100)} %"


def count_of(part: int, total: int, value: float | None) -> str:
    return f"{part} de {total} ({es_pct(value)})" if value is not None else f"{part}"


def render(metrics: RestaurantMetrics, narrative: Narrative, generated_at: datetime) -> str:
    category = CATEGORY_LABELS.get(metrics.category, "sin categoría") if metrics.category else "sin categoría"
    lines = [
        f"Informe de DiNNo · restaurante {metrics.restaurant_id} ({category})",
        f"Periodo: {es_date(metrics.period_start)} a {es_date(metrics.period_end)} "
        f"({metrics.days_in_period} días, hora de Bogotá)",
        f"Generado: {generated_at.strftime('%Y-%m-%d %H:%M')} UTC",
        "",
        "Métricas",
        f"- Reservas creadas: {metrics.reservations_created} "
        f"(resueltas: {metrics.resolved}; activas al exportar: {metrics.active})",
    ]
    if metrics.data_sufficiency == "enough":
        by_status = metrics.avg_minutes_by_status
        detail = "; ".join(
            f"{label}: {es_decimal(by_status[status])} min"
            for status, label in (("completed", "check-in"), ("cancelled", "cancelación"), ("expired", "vencimiento"))
            if status in by_status
        )
        lines += [
            f"- Con check-in: {count_of(metrics.completed, metrics.resolved, metrics.check_in_rate)}",
            f"- Vencieron sin check-in: {count_of(metrics.expired, metrics.resolved, metrics.no_show_rate)}",
            f"- Canceladas: {count_of(metrics.cancelled, metrics.resolved, metrics.cancellation_rate)}",
            f"- Tiempo promedio hasta resolverse: {es_decimal(metrics.avg_minutes_to_resolve)} min ({detail})",
        ]
    else:
        lines.append(
            f"- Con check-in: {metrics.completed} · Vencieron sin check-in: {metrics.expired} · "
            f"Canceladas: {metrics.cancelled} (sin tasas: datos insuficientes)"
        )
    lines += [
        f"- Check-ins facturables (check_ins.csv): {metrics.check_ins}",
        f"- Cambios manuales de mesas: {metrics.manual_changes} "
        f"({es_decimal(metrics.manual_changes_per_day)} por día; "
        f"{metrics.days_without_manual_changes} de {metrics.days_in_period} días sin cambios)",
        "",
        "Reservas por día de la semana",
        "  " + " · ".join(f"{DAY_NAMES[day]} {count}" for day, count in metrics.reservations_by_day_of_week.items()),
        "",
        "Franjas con más reservas",
    ]
    lines += [
        f"  {position}. {DAY_NAMES[slot.day_of_week]} {slot.hour}:00 ({slot.reservations})"
        for position, slot in enumerate(metrics.top_slots, start=1)
    ] or ["  Sin reservas en el periodo."]
    lines += ["", "Reservas por fecha"]
    lines += [f"  {day}: {count}" for day, count in metrics.reservations_by_date.items()]
    lines.append("")
    if metrics.reliability_level:
        lines.append(f"Confiabilidad de la disponibilidad: {RELIABILITY_LABELS[metrics.reliability_level]}")
        lines += [f"  - {reason}" for reason in metrics.reliability_reasons]
    else:
        lines.append("Confiabilidad de la disponibilidad: sin datos suficientes")
    lines += ["", "Recomendaciones"]
    origin = "generado automáticamente por un modelo de lenguaje" if narrative.source == "llm" else "plantilla"
    lines.append(f"  ({origin})")
    lines.append(f"  {narrative.text}")
    if narrative.note:
        lines.append(f"  Nota: se usó la plantilla porque {narrative.note}.")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Informe por restaurante a partir de los CSV de export:data.")
    parser.add_argument("--input", required=True, type=Path, help="Carpeta con los tres CSV exportados.")
    parser.add_argument("--output", required=True, type=Path, help="Carpeta donde se escriben los informes.")
    parser.add_argument(
        "--min-resolved",
        type=int,
        default=10,
        help="Reservas resueltas mínimas para calcular tasas e indicador (por defecto 10, por confirmar).",
    )
    parser.add_argument("--no-llm", action="store_true", help="Usa siempre las plantillas, aunque haya llave.")
    args = parser.parse_args()

    try:
        frames = load_export(args.input)
        all_metrics = compute_all(frames, args.min_resolved)
    except (ExportFormatError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    generated_at = datetime.now(timezone.utc)
    args.output.mkdir(parents=True, exist_ok=True)
    summary = []
    for metrics in all_metrics:
        narrative = write_narrative(metrics, use_llm=not args.no_llm)
        path = args.output / f"informe-{metrics.restaurant_id}.txt"
        path.write_text(render(metrics, narrative, generated_at), encoding="utf-8")
        summary.append({**metrics.to_json(), "narrative": {"text": narrative.text, "source": narrative.source}})
        note = f" ({narrative.note})" if narrative.note else ""
        print(f"{path}: confiabilidad {metrics.reliability_level or 'sin datos'}, texto {narrative.source}{note}")

    (args.output / "metricas.json").write_text(
        json.dumps({"generatedAt": generated_at.isoformat(), "restaurants": summary}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if not args.no_llm and not os.environ.get(API_KEY_VARIABLE, "").strip():
        print(f"Sin {API_KEY_VARIABLE}: todos los textos salieron de plantillas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
