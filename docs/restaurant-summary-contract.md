# Resumen del restaurante · contrato para la web (Sprint 4)

> Para: quien construye la pantalla `/resumen` del restaurante en la web. Fuente de verdad del backend (`feat/sprint4-admin-panel`). El resumen del **administrador de DiNNo** es otro (`docs/admin-panel-contract.md`).

## 0. Reglas comunes

- Solo `restaurant_admin` **aprobado**; un **suspendido** también la ve (solo lectura, §12.15). Pendiente o rechazado: su `403`. Mismo límite general de peticiones que el resto de `/restaurants/me`.
- **Periodo:** `from` y `to`, días de Bogotá `AAAA-MM-DD`, inclusivos; por defecto del día 1 del mes en curso hasta hoy; `to` no puede ser futuro y el máximo es 366 días (`400` con la lista de mensajes).
- **Hora:** todo en America/Bogota. Un check-in a las 23:59 de Bogotá es de ese día aunque en UTC ya sea el siguiente.
- **Dinero:** COP, enteros: la suma de la tarifa guardada en cada check-in (`fee_cop`).
- **Privacidad:** ninguna respuesta trae nombres, correos, `diner_id` ni códigos de reserva.
- No se agregó ninguna ruta: se amplía `GET /v1/restaurants/me/summary` (solo campos nuevos) y el detalle de un día reutiliza `GET /v1/restaurants/me/billing/check-ins`.

## 1. `GET /v1/restaurants/me/summary?from&to`

Los campos que ya existían **no cambian** (`period`, `billing.checkIns/amountCop/currentFeeCop`, `reservations`, `rates`, `averagePartySize`, `peakHours`, `byDayOfWeek`, `serverTime`). Se agregan:

| Campo | Qué es |
|---|---|
| `billing.guests` | Comensales: la suma de las personas (`party_size`) de las reservas con check-in en el periodo. |
| `previousComparable` | `{ period, reservationsCreated, checkIns, guests, amountCop }` del **mismo tramo** del periodo anterior (regla abajo). |
| `byDate[]` | Una entrada por **cada día** del periodo, en orden y con ceros: `{ date, reservationsCreated, checkIns, guests, cancelled, expired }`. |
| `byDayHour[]` | Siempre 168 entradas: `{ dayOfWeek (1 = lunes … 7), hour (0–23), reservations }`, reservas creadas. Índice = (`dayOfWeek` − 1) × 24 + `hour`. |
| `monthly[]` | Los 6 meses que terminan en el mes de `to`, del más antiguo al más reciente, también en 0: `{ month: "AAAA-MM", guests, checkIns, inProgress }`. `inProgress` es `true` solo para el mes en curso. |
| `payment` | `{ period, previousMonth }`, cada uno `{ month, status, checkIns, amountCop } \| null` (abajo). |

**Qué día cuenta cada cosa en `byDate`.** `reservationsCreated`, `cancelled` y `expired`, por el día en que se **creó** la reserva (con su estado actual). `checkIns` y `guests`, por el día en que se **hizo el check-in**. Por eso un día puede tener check-ins de reservas creadas el día anterior. Mientras corre el día, `sum(byDate.reservationsCreated)` puede diferir en 1 de `reservations.created` por un vencimiento justo en medio.

**Mismo tramo (`previousComparable.period`).**
- Si el periodo empieza el día 1 de un mes y no sale de él: del día 1 al **mismo día** del mes anterior, recortado a su último día; si el periodo llega al último día de su mes, el anterior también. `1–17 nov → 1–17 oct`, `1–30 nov → 1–31 oct`, `1–31 mar → 1–28 feb` (`1–29 feb` en año bisiesto).
- En cualquier otro caso: los mismos N días justo antes (`3–10 nov → 26 oct–2 nov`).
- Si el valor anterior es 0, la web no muestra porcentaje.

**`payment`.**
- `period`: el mes de `to`, **solo si el periodo cabe en un único mes** y es de 2026-01 en adelante; si no, `null`.
- `previousMonth`: el mes anterior al mes de `to` (`null` antes de 2026-01).
- `status`: `in_progress` (el mes no ha terminado), `pending` (mes cerrado que el administrador no marcó como pagado) o `paid` (marcado como pagado). Es la misma regla del panel del administrador.
- `checkIns` y `amountCop` son del **mes completo** (hasta hoy si está en curso). Si está `paid`, son los valores guardados al marcarlo. Un mes cerrado sin check-ins llega `pending` con `amountCop: 0`: no hay nada que pagar.
- La web usa «Pagado» donde el administrador dice «Cobrado»: es el mismo estado, visto por quien paga.

## 2. Detalle de un día

`GET /v1/restaurants/me/billing/check-ins?from=AAAA-MM-DD&to=AAAA-MM-DD&pageSize=200` con el **mismo día** en `from` y `to`: los check-ins de ese día de Bogotá (hora, mesa, personas y tarifa), el más reciente primero. `period` se resuelve a `[00:00, 24:00)` de Bogotá (lo fija `test/db/restaurant-summary.db-spec.ts` con check-ins a las 23:59 y a las 00:00).

## 3. Consultas

Trece consultas en paralelo por llamada, todas agregadas y filtradas por el restaurante de la sesión; usan `IDX_reservations_restaurant_id_created_at` e `IDX_check_ins_restaurant_id_checked_in_at`. Sin migración: todo sale de `reservations`, `check_ins` y `billing_periods`.

## 4. Código

`reports/restaurant-reports.service.ts` (arma la respuesta), `reports/restaurant-summary.reader.ts` (SQL de totales, días y meses), `reports/restaurant-metrics.service.ts` (`dayHourForRestaurant`, el mismo SQL del administrador con el filtro del restaurante), `reports/comparable-period.ts` (el tramo, pura) y `billing/billing-status.ts` (el estado de cobro, compartido con el administrador).
