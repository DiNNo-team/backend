# Panel del administrador · contrato para la web (Sprint 4)

> Para: quien construye las pantallas del panel `/admin` y la pantalla de «restaurante suspendido» en la web. Fuente de verdad del backend (`feat/sprint4-admin-panel`). Las reglas generales están en `CLAUDE.md` §8, §10, §11 («Suspensión», «Cobro mensual y reportes de plataforma») y §12.15. Swagger (`/docs`, tag `admin`) tiene los mismos ejemplos.

## 0. Reglas comunes

- Todo va bajo `/v1`, con `Authorization: Bearer <token de Firebase>` de una cuenta `platform_admin`.
- **Errores:** forma de siempre, `{ statusCode, message, error, errorCode? }`. La web decide **por `errorCode`**, nunca por el texto. Un `400` de validación trae `message` como **lista**.
- **Fechas:** ISO 8601 UTC. **Meses** (`month`): `AAAA-MM` en hora de Bogotá, desde `2026-01` hasta el mes en curso; sin `month`, el mes en curso. **Días** (`from`, `to`): `AAAA-MM-DD` de Bogotá, rango inclusivo.
- **Dinero:** pesos colombianos (COP), enteros. Siempre la suma de la tarifa que se guardó en cada check-in (`fee_cop`): cambiar `CHECKIN_FEE_COP` no cambia los meses anteriores.
- **Paginación:** `page` ≥ 1 (por defecto 1); `pageSize` de 1 a 100 (por defecto 20) en listas por restaurante, y de 1 a 200 (por defecto 50) en los check-ins de un restaurante.
- **Límite de peticiones:** las cinco lecturas pesadas (`overview`, `billing`, `billing/:restaurantId`, `activity`, `platform/metrics`) comparten **30 por minuto** por cuenta. Al pasarlo, `429` sin `errorCode`; no reintentar solo (§12.14).
- **Confidencialidad:** ninguna respuesta de este documento trae correos, nombres de comensales, `diner_id`, códigos de reserva ni la bitácora de mesas. El único correo de personas sigue en la lista y el detalle de solicitudes (`ownerEmail`, `reviewedByEmail`, `suspendedByEmail`, solo para el administrador).

### Errores de cuenta (iguales en todas las rutas de este documento)

| Situación | HTTP | `errorCode` | Qué hace la web |
|---|---|---|---|
| Sin sesión, token inválido o vencido | 401 | — | Llevar al login |
| Correo sin verificar | 401 | `EMAIL_NOT_VERIFIED` | Pantalla de verificación |
| Cuenta de restaurante (aprobado, pendiente, rechazado **o suspendido**) | 403 | `RESTAURANT_ACCOUNT` | No debería llegar aquí: el `AccessGuard` la lleva a su sección |
| Cuenta de comensal | 403 | `DINER_ACCOUNT` | Pantalla de cuenta equivocada |
| Cuenta sin perfil | 403 | `ACCOUNT_NOT_ENABLED` | Pantalla de cuenta no habilitada |

### Errores nuevos y texto sugerido

| `errorCode` | HTTP | Dónde | Texto sugerido para la web |
|---|---|---|---|
| `RESTAURANT_SUSPENDED` | 403 | Cualquier ruta de restaurante fuera de su lista (ver §6) y `connect_error` del socket | Pantalla propia (ver §6). El `message` del backend: «Tu restaurante está suspendido y no aparece para los comensales. Revisa el motivo en tu cuenta o escríbenos a dinnoteam2026@gmail.com para reactivarlo.» |
| `RESTAURANT_NOT_APPROVED` | 409 | `suspend` | «Este restaurante ya no está aprobado (puede que otro administrador lo haya suspendido).» y volver a cargar el detalle |
| `RESTAURANT_NOT_SUSPENDED` | 409 | `reactivate` | «Este restaurante ya no está suspendido.» y volver a cargar el detalle |
| `PERIOD_NOT_CLOSED` | 409 | `mark-paid` | «Este mes todavía no termina. Podrás marcarlo como cobrado desde el día 1 del mes siguiente.» (no debería pasar si el botón se oculta en `in_progress`) |
| `NOTHING_TO_BILL` | 409 | `mark-paid` | «Este restaurante no tiene check-ins en ese mes: no hay nada que cobrar.» (no debería pasar si el botón se oculta con `amountCop` 0) |
| `PERIOD_ALREADY_PAID` | 409 | `mark-paid` | «Este mes ya estaba marcado como cobrado.» y volver a cargar el detalle |
| `PERIOD_NOT_PAID` | 409 | `mark-pending` | «Este mes ya no estaba marcado como cobrado.» y volver a cargar el detalle |
| `RESTAURANT_NOT_FOUND` | 404 | Cualquier ruta con id de restaurante (también si el id no es UUID) | «No encontramos ese restaurante.» y volver a la lista |

Los `message` del backend de los 409 son textos en español listos para mostrar; la tabla da una versión alternativa si la web quiere su propio texto.

---

## 1. Suspender y reactivar

### `POST /v1/admin/restaurants/:id/suspend`

Solo desde `approved`. Body:

```json
{ "reason": "Varios comensales reportaron que las mesas reservadas no estaban disponibles." }
```

- `reason`: obligatorio, de 10 a 300 caracteres **después de recortar** los espacios de los extremos. Es lo que verá el restaurante mientras esté suspendido. Cualquier otro campo da `400`.
- `400` (lista): «Escribe el motivo de la suspensión, de 10 a 300 caracteres, para que el restaurante sepa por qué.»
- `200` con el **detalle actualizado** (la misma forma de `GET /v1/admin/restaurants/:id`, abajo).
- `404 RESTAURANT_NOT_FOUND`; `409 RESTAURANT_NOT_APPROVED` si no está aprobado (pendiente, rechazado o ya suspendido; también si otro administrador se adelantó: con dos a la vez, uno gana y el otro recibe el 409).
- Efectos inmediatos: deja de aparecer para los comensales y su cuenta queda limitada (§6). Las reservas activas en ese momento siguen hasta el check-in o el vencimiento (máximo 15 minutos).

**Diálogo sugerido:** «¿Suspender {name}? Dejará de aparecer para los comensales y no podrá operar. Las reservas en curso se respetan.» + campo «Motivo (lo verá el restaurante)» con el contador 10–300.

### `POST /v1/admin/restaurants/:id/reactivate`

Solo desde `suspended`, sin body. `200` con el detalle actualizado; `404`; `409 RESTAURANT_NOT_SUSPENDED`. Vuelve a `approved`: opera de nuevo y, si cumple lo demás (ubicación, horario, mesas), aparece para los comensales. **Se conservan los datos de la última suspensión** (el detalle los sigue mostrando).

### Cambios en la lista y el detalle de solicitudes

- `GET /v1/admin/restaurants?status=suspended`: acepta el estado nuevo. Orden: la última suspensión primero.
- `GET /v1/admin/restaurants/:id` (y las respuestas de `approve`, `reject`, `suspend` y `reactivate`) agrega tres campos:

```json
{
  "id": "9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a",
  "name": "Casa 72",
  "approvalStatus": "suspended",
  "...": "los campos de siempre",
  "suspensionReason": "Varios comensales reportaron que las mesas reservadas no estaban disponibles.",
  "suspendedAt": "2026-11-17T15:00:00.000Z",
  "suspendedByEmail": "admin@example.com"
}
```

`suspensionReason`, `suspendedAt` y `suspendedByEmail` son la **última** suspensión (no hay historial), también después de reactivar; `null` si nunca se suspendió. Sugerencia: con `approvalStatus: "approved"` y `suspendedAt` lleno, mostrar «Suspendido antes: {fecha} · {motivo}».

---

## 2. `GET /v1/admin/overview?month=AAAA-MM`

Resumen de la plataforma. `month` por defecto, el mes en curso.

```json
{
  "month": "2026-11",
  "monthStatus": "in_progress",
  "revenueCop": 52000,
  "checkIns": 26,
  "previousMonth": "2026-10",
  "previousRevenueCop": 48000,
  "monthly": [
    { "month": "2025-12", "revenueCop": 0, "checkIns": 0 },
    "… 12 entradas, de la más antigua a month, también los meses en 0 …",
    { "month": "2026-11", "revenueCop": 52000, "checkIns": 26 }
  ],
  "collectedCop": 96000,
  "pendingCop": 48000,
  "restaurants": { "pending": 2, "approved": 15, "suspended": 1, "rejected": 0 },
  "currentFeeCop": 2000,
  "serverTime": "2026-11-17T15:00:00.000Z"
}
```

- `monthStatus`: `in_progress` (el mes en curso en Bogotá) o `closed`.
- `revenueCop` / `checkIns`: del mes pedido. `previousRevenueCop`: del mes anterior (para «+8 % frente a octubre»; si es 0, no mostrar porcentaje).
- `collectedCop`: lo **cobrado** (suma de lo guardado al marcar como cobrados) de **todos los meses cerrados desde 2026-01**, de restaurantes aprobados y suspendidos. `pendingCop`: lo **pendiente** de esos mismos meses (monto recalculado de los que no están marcados). No dependen de `month`.
- `currentFeeCop`: la tarifa vigente por check-in.
- `400` si `month` no es `AAAA-MM`, es anterior a `2026-01` o posterior al mes en curso.

---

## 3. Cobro por restaurante

### `GET /v1/admin/billing?month=AAAA-MM&page=1&pageSize=20`

```json
{
  "month": "2026-10",
  "monthStatus": "closed",
  "period": { "from": "2026-10-01", "to": "2026-10-31", "timezone": "America/Bogota" },
  "totals": { "checkIns": 24, "amountCop": 48000, "paidCop": 20000, "pendingCop": 28000 },
  "items": [
    {
      "restaurantId": "9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a",
      "name": "Casa 72",
      "approvalStatus": "approved",
      "checkIns": 12,
      "amountCop": 24000,
      "status": "paid",
      "paidAt": "2026-11-03T16:00:00.000Z"
    },
    {
      "restaurantId": "2b3c4d5e-6f70-4182-93a4-b5c6d7e8f901",
      "name": "Tranquilo",
      "approvalStatus": "suspended",
      "checkIns": 0,
      "amountCop": 0,
      "status": "pending",
      "paidAt": null
    }
  ],
  "total": 16,
  "page": 1,
  "pageSize": 20,
  "serverTime": "2026-11-17T15:00:00.000Z"
}
```

- Restaurantes **aprobados y suspendidos**, también con 0 check-ins, de mayor a menor `amountCop` (desempate por nombre).
- `status` por fila: `in_progress` (mes en curso: no se puede marcar), `pending` (mes cerrado sin cobrar) o `paid`. `paidAt` solo con `paid`.
- `totals`: check-ins y monto del mes de toda la plataforma; `paidCop` = lo guardado de los marcados; `pendingCop` = lo recalculado de los no marcados. En el mes en curso, `paidCop` y `pendingCop` valen 0.
- Etiquetas sugeridas: `in_progress` «En curso», `pending` «Pendiente», `paid` «Cobrado».

### `GET /v1/admin/billing/:restaurantId?month=AAAA-MM&page=1&pageSize=50`

```json
{
  "restaurant": { "id": "9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a", "name": "Casa 72", "approvalStatus": "approved" },
  "month": "2026-10",
  "period": { "from": "2026-10-01", "to": "2026-10-31", "timezone": "America/Bogota" },
  "status": "paid",
  "totalCheckIns": 12,
  "amountCop": 24000,
  "paidAt": "2026-11-03T16:00:00.000Z",
  "snapshot": { "amountCop": 24000, "checkIns": 12 },
  "amountMismatch": false,
  "items": [
    { "checkInId": "11111111-1111-4111-8111-111111111111", "checkedInAt": "2026-10-14T22:05:00.000Z", "partySize": 4, "feeCop": 2000 }
  ],
  "page": 1,
  "pageSize": 50,
  "serverTime": "2026-11-17T15:00:00.000Z"
}
```

- `amountCop` y `totalCheckIns`: siempre **recalculados** del mes.
- `snapshot`: lo que se guardó al marcarlo cobrado; `null` si no está cobrado.
- `amountMismatch: true` solo si está cobrado y lo recalculado no coincide con el snapshot. **No debería pasar**; si pasa, mostrar los dos valores y un aviso («El monto actual ({amountCop}) no coincide con el cobrado ({snapshot.amountCop}). Revísalo antes de hacer cambios.»). El backend no lo corrige solo.
- `items`: una página de check-ins, el más reciente primero. Sin datos del comensal, sin mesa ni reserva.
- `404 RESTAURANT_NOT_FOUND` si el id no existe o no es UUID. Un restaurante pendiente o rechazado responde con todo en 0.

### `POST /v1/admin/billing/:restaurantId/:month/mark-paid`

Sin body. Orden de las reglas: `400` (mes inválido) → `404` → `409 PERIOD_NOT_CLOSED` → `409 NOTHING_TO_BILL` → `409 PERIOD_ALREADY_PAID`. `200` con el **detalle actualizado** (primera página). Guarda el monto y los check-ins de ese momento (snapshot), quién y cuándo. Con dos marcas a la vez, una gana y la otra recibe `PERIOD_ALREADY_PAID`.

**Botón sugerido:** «Marcar como cobrado», visible solo con `status: "pending"` y `amountCop > 0`. Confirmación: «¿Marcar {mes} de {name} como cobrado por {amountCop}?».

### `POST /v1/admin/billing/:restaurantId/:month/mark-pending`

Sin body, para deshacer un error: vuelve a `pending` y borra el snapshot y los datos del pago. `200` con el detalle actualizado; `409 PERIOD_NOT_PAID` si no estaba cobrado. **Botón sugerido:** «Deshacer cobro» (secundario), con confirmación.

---

## 4. `GET /v1/admin/activity?month=AAAA-MM&page=1&pageSize=20`

Directorio de restaurantes aprobados y suspendidos, por nombre.

```json
{
  "month": "2026-11",
  "period": { "from": "2026-11-01", "to": "2026-11-17", "timezone": "America/Bogota" },
  "items": [
    {
      "id": "9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a",
      "name": "Casa 72",
      "category": "colombian",
      "approvalStatus": "approved",
      "isOpen": true,
      "approvedAt": null,
      "createdAt": "2026-09-01T12:00:00.000Z",
      "checkIns": 3,
      "amountCop": 5500,
      "lastTableActivityAt": "2026-11-16T23:10:00.000Z"
    }
  ],
  "total": 16,
  "page": 1,
  "pageSize": 20,
  "serverTime": "2026-11-17T15:00:00.000Z"
}
```

- `approvedAt`: cuándo lo aprobó un administrador de DiNNo; `null` si lo aprobó el equipo o la migración. En ese caso mostrar `createdAt` («En DiNNo desde …»). Reactivar no cambia `approvedAt`.
- `lastTableActivityAt`: el último cambio registrado en la bitácora de sus mesas (cualquier origen: el restaurante, una reserva o el sistema); `null` si nunca hubo. Es un dato, no una alerta: el umbral de «inactivo» no está definido (fuera de alcance).
- `isOpen`: el interruptor Abierto/Cerrado del restaurante, no su horario.

---

## 5. `GET /v1/admin/platform/metrics?from=AAAA-MM-DD&to=AAAA-MM-DD`

Métricas de reservas de toda la plataforma. Por defecto, del día 1 del mes en curso hasta hoy; máximo 366 días.

```json
{
  "period": { "from": "2026-11-01", "to": "2026-11-17", "timezone": "America/Bogota" },
  "basis": "reservations_created_at",
  "reservations": { "created": 120, "completed": 70, "cancelled": 20, "expired": 25, "active": 5 },
  "rates": { "conversion": 0.5833, "noShow": 0.2632, "cancellation": 0.1667 },
  "averagePartySize": 2.88,
  "peakHours": [
    { "hour": 0, "reservations": 0 },
    "… 24 entradas, de 0 a 23 …",
    { "hour": 23, "reservations": 1 }
  ],
  "byDayOfWeek": [
    { "dayOfWeek": 1, "reservations": 12 },
    "… 7 entradas, 1 = lunes … 7 = domingo …"
  ],
  "serverTime": "2026-11-17T15:00:00.000Z"
}
```

- **`basis: "reservations_created_at"`**: todo se cuenta sobre las reservas **creadas** en el periodo (hora de Bogotá), por su estado actual. Mostrarlo en pantalla, por ejemplo «Según la fecha en que se hizo la reserva».
- `rates` con las mismas fórmulas del resumen del restaurante: `conversion` = completed / created; `noShow` = expired / (completed + expired); `cancellation` = cancelled / created. 4 decimales; `null` si el denominador es 0 (mostrar «Sin datos», nunca 0 ni NaN).
- `peakHours`: **siempre 24 entradas** (a diferencia del resumen del restaurante, que trae las 3 mayores). `byDayOfWeek`: siempre 7.
- Antes de contar, el backend vence las reservas que ya debían vencer.
- `400` (lista) con los mensajes del periodo de siempre (`from` posterior a `to`, `to` en el futuro, más de 366 días, formato).

---

## 6. Cuenta de un restaurante suspendido (web del restaurante)

| Ruta | Respuesta |
|---|---|
| `GET /v1/me` | 200 (igual que siempre) |
| `GET /v1/restaurants/me` | 200; `approvalStatus: "suspended"` y `suspensionReason` con el motivo |
| `GET /v1/restaurants/me/status` | 200 `{ "isOpen": true, "approvalStatus": "suspended", "suspensionReason": "…" }` |
| `GET /v1/restaurants/me/summary` y `GET /v1/restaurants/me/billing/check-ins` | 200 (solo lectura: ve lo que se le cobra) |
| `GET /v1/restaurants/me/reservations` | 200 (ve quién viene en camino) |
| `POST /v1/restaurants/me/check-ins` | Funciona igual, solo con reservas activas (las demás dan sus 409 de siempre) |
| Todo lo demás (mesas, zonas, plano, bitácora, abrir/cerrar, editar, reenviar, geocodificar) | `403 RESTAURANT_SUSPENDED` |
| WebSocket | `connect_error` `RESTAURANT_SUSPENDED`; **no reintentar** (como `ACCOUNT_PENDING_APPROVAL`) |

**Pantalla sugerida «Restaurante suspendido»** (desde el `AccessGuard`, con `approvalStatus: "suspended"`):

- Título: «Tu restaurante está suspendido»
- Texto: «No apareces para los comensales mientras dure la suspensión. Las reservas que ya estaban en curso se respetan: puedes hacer su check-in.»
- Motivo: «Motivo: {suspensionReason}»
- Contacto: «Si crees que es un error, escríbenos a dinnoteam2026@gmail.com.»
- Accesos: Resumen y cobro (solo lectura), reservas en curso con su check-in, y cerrar sesión.

**Cambios aditivos en respuestas que ya usa la web:**

- `approvalStatus` puede valer `suspended`.
- `GET`/`PATCH /v1/restaurants/me` y `POST /v1/restaurants` agregan `suspensionReason`: el motivo solo mientras está suspendido; si no, `null`.
- `GET`/`PATCH /v1/restaurants/me/status` agregan `approvalStatus` y `suspensionReason`. `isOpen` no cambia.

---

## 7. Fuera de alcance

Tabla de auditoría de las acciones del administrador (solo queda la última revisión y la última suspensión), tarifa por restaurante, exportación por HTTP, alerta de inactividad del plano y gestión de correos habilitados (sigue siendo por SQL).
