"""Métricas: los fixtures dan exactamente expected.json, y casos borde."""

import json
from datetime import timedelta

import pytest

from conftest import FIXTURE_EXPORT
from export_builder import manual_log, reservation, resolved_mix, utc, write_export
from export_columns import BOGOTA, RESERVATIONS_FILE
from metrics import ExportFormatError, compute_all, load_export


def as_json(metrics):
    """Igual que en metricas.json: claves de texto y tipos de JSON."""
    return json.loads(json.dumps(metrics.to_json()))


def test_fixtures_match_expected_json(fixture_metrics, expected):
    assert [as_json(m) for m in fixture_metrics] == expected["restaurants"]


def test_fixture_day_and_hour_columns_are_bogota_time():
    """Comprueba el fixture escrito a mano: day_of_week y hour_of_day salen de created_at en Bogotá."""
    frame = load_export(FIXTURE_EXPORT)[RESERVATIONS_FILE]
    local = frame["created_at"].dt.tz_convert(BOGOTA)
    assert list(frame["day_of_week"]) == list(local.dt.dayofweek + 1)
    assert list(frame["hour_of_day"]) == list(local.dt.hour)


def test_export_without_rows_fails_with_clear_message(tmp_path):
    folder = write_export(tmp_path / "vacia")
    with pytest.raises(ExportFormatError, match="no tiene ninguna fila"):
        compute_all(load_export(folder), 10)


def test_insufficient_data_has_no_rates_and_no_reliability(fixture_metrics):
    restaurant_b = fixture_metrics[1]
    assert restaurant_b.resolved == 3
    assert restaurant_b.data_sufficiency == "insufficient"
    assert (restaurant_b.check_in_rate, restaurant_b.no_show_rate, restaurant_b.cancellation_rate) == (None, None, None)
    assert restaurant_b.reliability_level is None
    assert restaurant_b.reliability_reasons == []


def test_just_below_threshold_is_insufficient(tmp_path):
    folder = write_export(tmp_path / "nueve", reservations=resolved_mix(completed=9, others=0))
    [metrics] = compute_all(load_export(folder), 10)
    assert metrics.data_sufficiency == "insufficient"
    assert metrics.check_in_rate is None


def test_only_cancellations(tmp_path):
    folder = write_export(tmp_path / "canceladas", reservations=resolved_mix(completed=0, others=10))
    [metrics] = compute_all(load_export(folder), 10)
    assert (metrics.resolved, metrics.completed, metrics.cancelled, metrics.expired) == (10, 0, 10, 0)
    assert (metrics.check_in_rate, metrics.no_show_rate, metrics.cancellation_rate) == (0.0, 0.0, 1.0)
    assert set(metrics.avg_minutes_by_status) == {"cancelled"}
    assert metrics.reliability_level == "baja"


def test_active_reservations_are_not_resolved(tmp_path):
    active = [reservation("active", utc("2026-11-03T20:00:00Z") + timedelta(minutes=i)) for i in range(3)]
    folder = write_export(tmp_path / "activas", reservations=resolved_mix(completed=10, others=0) + active)
    [metrics] = compute_all(load_export(folder), 10)
    assert (metrics.reservations_created, metrics.active, metrics.resolved) == (13, 3, 10)
    assert metrics.check_in_rate == 1.0
    # Las activas no tienen segundos hasta resolverse: no entran al promedio.
    assert metrics.avg_minutes_to_resolve == 5.0


def test_bogota_day_boundary_in_fixtures(fixture_metrics):
    """Reserva 04 (UTC 11-03 04:59:59) es del lunes 11-02; la 05 (UTC 11-03 05:00:00), del martes 11-03."""
    restaurant_a = fixture_metrics[0]
    assert restaurant_a.reservations_by_date == {"2026-11-02": 4, "2026-11-03": 4, "2026-11-04": 3}
    assert restaurant_a.reservations_by_day_of_week[1] == 4
    # El cambio manual de las 04:30 UTC del 11-04 es del 11-03 en Bogotá: el 11-04 queda sin cambios.
    assert (restaurant_a.days_with_manual_changes, restaurant_a.days_without_manual_changes) == (2, 1)


def test_bogota_day_boundary_one_millisecond_apart(tmp_path):
    before = reservation("completed", utc("2026-11-03T04:59:59.999Z"))
    after = reservation("completed", utc("2026-11-03T05:00:00.000Z"))
    log = manual_log(utc("2026-11-03T04:59:59.999Z"))
    folder = write_export(tmp_path / "medianoche", reservations=[before, after], logs=[log])
    [metrics] = compute_all(load_export(folder), 1)
    assert metrics.reservations_by_date == {"2026-11-02": 1, "2026-11-03": 1}
    assert (metrics.period_start.isoformat(), metrics.period_end.isoformat()) == ("2026-11-02", "2026-11-03")
    assert metrics.days_with_manual_changes == 1


def test_non_manual_logs_do_not_count(tmp_path):
    logs = [manual_log(utc("2026-11-02T19:00:00Z"), source="system"), manual_log(utc("2026-11-02T19:00:00Z"))]
    folder = write_export(tmp_path / "bitacora", reservations=resolved_mix(10, 0), logs=logs)
    [metrics] = compute_all(load_export(folder), 10)
    assert metrics.manual_changes == 1


def test_check_ins_file_is_counted_per_restaurant(fixture_metrics):
    assert [m.check_ins for m in fixture_metrics] == [7, 1]


def test_restaurant_with_logs_but_no_reservations_is_reported(tmp_path):
    other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    folder = write_export(
        tmp_path / "solo-bitacora",
        reservations=resolved_mix(10, 0),
        logs=[manual_log(utc("2026-11-02T19:00:00Z"), restaurant_id=other)],
    )
    metrics = compute_all(load_export(folder), 10)
    by_id = {m.restaurant_id: m for m in metrics}
    assert by_id[other].reservations_created == 0
    assert by_id[other].data_sufficiency == "insufficient"
    assert by_id[other].avg_minutes_to_resolve is None
