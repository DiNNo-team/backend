# Fixtures de las pruebas

Exportación **pequeña, sintética y escrita a mano** con las columnas exactas de `npm run export:data` (`docs/export-datos.md`). No viene de ninguna base: los UUID, seudónimos y fechas son inventados. Por eso estos `.csv` sí se versionan (excepción en `ai-prototype/.gitignore`).

`expected.json` tiene el valor esperado de cada métrica con `--min-resolved 10`. Las pruebas comparan `compute_all()` contra ese archivo, y las pruebas de TypeScript del Sprint 4 deben reutilizar los dos (ver el README del prototipo).

## Datos

- **Restaurante A** (`1111…`, `colombian`): 11 reservas (10 resueltas y 1 activa), 7 check-ins y 4 cambios manuales de mesas.
- **Restaurante B** (`2222…`, `cafe`): 3 reservas resueltas (datos insuficientes), 1 check-in y 2 cambios manuales.
- Hora de Bogotá = UTC − 5 (Colombia no tiene horario de verano). 2026-11-02 es lunes (`day_of_week` 1).

### Restaurante A

| # | Estado | `created_at` (UTC) | Bogotá | Día y hora | Segundos hasta resolverse |
|---|---|---|---|---|---|
| 01 | completed | 11-02 17:00:00 | lun 11-02 12:00 | 1 · 12 | 600 (check-in 17:10) |
| 02 | completed | 11-02 17:30:00 | lun 11-02 12:30 | 1 · 12 | 300 (17:35) |
| 03 | expired | 11-02 18:00:00 | lun 11-02 13:00 | 1 · 13 | 910 (vencida 18:15:10) |
| 04 | completed | 11-03 04:59:59 | **lun 11-02 23:59:59** | 1 · 23 | 600 (05:09:59) |
| 05 | completed | 11-03 05:00:00 | **mar 11-03 00:00:00** | 2 · 0 | 420 (05:07) |
| 06 | cancelled | 11-03 17:00:00 | mar 11-03 12:00 | 2 · 12 | 180 (17:03) |
| 07 | completed | 11-03 17:20:00 | mar 11-03 12:20 | 2 · 12 | 480 (17:28) |
| 08 | expired | 11-03 18:00:00 | mar 11-03 13:00 | 2 · 13 | 905 (18:15:05) |
| 09 | completed | 11-04 17:00:00 | mié 11-04 12:00 | 3 · 12 | 360 (17:06) |
| 10 | completed | 11-04 17:40:00 | mié 11-04 12:40 | 3 · 12 | 540 (17:49) |
| 11 | active | 11-04 23:50:00 | mié 11-04 18:50 | 3 · 18 | vacío (sigue activa) |

Las reservas 04 y 05 están a un segundo de distancia, a cada lado de la medianoche de Bogotá: el mismo día UTC (11-03) cae en dos días distintos de Bogotá.

Cambios de mesas (`table_logs.csv`):

| `changed_at` (UTC) | Bogotá | `source` | ¿Cuenta como manual? |
|---|---|---|---|
| 11-02 17:00 | 11-02 | reservation | No |
| 11-02 18:15:10 | 11-02 | system | No |
| 11-02 19:00 | 11-02 | manual | Sí |
| 11-02 20:30 | 11-02 | manual | Sí |
| 11-03 22:00 | 11-03 | manual | Sí |
| 11-04 04:30 | **11-03 23:30** | manual | Sí (cuenta para el 11-03, no para el 11-04) |

### Restaurante B

| # | Estado | `created_at` (UTC) | Bogotá | Día y hora | Segundos |
|---|---|---|---|---|---|
| 12 | completed | 11-03 14:00 | mar 09:00 | 2 · 9 | 240 |
| 13 | expired | 11-04 15:00 | mié 10:00 | 3 · 10 | 906 |
| 14 | cancelled | 11-04 16:00 | mié 11:00 | 3 · 11 | 120 |

Cambios manuales: 11-04 13:00 y 14:00 UTC (los dos el 11-04 en Bogotá).

## Cómo se calculó cada valor de `expected.json`

**Periodo (los dos restaurantes):** el primer dato es la reserva 01 (Bogotá 11-02) y el último la reserva 11 (Bogotá 11-04) → del 2026-11-02 al 2026-11-04, **3 días**.

| Métrica | Restaurante A | Restaurante B |
|---|---|---|
| `reservations_created` | 11 (todas, incluida la activa) | 3 |
| `active` | 1 (la 11) | 0 |
| `resolved` | 10 = 7 completed + 1 cancelled + 2 expired | 3 |
| `data_sufficiency` | 10 ≥ 10 → `enough` | 3 < 10 → `insufficient` |
| `check_ins` | 7 filas de `check_ins.csv` | 1 |
| `check_in_rate` | 7 / 10 = **0.7** (justo en el umbral de Alta) | `null` (insuficiente) |
| `no_show_rate` | 2 / 10 = 0.2 | `null` |
| `cancellation_rate` | 1 / 10 = 0.1 | `null` |
| `avg_minutes_to_resolve` | (600+300+910+600+420+180+480+905+360+540) / 10 = 529,5 s = 8,825 min → **8.8** | (240+906+120) / 3 = 422 s = 7,03 min → **7.0** |
| `avg_minutes_by_status.completed` | (600+300+600+420+480+360+540) / 7 = 471,43 s = 7,857 min → **7.9** | 240 s → 4.0 |
| `avg_minutes_by_status.cancelled` | 180 s → 3.0 | 120 s → 2.0 |
| `avg_minutes_by_status.expired` | (910+905) / 2 = 907,5 s = 15,125 min → **15.1** | 906 s → 15.1 |
| `reservations_by_day_of_week` | lun 4 (01–04) · mar 4 (05–08) · mié 3 (09–11) | mar 1 · mié 2 |
| `reservations_by_date` | 11-02: 4 · 11-03: 4 · 11-04: 3 | 11-02: 0 · 11-03: 1 · 11-04: 2 |
| `top_slots` | (lun 12h, 2), (mar 12h, 2), (mié 12h, 2): empate en 2, desempate por día y hora | (mar 9h, 1), (mié 10h, 1), (mié 11h, 1) |
| `manual_changes` | 4 (las filas `reservation` y `system` no cuentan) | 2 |
| `manual_changes_per_day` | 4 / 3 = 1,33 → **1.3** | 2 / 3 = 0,67 → **0.7** |
| `days_with_manual_changes` | 2 (11-02 y 11-03; el cambio de las 04:30 UTC del 11-04 es del 11-03 en Bogotá) | 1 (11-04) |
| `days_without_manual_changes` | 3 − 2 = 1 | 3 − 1 = 2 |
| `reliability_level` | check-in 0,70 ≥ 0,70 **y** 2 > 3/2 días con cambios → **`alta`** | `null` (sin datos suficientes) |
| `reliability_reasons` | «Tasa de check-in del 70 %», «Cambios manuales de mesas en 2 de 3 días» | `[]` |

Los minutos se redondean a 1 decimal, como en `metrics.py`.
