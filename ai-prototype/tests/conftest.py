"""Configuración común de las pruebas.

Ninguna prueba llama a la API real: las que prueban el modelo reemplazan el
transporte HTTP del SDK por uno simulado (`fake_api`), y todas corren sin
llaves en el entorno.
"""

import json
import sys
from pathlib import Path

import pytest

PROTOTYPE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROTOTYPE_DIR))

from metrics import compute_all, load_export  # noqa: E402

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
FIXTURE_EXPORT = FIXTURES_DIR / "export"


@pytest.fixture(autouse=True)
def no_llm_environment(monkeypatch):
    """Ninguna prueba hereda llaves ni modelo del entorno de quien las corre."""
    for variable in ("INSIGHTS_LLM_API_KEY", "INSIGHTS_LLM_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"):
        monkeypatch.delenv(variable, raising=False)


@pytest.fixture
def expected():
    return json.loads((FIXTURES_DIR / "expected.json").read_text(encoding="utf-8"))


@pytest.fixture
def fixture_metrics(expected):
    """Métricas de los fixtures: [restaurante A (datos suficientes), restaurante B (insuficientes)]."""
    return compute_all(load_export(FIXTURE_EXPORT), expected["min_resolved"])


class FakeApi:
    """Hace de API de Claude: guarda cada petición y responde lo que diga `reply`."""

    def __init__(self):
        self.requests = []
        self.reply = lambda request: message_response("Texto de prueba.")

    def handle(self, request):
        self.requests.append(request)
        return self.reply(request)

    def body(self, index=0):
        return json.loads(self.requests[index].content)


def message_response(text, stop_reason="end_turn"):
    import httpx2

    return httpx2.Response(
        200,
        json={
            "id": "msg_prueba",
            "type": "message",
            "role": "assistant",
            "model": "claude-haiku-5-5",
            "content": [{"type": "text", "text": text}],
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 10},
        },
    )


def error_response(status, error_type):
    import httpx2

    return httpx2.Response(
        status,
        json={"type": "error", "error": {"type": error_type, "message": "error simulado"}},
        headers={"x-should-retry": "false"},
    )


@pytest.fixture
def fake_api(monkeypatch):
    """Reemplaza `anthropic.Anthropic` por el cliente real con un transporte simulado (sin red)."""
    import anthropic
    import httpx2

    api = FakeApi()
    real_client = anthropic.Anthropic

    def client_with_fake_transport(**kwargs):
        kwargs["max_retries"] = 0
        transport = httpx2.MockTransport(api.handle)
        return real_client(**kwargs, http_client=anthropic.DefaultHttpxClient(transport=transport))

    monkeypatch.setattr(anthropic, "Anthropic", client_with_fake_transport)
    return api
