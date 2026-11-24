"""Texto de recomendaciones y elección del modelo, con la API simulada (nunca la real)."""

import httpx2
import pytest

from conftest import error_response, message_response
from narrative import DEFAULT_MODEL, template_narrative, write_narrative

FAKE_KEY = "clave-falsa-de-prueba"
VALID_TEXT = (
    "El 70 % de tus reservas terminó en check-in. Tu franja con más reservas es el lunes a las 12:00: "
    "ten mesas Disponibles."
)


@pytest.fixture
def restaurant_a(fixture_metrics):
    return fixture_metrics[0]


def test_without_key_uses_template_and_never_creates_a_client(monkeypatch, restaurant_a):
    import anthropic

    def fail(**kwargs):
        raise AssertionError("no debe crear un cliente sin llave")

    monkeypatch.setattr(anthropic, "Anthropic", fail)
    narrative = write_narrative(restaurant_a, use_llm=True)
    assert narrative.source == "template"
    assert narrative.note is None
    assert narrative.text == template_narrative(restaurant_a).text


def test_no_llm_flag_uses_template(monkeypatch, fake_api, restaurant_a):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", FAKE_KEY)
    assert write_narrative(restaurant_a, use_llm=False).source == "template"
    assert fake_api.requests == []


def test_insufficient_data_never_calls_the_model(monkeypatch, fake_api, fixture_metrics):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", FAKE_KEY)
    narrative = write_narrative(fixture_metrics[1], use_llm=True)
    assert narrative.source == "template"
    assert "Aún no hay suficientes reservas" in narrative.text
    assert fake_api.requests == []


def test_valid_text_is_accepted(monkeypatch, fake_api, restaurant_a):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", FAKE_KEY)
    fake_api.reply = lambda request: message_response(VALID_TEXT)
    narrative = write_narrative(restaurant_a, use_llm=True)
    assert (narrative.source, narrative.text, narrative.note) == ("llm", VALID_TEXT, None)


@pytest.mark.parametrize(
    ("text", "note_part"),
    [
        ("El 95 % de tus reservas terminó en check-in.", "números que no están en las métricas: 95"),
        ("", "respondió vacío"),
        ("a" * 601, "601 caracteres"),
    ],
)
def test_invalid_text_falls_back_to_template(monkeypatch, fake_api, restaurant_a, text, note_part):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", FAKE_KEY)
    fake_api.reply = lambda request: message_response(text)
    narrative = write_narrative(restaurant_a, use_llm=True)
    assert narrative.source == "template"
    assert narrative.text == template_narrative(restaurant_a).text
    assert note_part in narrative.note


@pytest.mark.parametrize(
    ("reply", "note_part"),
    [
        (lambda request: error_response(429, "rate_limit_error"), "429"),
        (lambda request: error_response(500, "api_error"), "respondió 500"),
        (lambda request: error_response(529, "overloaded_error"), "respondió 529"),
        (lambda request: (_ for _ in ()).throw(httpx2.ConnectError("sin red", request=request)), "no hubo conexión"),
    ],
)
def test_api_errors_fall_back_to_template(monkeypatch, fake_api, restaurant_a, reply, note_part):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", FAKE_KEY)
    fake_api.reply = reply
    narrative = write_narrative(restaurant_a, use_llm=True)
    assert narrative.source == "template"
    assert note_part in narrative.note


@pytest.mark.parametrize("stop_reason", ["max_tokens", "refusal"])
def test_stop_reason_other_than_end_turn_falls_back(monkeypatch, fake_api, restaurant_a, stop_reason):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", FAKE_KEY)
    fake_api.reply = lambda request: message_response(VALID_TEXT, stop_reason=stop_reason)
    narrative = write_narrative(restaurant_a, use_llm=True)
    assert narrative.source == "template"
    assert f"stop_reason={stop_reason}" in narrative.note


def test_default_model_is_haiku_without_server_fallback(monkeypatch, fake_api, restaurant_a):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", FAKE_KEY)
    fake_api.reply = lambda request: message_response(VALID_TEXT)
    write_narrative(restaurant_a, use_llm=True)
    [request] = fake_api.requests
    body = fake_api.body()
    assert DEFAULT_MODEL == "claude-haiku-5-5"
    assert body["model"] == "claude-haiku-5-5"
    assert "fallbacks" not in body
    assert "server-side-fallback" not in request.headers.get("anthropic-beta", "")
    assert body["max_tokens"] == 16000
    assert body["output_config"] == {"effort": "low"}
    assert not {"temperature", "top_p", "top_k", "thinking"} & set(body)


def test_sonnet_sends_server_fallback(monkeypatch, fake_api, restaurant_a):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", FAKE_KEY)
    monkeypatch.setenv("INSIGHTS_LLM_MODEL", "claude-sonnet-5-5")
    fake_api.reply = lambda request: message_response(VALID_TEXT)
    write_narrative(restaurant_a, use_llm=True)
    [request] = fake_api.requests
    body = fake_api.body()
    assert body["model"] == "claude-sonnet-5-5"
    assert body["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in request.headers["anthropic-beta"]


def test_api_key_goes_only_in_the_auth_header(monkeypatch, fake_api, restaurant_a):
    monkeypatch.setenv("INSIGHTS_LLM_API_KEY", FAKE_KEY)
    write_narrative(restaurant_a, use_llm=True)
    [request] = fake_api.requests
    assert FAKE_KEY not in request.content.decode("utf-8")
    assert FAKE_KEY not in str(request.url)
