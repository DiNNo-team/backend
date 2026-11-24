"""Indicador de confiabilidad (sección 5 del diseño), justo en los umbrales de 70 % y 40 %.

Los periodos de estas pruebas tienen 2 días (2 y 3 de nov en Bogotá): «la mayoría de los días»
con cambios manuales es 2 de 2; con 1 de 2 no alcanza.
"""

import pytest

from export_builder import manual_log, resolved_mix, utc, write_export
from metrics import compute_all, load_export

BOTH_DAYS = [utc("2026-11-02T20:00:00Z"), utc("2026-11-03T20:00:00Z")]
ONE_DAY = [utc("2026-11-02T20:00:00Z")]


@pytest.mark.parametrize(
    ("case", "completed", "others", "manual_days", "level"),
    [
        ("alta justo en 70 %", 7, 3, BOTH_DAYS, "alta"),
        ("media justo debajo de 70 %", 69, 31, BOTH_DAYS, "media"),
        ("media con 70 % pero cambios en la mitad de los días", 7, 3, ONE_DAY, "media"),
        ("media justo en 40 %", 4, 6, BOTH_DAYS, "media"),
        ("baja justo debajo de 40 %", 39, 61, BOTH_DAYS, "baja"),
        ("baja sin cambios manuales", 8, 2, [], "baja"),
    ],
)
def test_reliability_levels(tmp_path, case, completed, others, manual_days, level):
    logs = [manual_log(day) for day in manual_days]
    folder = write_export(tmp_path / "caso", reservations=resolved_mix(completed, others), logs=logs)
    [metrics] = compute_all(load_export(folder), 10)
    assert metrics.days_in_period == 2
    assert metrics.reliability_level == level, case
    assert metrics.reliability_reasons[0] == f"Tasa de check-in del {round(completed / (completed + others) * 100)} %"


def test_reliability_without_enough_data(tmp_path):
    folder = write_export(tmp_path / "caso", reservations=resolved_mix(9, 0), logs=[manual_log(d) for d in BOTH_DAYS])
    [metrics] = compute_all(load_export(folder), 10)
    assert metrics.reliability_level is None
    assert metrics.reliability_reasons == []
