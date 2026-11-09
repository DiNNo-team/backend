"""Texto de recomendaciones: plantillas (respaldo) o modelo de lenguaje (opcional).

Secciones 6.3 y 9 de `docs/ia-diseno.md`:
- Sin llave, con datos insuficientes o ante cualquier falla del modelo, se usan las plantillas.
- Al modelo solo se le envían métricas agregadas: ni el id ni el nombre del
  restaurante, ni datos de comensales.
- Un texto vacío, de más de 600 caracteres o con un número que no está en las
  métricas se descarta y se usan las plantillas.
"""

import json
import math
import os
import re
from dataclasses import dataclass

from export_columns import DAY_NAMES
from metrics import RestaurantMetrics

API_KEY_VARIABLE = "INSIGHTS_LLM_API_KEY"
MODEL_VARIABLE = "INSIGHTS_LLM_MODEL"
DEFAULT_MODEL = "claude-opus-5-5"
# Modelos que aceptan el respaldo del servidor ante una negativa (fallbacks: "default").
SERVER_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
MAX_TEXT_LENGTH = 600
MAX_RECOMMENDATIONS = 3
HIGH_NO_SHOW_RATE = 0.30
HIGH_CANCELLATION_RATE = 0.25

SYSTEM_PROMPT = (
    "Eres el asistente de DiNNo, una plataforma de microreservas de mesas en restaurantes de Bogotá. "
    "Recibes en JSON las métricas de un restaurante en un periodo. Escribe 2 o 3 recomendaciones "
    "para el dueño del restaurante: en español de Colombia, tuteando, en texto plano, sin viñetas, "
    "sin numeración, sin títulos y en máximo 600 caracteres en total. "
    "Usa solo los números que aparecen en el JSON y escríbelos igual: porcentajes como enteros con %, "
    "horas en formato de 24 horas (por ejemplo 13:00). No inventes datos ni causas que el JSON no muestre. "
    "Una reserva vencida sin check-in no prueba que el comensal no llegó: llámala «reserva que venció "
    "sin check-in». Usa las palabras de DiNNo: mesa, comensal, Disponible, Ocupada, check-in, código."
)


@dataclass
class Narrative:
    text: str
    source: str  # "llm" o "template"
    note: str | None = None  # por qué se usó la plantilla, si había llave


def pct(value: float) -> int:
    return round(value * 100)


def template_narrative(metrics: RestaurantMetrics) -> Narrative:
    """Reglas simples, sin modelo: el respaldo de la sección 9."""
    if metrics.data_sufficiency == "insufficient":
        return Narrative(
            "Aún no hay suficientes reservas para tu informe. Vuelve cuando tengas al menos "
            f"{metrics.min_resolved} reservas resueltas (con check-in, canceladas o vencidas).",
            "template",
        )

    recommendations = []
    if metrics.no_show_rate >= HIGH_NO_SHOW_RATE:
        recommendations.append(
            f"El {pct(metrics.no_show_rate)} % de tus reservas resueltas venció sin check-in "
            f"({metrics.expired} de {metrics.resolved}). Revisa si validas el código cuando llega el "
            "comensal: si no lo validas, la reserva cuenta como vencida."
        )
    if metrics.days_without_manual_changes >= math.ceil(metrics.days_in_period / 2):
        recommendations.append(
            f"No actualizaste tus mesas a mano en {metrics.days_without_manual_changes} de "
            f"{metrics.days_in_period} días. Márcalas como Ocupada o Disponible cuando cambien, para que "
            "los comensales vean tu disponibilidad real."
        )
    if metrics.cancellation_rate >= HIGH_CANCELLATION_RATE:
        recommendations.append(
            f"El {pct(metrics.cancellation_rate)} % de tus reservas resueltas se canceló "
            f"({metrics.cancelled} de {metrics.resolved}). Revisa en la bitácora a qué horas pasa."
        )
    if metrics.check_in_rate >= 0.70:
        recommendations.append(
            f"El {pct(metrics.check_in_rate)} % de tus reservas resueltas terminó en check-in. "
            "Sigue validando el código al recibir a cada comensal."
        )
    if metrics.top_slots:
        slot = metrics.top_slots[0]
        recommendations.append(
            f"Tu franja con más reservas es el {DAY_NAMES[slot.day_of_week]} a las {slot.hour}:00 "
            f"({slot.reservations} reservas). Procura tener mesas Disponibles a esa hora."
        )
    return Narrative(" ".join(recommendations[:MAX_RECOMMENDATIONS]), "template")


def llm_payload(metrics: RestaurantMetrics) -> dict:
    """Solo números agregados y etiquetas: sin id, nombre ni dirección del restaurante."""
    return {
        "dias_del_periodo": metrics.days_in_period,
        "reservas_creadas": metrics.reservations_created,
        "reservas_resueltas": metrics.resolved,
        "reservas_con_check_in": metrics.completed,
        "reservas_vencidas_sin_check_in": metrics.expired,
        "reservas_canceladas": metrics.cancelled,
        "tasa_check_in_pct": pct(metrics.check_in_rate),
        "tasa_vencidas_sin_check_in_pct": pct(metrics.no_show_rate),
        "tasa_canceladas_pct": pct(metrics.cancellation_rate),
        "minutos_promedio_hasta_resolverse": metrics.avg_minutes_to_resolve,
        "franjas_con_mas_reservas": [
            {"dia": DAY_NAMES[slot.day_of_week], "hora": f"{slot.hour}:00", "reservas": slot.reservations}
            for slot in metrics.top_slots
        ],
        "cambios_manuales_de_mesas": metrics.manual_changes,
        "dias_con_cambios_manuales": metrics.days_with_manual_changes,
        "dias_sin_cambios_manuales": metrics.days_without_manual_changes,
        "confiabilidad_de_la_disponibilidad": metrics.reliability_level,
        "motivos": metrics.reliability_reasons,
    }


NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
CLOCK = re.compile(r"\b(\d{1,2}):00\b")


def allowed_numbers(payload: dict) -> set[float]:
    """Todos los números del payload, incluidos los que van dentro de textos ("13:00", "65 %")."""
    serialized = json.dumps(payload, ensure_ascii=False)
    return {float(number.replace(",", ".")) for number in NUMBER.findall(CLOCK.sub(r"\1", serialized))}


def validation_problem(text: str, payload: dict) -> str | None:
    if not text.strip():
        return "el modelo respondió vacío"
    if len(text) > MAX_TEXT_LENGTH:
        return f"el texto tiene {len(text)} caracteres (máximo {MAX_TEXT_LENGTH})"
    allowed = allowed_numbers(payload)
    unknown = [n for n in NUMBER.findall(CLOCK.sub(r"\1", text)) if float(n.replace(",", ".")) not in allowed]
    if unknown:
        return f"el texto menciona números que no están en las métricas: {', '.join(unknown)}"
    return None


def llm_narrative(metrics: RestaurantMetrics, api_key: str, model: str) -> Narrative:
    """Pide el texto al modelo. Cualquier falla devuelve la plantilla con el motivo."""
    fallback = template_narrative(metrics)
    try:
        import anthropic
    except ImportError:
        fallback.note = "no está instalado el paquete anthropic (pip install -r requirements.txt)"
        return fallback

    payload = llm_payload(metrics)
    extra = {}
    if model in SERVER_FALLBACK_MODELS:
        # Si el modelo se niega, el servidor reintenta con el modelo de respaldo recomendado.
        extra = {"betas": ["server-side-fallback-2026-07-01"], "extra_body": {"fallbacks": "default"}}
    client = anthropic.Anthropic(api_key=api_key, timeout=60.0, max_retries=1)
    try:
        response = client.beta.messages.create(
            model=model,
            max_tokens=16000,
            output_config={"effort": "low"},
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            **extra,
        )
    except anthropic.APIConnectionError as error:
        fallback.note = f"no hubo conexión con el modelo ({type(error).__name__})"
        return fallback
    except anthropic.RateLimitError:
        fallback.note = "el modelo respondió 429 (límite de peticiones o cupo agotado)"
        return fallback
    except anthropic.APIStatusError as error:
        fallback.note = f"el modelo respondió {error.status_code}"
        return fallback

    if response.stop_reason != "end_turn":
        fallback.note = f"el modelo terminó con stop_reason={response.stop_reason}"
        return fallback
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    problem = validation_problem(text, payload)
    if problem:
        fallback.note = f"texto descartado: {problem}"
        return fallback
    return Narrative(text, "llm")


def write_narrative(metrics: RestaurantMetrics, use_llm: bool) -> Narrative:
    api_key = os.environ.get(API_KEY_VARIABLE, "").strip()
    if not use_llm or not api_key or metrics.data_sufficiency == "insufficient":
        return template_narrative(metrics)
    model = os.environ.get(MODEL_VARIABLE, "").strip() or DEFAULT_MODEL
    return llm_narrative(metrics, api_key, model)
