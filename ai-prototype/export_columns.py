"""Columnas exactas de los CSV de `npm run export:data`.

Copia de `src/scripts/export-data/columns.ts` (diccionario en `docs/export-datos.md`).
Si la exportación cambia sus columnas, se actualiza este archivo.
"""

from datetime import timedelta, timezone

RESERVATIONS_FILE = "reservations.csv"
CHECK_INS_FILE = "check_ins.csv"
TABLE_LOGS_FILE = "table_logs.csv"

RESERVATION_COLUMNS = [
    "reservation_id",
    "diner_pseudonym",
    "restaurant_id",
    "restaurant_category",
    "table_capacity",
    "party_size",
    "status",
    "created_at",
    "expires_at",
    "expired_at",
    "cancelled_at",
    "checked_in_at",
    "no_show",
    "day_of_week",
    "hour_of_day",
    "seconds_to_expire_or_resolve",
]

CHECK_IN_COLUMNS = [
    "check_in_id",
    "reservation_id",
    "restaurant_id",
    "checked_in_at",
    "day_of_week",
    "hour_of_day",
]

TABLE_LOG_COLUMNS = [
    "log_id",
    "restaurant_id",
    "table_id",
    "previous_status",
    "new_status",
    "source",
    "changed_at",
    "actor_type",
]

EXPECTED_COLUMNS = {
    RESERVATIONS_FILE: RESERVATION_COLUMNS,
    CHECK_INS_FILE: CHECK_IN_COLUMNS,
    TABLE_LOGS_FILE: TABLE_LOG_COLUMNS,
}

# Colombia no tiene horario de verano: Bogotá es siempre UTC-5.
BOGOTA = timezone(timedelta(hours=-5))

# Textos de la interfaz (RESTAURANT_CATEGORY_LABELS de la web).
CATEGORY_LABELS = {
    "colombian": "Colombiana",
    "italian": "Italiana",
    "mexican": "Mexicana",
    "asian": "Asiática",
    "grill": "Parrilla",
    "fast_food": "Comida rápida",
    "healthy": "Saludable",
    "seafood": "Mariscos",
    "cafe": "Cafetería",
    "other": "Otra",
}

# 1 = lunes ... 7 = domingo, igual que day_of_week.
DAY_NAMES = {
    1: "lunes",
    2: "martes",
    3: "miércoles",
    4: "jueves",
    5: "viernes",
    6: "sábado",
    7: "domingo",
}
