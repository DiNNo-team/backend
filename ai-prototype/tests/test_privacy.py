"""Privacidad: ni lo que se envía al modelo ni los informes llevan ids, seudónimos, correos ni códigos."""

import json
import re
import sys

import pandas as pd
import pytest

import report
from conftest import FIXTURE_EXPORT, message_response
from narrative import llm_payload

# Alfabeto del código de reserva (CLAUDE.md §12.1): 6 caracteres sin 0, O, 1, I ni L.
RESERVATION_CODE = re.compile(r"\b[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}\b")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def forbidden_values():
    """Todo identificador de la exportación de los fixtures."""
    reservations = pd.read_csv(FIXTURE_EXPORT / "reservations.csv", dtype=str)
    logs = pd.read_csv(FIXTURE_EXPORT / "table_logs.csv", dtype=str)
    return (
        set(reservations["restaurant_id"])
        | set(reservations["diner_pseudonym"])
        | set(reservations["reservation_id"])
        | set(logs["table_id"])
    )


def assert_private(text):
    leaked = [value for value in forbidden_values() if value in text]
    assert leaked == []
    assert EMAIL.search(text) is None
    assert RESERVATION_CODE.search(text) is None


def test_llm_payload_has_only_aggregates(fixture_metrics):
    payload = llm_payload(fixture_metrics[0])
    assert_private(json.dumps(payload, ensure_ascii=False))


def test_request_body_to_the_model_is_private(monkeypatch, fake_api, fixture_metrics):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", "clave-falsa-de-prueba")
    fake_api.reply = lambda request: message_response("Sigue validando el código de cada comensal.")
    from narrative import write_narrative

    write_narrative(fixture_metrics[0], use_llm=True)
    assert_private(fake_api.requests[0].content.decode("utf-8"))


@pytest.mark.parametrize("with_llm", [False, True])
def test_reports_are_private(monkeypatch, fake_api, tmp_path, with_llm):
    if with_llm:
        monkeypatch.setenv("INSIGHTS_LLM_API_KEY", "clave-falsa-de-prueba")
        fake_api.reply = lambda request: message_response("Sigue validando el código de cada comensal.")
    output = tmp_path / "informes"
    monkeypatch.setattr(sys, "argv", ["report.py", "--input", str(FIXTURE_EXPORT), "--output", str(output)])
    assert report.main() == 0
    reports = sorted(output.glob("informe-*.txt"))
    assert [path.name for path in reports] == ["informe-01.txt", "informe-02.txt"]
    for path in reports:
        assert_private(path.name + path.read_text(encoding="utf-8"))
