# Contratos pendientes de sincronizar (§8, §10 y §12)

> **APLICADO el 15 nov 2026** en los `CLAUDE.md` de backend, frontend y mobile (§1, §8, §10 y §12). Este archivo queda solo como referencia y se puede borrar.

> Para Elizabeth. Las secciones 1 a 10 y 12 del `CLAUDE.md` son **iguales en los tres repositorios** (backend, frontend, mobile). Este archivo trae el texto **exacto** propuesto para §10 y §12 por la aprobación de restaurantes, el panel del administrador, el cobro por check-in y el resumen del restaurante (rama `feat/admin-approval`). Se copia a los tres `CLAUDE.md` en el mismo día y se anuncia en `AVISOS.md`; después se borra este archivo.
>
> **§8 ya está editado en el `CLAUDE.md` de este repo** (cuatro líneas nuevas: «Revisión de restaurantes», «Pendiente y rechazado editan», «Cobro por check-in» y «Reportes del restaurante»). Como §8 también es común, hay que copiarlas a los otros dos repos.
>
> Cada bloque dice **dónde** va y si **reemplaza** o **agrega**. El texto entre las líneas `---` es el que se pega tal cual.

---

## A. §1 · Sprint actual (reemplaza la línea en negrita bajo la tabla de responsables)

---
**Sprint 4 (actual): aprobación de restaurantes, cobro por check-in y resumen del restaurante (contratos en la sección 12.12). Sprint 3 cerrado: Microreservas y check-in (contratos en la sección 12). Sprint 2 cerrado: Búsqueda y disponibilidad para el comensal (contratos en la sección 10). Sprint 1 cerrado: Restaurante operativo.**
---

> Si el equipo no considera esto «Sprint 4», cambia solo el rótulo: el resto del texto no depende de él.

## B. §10 · «Cuentas y roles»

### B.1 Reemplaza las viñetas 1, 2 y 4 (roles, restaurantes habilitados, quién crea usuarios)

---
- Roles posibles: `restaurant_admin` (solo web), `diner` (solo app) y `platform_admin` (administrador de DiNNo; solo web, panel `/admin`). Cada cuenta tiene **un solo rol**. `platform_admin` se crea solo por seed (`PLATFORM_ADMIN_EMAIL`) o SQL, nunca por registro.
- **Restaurantes:** una cuenta es de restaurante si es una fila de `users` con rol `restaurant_admin`. Se llega a ella por dos caminos: el **registro público** (`POST /v1/restaurants/signup`, §12.12), que crea el usuario y el restaurante `pending`, o el equipo, que habilita un correo insertando la fila (ver `docs/database.md` del backend) y ese usuario registra su restaurante con `POST /v1/restaurants`, que nace `approved`.
- **El backend no crea usuarios al iniciar sesión.** Solo dos endpoints crean un usuario: `POST /v1/diners/me` (siempre con el rol `diner`) y `POST /v1/restaurants/signup` (siempre con el rol `restaurant_admin` y su restaurante `pending`).
---

### B.2 Reemplaza la tabla «Códigos de cuenta» y su línea de precedencia

---
**Códigos de cuenta.** Precedencia: 401 de sesión → `EMAIL_NOT_VERIFIED` → cuenta sin perfil (`PROFILE_REQUIRED` / `ACCOUNT_NOT_ENABLED`) → rol que la ruta no acepta (`DINER_ACCOUNT` / `RESTAURANT_ACCOUNT` / `ADMIN_ACCOUNT`) → restaurante no aprobado (`ACCOUNT_PENDING_APPROVAL` / `ACCOUNT_REJECTED`) → `RESTAURANT_REQUIRED`. El rol va antes que la aprobación: un restaurante pendiente en una ruta de comensal o de administrador recibe `RESTAURANT_ACCOUNT`.

| Situación | HTTP | `errorCode` | Mensaje (`message`) |
|---|---|---|---|
| Token ausente, inválido o vencido | 401 | — | Tu sesión terminó. Inicia sesión de nuevo. |
| Correo sin verificar (cuenta todavía sin vincular) | 401 | `EMAIL_NOT_VERIFIED` | Verifica tu correo para continuar. |
| Sin perfil + endpoint de restaurante o de administrador | 403 | `ACCOUNT_NOT_ENABLED` | Esta cuenta no está habilitada como restaurante. Si eres comensal, encuentra mesa desde la app DiNNo. |
| Sin perfil + endpoint de comensal | 403 | `PROFILE_REQUIRED` | Completa tu perfil para continuar. *(la app no lo muestra: llama a `POST /v1/diners/me` y reintenta)* |
| Comensal en endpoint de restaurante o de administrador | 403 | `DINER_ACCOUNT` | Esta es una cuenta de comensal. Para buscar mesa, usa la app DiNNo. |
| Restaurante en endpoint de comensal o de administrador | 403 | `RESTAURANT_ACCOUNT` | Esta es una cuenta de restaurante. Administra tu restaurante desde la web. |
| Administrador de DiNNo en endpoint de restaurante o de comensal | 403 | `ADMIN_ACCOUNT` | Esta es una cuenta de administrador de DiNNo. Usa el panel de administración en la web. |
| Restaurante en revisión (`pending`) en una ruta que no le está permitida | 403 | `ACCOUNT_PENDING_APPROVAL` | Tu solicitud está en revisión. Te avisaremos cuando tu cuenta esté aprobada. |
| Restaurante rechazado (`rejected`) en una ruta que no le está permitida | 403 | `ACCOUNT_REJECTED` | Tu solicitud no fue aprobada. Revisa el motivo, corrige tus datos y vuelve a enviarla. |
| Restaurante habilitado sin restaurante registrado | 403 | `RESTAURANT_REQUIRED` | Primero registra tu restaurante. *(sin cambios)* |
---

### B.3 Reemplaza las viñetas «Endpoints de restaurante», «Endpoints de comensal» y «Ambos roles»

---
- **Endpoints de restaurante:** todos los del Sprint 1 (`/v1/restaurants`, `/v1/restaurants/me*`, `/v1/tables*`, `/v1/table-logs`), los de restaurante de §12.8 y los de §12.12 (`/v1/restaurants/me/resubmit`, `/v1/restaurants/me/summary`, `/v1/restaurants/me/billing/check-ins`). Solo un restaurante `approved` los usa todos; uno `pending` o `rejected` solo puede usar los de la lista de §12.12.
- **Endpoints de comensal:** `/v1/search/*` y `/v1/restaurants/:id/public`, y los de comensal de §12.8 (`/v1/reservations*`).
- **Endpoints de administrador** (`platform_admin`): `/v1/admin/*` (§12.12).
- **Todos los roles:** `GET /v1/me` (una cuenta sin perfil recibe `PROFILE_REQUIRED`).
- **`GET /v1/geocode`:** comensal, restaurante (con o sin restaurante registrado, también pendiente o rechazado) y **cuenta de Firebase sin perfil con el correo verificado** (el formulario del registro público lo usa antes de que exista la cuenta). Solo `platform_admin` recibe `403 ADMIN_ACCOUNT`.
---

## C. §10 · «Endpoints nuevos o modificados»

### C.1 Reemplaza la fila de `GET /me`

---
| GET | `/me` | todos | — | 200 `{ id, email, displayName: string \| null, role, restaurantId: string \| null }`; `role` puede ser `platform_admin` · sin perfil → 403 `PROFILE_REQUIRED` |
---

### C.2 Reemplaza la fila de `GET /geocode`

---
| GET | `/geocode` | comensal, restaurante (con o sin restaurante, aprobado o no) y cuenta sin perfil con correo verificado | `address` (3–255 caracteres) | 200 `{ latitude, longitude, formattedAddress }` · 404 `ADDRESS_NOT_FOUND` «No encontramos esa dirección en Bogotá.» · 503 `GEOCODING_UNAVAILABLE` «No pudimos ubicar la dirección en este momento.» · `platform_admin` → 403 `ADMIN_ACCOUNT`. Los mensajes son neutros: cada cliente muestra su propio texto según el `errorCode` |
---

### C.3 Reemplaza la viñeta del 404 del detalle (en «Reglas de los campos»)

---
- `/restaurants/:id/public` → 404 `RESTAURANT_NOT_FOUND` si el id no es un UUID válido, si no existe, si no tiene coordenadas o si no está aprobado (pendiente o rechazado).
---

## D. §10 · «Disponibilidad»: reemplaza la viñeta «Aparece en la búsqueda»

---
- **Aparece en la búsqueda** solo si está **aprobado** (`approval_status = 'approved'`), tiene coordenadas, está abierto ahora y tiene al menos 1 mesa activa (más el filtro de `partySize`: al menos 1 mesa libre y activa con `capacity ≥ partySize`). Un restaurante pendiente o rechazado no existe para el comensal: no aparece, su detalle y su reserva dan `404 RESTAURANT_NOT_FOUND` y no emite `availability.changed`.
---

## E. §10 · «Tiempo real»: reemplaza las dos primeras oraciones de la primera viñeta (desde «Se aceptan comensales» hasta «`SERVER_ERROR` (...)»)

---
Se aceptan comensales (salas `diners` y `diner:{userId}`) y `restaurant_admin` con restaurante registrado **y aprobado** (sala `restaurant:{restaurantId}`); las salas y los eventos de reservas están en §12.7. Si no, la conexión se rechaza con `connect_error`, cuyo `message` es un código: `UNAUTHORIZED` (token ausente, inválido o vencido; solo existe en el WebSocket, en HTTP es el 401 sin `errorCode`), `EMAIL_NOT_VERIFIED` (correo sin verificar), `PROFILE_REQUIRED`, `RESTAURANT_REQUIRED` (admin sin restaurante registrado; mismo código que el 403 de HTTP), `ACCOUNT_PENDING_APPROVAL` / `ACCOUNT_REJECTED` (restaurante no aprobado; mismos códigos que el 403 de HTTP), `ADMIN_ACCOUNT` (`platform_admin`: todavía no hay eventos de administración) o `SERVER_ERROR` (el handshake falló por algo distinto a la sesión, por ejemplo la base caída).
---

En la viñeta siguiente («Socket.IO no reintenta solo…»), sin cambios: con `ACCOUNT_PENDING_APPROVAL`, `ACCOUNT_REJECTED` y `ADMIN_ACCOUNT` tampoco se reintenta.

## F. §12.7 · Reemplaza la segunda viñeta

---
- Ahora también acepta cuentas `restaurant_admin` con restaurante registrado y **aprobado**. Si el admin no tiene restaurante, el rechazo es `RESTAURANT_REQUIRED`; si su restaurante está pendiente o rechazado, `ACCOUNT_PENDING_APPROVAL` o `ACCOUNT_REJECTED`; un `platform_admin` recibe `ADMIN_ACCOUNT`.
---

## G. §12.8 · Contratos de la API

### G.1 Reemplaza la fila de `POST /v1/reservations` (solo cambia el 404)

---
| POST | `/v1/reservations` | diner | `{ restaurantId, partySize }` | 201 `Reservation` · 409 `NO_TABLE_AVAILABLE` / `ACTIVE_RESERVATION_EXISTS` / `RESTAURANT_CLOSED` · 404 `RESTAURANT_NOT_FOUND` si el restaurante no existe, no es visible o no está aprobado (igual que el detalle público) · 400 validación |
---

### G.2 Reemplaza la fila de `GET · PATCH · POST /v1/restaurants/me` y `/v1/restaurants`

---
| GET · PATCH · POST | `/v1/restaurants/me` (GET y PATCH) · `/v1/restaurants` (POST) | restaurant_admin | igual que hoy; PATCH y POST aceptan además `contactPhone?` (§12.12) | ahora incluyen `activeReservationsCount` (número), `approvalStatus`, `rejectionReason` (solo si está rechazado; si no, `null`) y `contactPhone` (`null` si no lo registró). En el POST `activeReservationsCount` vale 0 y el restaurante nace `approved` |
---

## H. §12.9 · Agrega dos filas al final de la tabla de `errorCode`

---
| `RESTAURANT_NOT_PENDING` | 409 | `POST /admin/restaurants/:id/approve` · `POST /admin/restaurants/:id/reject` | «Esta solicitud ya fue revisada.» La web vuelve a consultar el detalle |
| `RESTAURANT_NOT_REJECTED` | 409 | `POST /restaurants/me/resubmit` | «Tu solicitud no está rechazada.» La web vuelve a consultar `GET /restaurants/me` |
---

Y agrega, debajo de esa tabla:

---
Los códigos de cuenta nuevos (`ADMIN_ACCOUNT`, `ACCOUNT_PENDING_APPROVAL`, `ACCOUNT_REJECTED`) están en la tabla de códigos de cuenta de §10.
---

## I. §12.10 · Reemplaza la viñeta «Estado de cuenta y comisiones (Sprint 4).»

---
- Comisiones variables, facturas y pagos (el estado de cuenta con tarifa fija por check-in está en §12.12).
---

## J. §12 · Agrega la sección 12.12 al final

---
### 12.12 Aprobación de restaurantes, cobro por check-in y resumen

**Aprobación de restaurantes**
- **Estados** (`restaurants.approval_status`): `pending` (en revisión) · `approved` (visible para el comensal y operable) · `rejected` (no aprobado; ve el motivo). Todos los restaurantes que existían quedaron `approved`.
- **Quién nace cómo:** el registro público (`POST /v1/restaurants/signup`) → `pending`. `POST /v1/restaurants` (usuario habilitado por el equipo) y el seed → `approved`.
- **Solo un restaurante `approved` existe para el comensal** (§10, «Disponibilidad») y opera.
- **Un restaurante pendiente o rechazado solo puede usar:** `GET /v1/me`, `GET /v1/restaurants/me`, `PATCH /v1/restaurants/me`, `POST /v1/restaurants/me/resubmit`, `GET /v1/restaurants/me/status` (solo lectura) y `GET /v1/geocode`. En cualquier otra ruta de restaurante recibe `403 ACCOUNT_PENDING_APPROVAL` o `ACCOUNT_REJECTED`, y el WebSocket lo rechaza con el mismo código.
- **Editar** (`PATCH /v1/restaurants/me`) no cambia el estado: un pendiente sigue pendiente y un rechazado sigue rechazado hasta que reenvía.
- **Reenviar** (`POST /v1/restaurants/me/resubmit`, sin body): solo desde `rejected`; vuelve a `pending`, se borran el motivo y la revisión y la solicitud vuelve al final de la lista del administrador. Si no está rechazado: `409 RESTAURANT_NOT_REJECTED`.
- **Revisar** (solo `platform_admin`): aprobar o rechazar, solo desde `pending`. El rechazo lleva motivo obligatorio (10 a 300 caracteres) que ve el restaurante en `rejectionReason`. Dos administradores a la vez: uno gana y el otro recibe `409 RESTAURANT_NOT_PENDING`. Al aprobar, el restaurante empieza a aparecer para los comensales (se emite `availability.changed`) si cumple lo demás.
- Sin documentos, sin correos y sin suspender restaurantes aprobados.

**Registro público** (`POST /v1/restaurants/signup`)
- Lo usa una cuenta de Firebase **sin perfil** con el **correo verificado**; no lleva `@Roles`.
- Body: los campos de `POST /v1/restaurants` (`name`, `category`, `address`, `latitude?`, `longitude?`, `schedules`) más `contactPhone` **obligatorio**: de 7 a 15 dígitos; se aceptan espacios, guiones, puntos, paréntesis y un `+` inicial, y se guarda sin separadores (`+57 300 123 4567` → `+573001234567`).
- Crea en una sola transacción el usuario `restaurant_admin` y el restaurante `pending` con sus horarios. `201` con la misma forma de `GET /v1/restaurants/me`.
- Si la cuenta ya existe: comensal → `403 DINER_ACCOUNT`; `platform_admin` → `403 ADMIN_ACCOUNT`; restaurante con restaurante → `409` «Ya registraste tu restaurante…»; restaurante habilitado sin restaurante → `409` (sin `errorCode`) «Tu cuenta ya está habilitada como restaurante. Registra tu restaurante desde el formulario de registro.».

**Cobro por check-in**
- Tarifa fija en pesos colombianos por cada check-in válido: `CHECKIN_FEE_COP` (por defecto 2000). Cada check-in guarda la tarifa vigente en ese momento; cambiarla no altera los anteriores. Cancelaciones y vencimientos no se cobran.

**Reportes del restaurante** (solo `restaurant_admin` **aprobado**)
- **Periodo:** `from` y `to` son días de Bogotá (`AAAA-MM-DD`), rango inclusivo. Por defecto, del día 1 del mes en curso hasta hoy (si solo llega `to`, desde el día 1 de ese mes). `to` no puede ser posterior a hoy y el periodo tiene como máximo 366 días; si no, `400` con la lista de mensajes.
- Nunca traen datos del comensal.

**Contratos de la API**

| Método | Ruta | Rol | Recibe | Devuelve |
|---|---|---|---|---|
| POST | `/v1/restaurants/signup` | cuenta sin perfil, correo verificado | campos de `POST /v1/restaurants` + `contactPhone` | 201 perfil del restaurante (`approvalStatus: 'pending'`) · 403 `DINER_ACCOUNT` / `ADMIN_ACCOUNT` · 409 · 400 |
| PATCH | `/v1/restaurants/me` | restaurant_admin (también pendiente o rechazado) | lo de hoy + `contactPhone?` (no `null`) | 200 perfil del restaurante; no cambia `approvalStatus` |
| POST | `/v1/restaurants/me/resubmit` | restaurant_admin rechazado | — | 200 perfil del restaurante (`pending`) · 409 `RESTAURANT_NOT_REJECTED` |
| GET | `/v1/restaurants/me/status` | restaurant_admin (también pendiente o rechazado, solo lectura) | — | 200 `{ isOpen }` (sin cambios) |
| GET | `/v1/restaurants/me/billing/check-ins` | restaurant_admin aprobado | `from?`, `to?`, `page?` (≥ 1, por defecto 1), `pageSize?` (1–200, por defecto 50) | 200 `BillingStatement` · 400 periodo o paginación |
| GET | `/v1/restaurants/me/summary` | restaurant_admin aprobado | `from?`, `to?` | 200 `RestaurantSummary` · 400 periodo |
| GET | `/v1/admin/restaurants` | platform_admin | `status?` (`pending` por defecto, `approved`, `rejected`), `page?` (≥ 1), `pageSize?` (1–100, por defecto 20) | 200 `{ items: AdminRestaurantItem[], total, page, pageSize }` · 400 |
| GET | `/v1/admin/restaurants/:id` | platform_admin | — | 200 `AdminRestaurantDetail` · 404 `RESTAURANT_NOT_FOUND` |
| POST | `/v1/admin/restaurants/:id/approve` | platform_admin | — | 200 `AdminRestaurantDetail` · 404 `RESTAURANT_NOT_FOUND` · 409 `RESTAURANT_NOT_PENDING` |
| POST | `/v1/admin/restaurants/:id/reject` | platform_admin | `{ reason }` (10–300 caracteres sin contar espacios de los extremos) | 200 `AdminRestaurantDetail` · 400 · 404 `RESTAURANT_NOT_FOUND` · 409 `RESTAURANT_NOT_PENDING` |

- Un `:id` que no es UUID en `/v1/admin/restaurants/:id*` responde el mismo `404 RESTAURANT_NOT_FOUND`.
- Las rutas `/v1/admin/*` responden a quien no es `platform_admin`: `RESTAURANT_ACCOUNT` (también un restaurante pendiente o rechazado), `DINER_ACCOUNT` o `ACCOUNT_NOT_ENABLED` (sin perfil).

**`AdminRestaurantItem`** (lista): `{ id, name, category, address, contactPhone, approvalStatus, submittedAt, reviewedAt, ownerEmail }`
- Orden: las pendientes por `submittedAt` ascendente (la que más lleva esperando primero); las aprobadas y rechazadas por `reviewedAt` descendente (las nunca revisadas, al final).
- `submittedAt`: cuándo se envió o se reenvió la solicitud. `reviewedAt`: la última revisión, o `null`.
- `ownerEmail`: correo del dueño (si hubiera varios, el de la cuenta más antigua) o `null`. Solo lo ve el administrador.

**`AdminRestaurantDetail`**: lo de `AdminRestaurantItem` más `{ latitude, longitude, schedules[], rejectionReason, reviewedByEmail, createdAt }`. `schedules[]` con el formato de `GET /restaurants/me`; `rejectionReason` solo si está rechazado (si no, `null`); `reviewedByEmail` el del administrador que revisó, o `null`.

**`BillingStatement`**: `{ period: { from, to, timezone: 'America/Bogota' }, totalCheckIns, amountCop, items: [{ checkInId, reservationId, checkedInAt, partySize, tableIdentifier, feeCop }], page, pageSize, serverTime }`
- `totalCheckIns` y `amountCop` (suma de `feeCop`, en COP) son del periodo completo; `items` es la página pedida, el check-in más reciente primero. Se filtra por la fecha del check-in.

**`RestaurantSummary`**: `{ period: { from, to, timezone: 'America/Bogota' }, billing: { checkIns, amountCop, currentFeeCop }, reservations: { created, completed, cancelled, expired, active }, rates: { conversion, noShow, cancellation }, averagePartySize, peakHours: [{ hour, reservations }], byDayOfWeek: [{ dayOfWeek, reservations }], serverTime }`
- `reservations`: reservas **creadas** en el periodo, por su estado actual. Antes de contar, el backend vence las reservas debidas.
- `billing`: check-ins **hechos** en el periodo; `amountCop` = suma de la tarifa guardada en cada uno; `currentFeeCop` = la tarifa vigente.
- `rates` (4 decimales; `null` si el denominador es 0): `conversion` = completed / created · `noShow` = expired / (completed + expired) · `cancellation` = cancelled / created.
- `averagePartySize`: promedio de personas de las creadas, con 2 decimales; `null` si no hay.
- `peakHours`: las 3 horas (0 a 23, hora de Bogotá) con más reservas creadas, de mayor a menor; a igual cantidad, la hora menor primero; vacío si no hay.
- `byDayOfWeek`: siempre 7 entradas (1 = lunes … 7 = domingo), con 0 en los días sin reservas.
---
