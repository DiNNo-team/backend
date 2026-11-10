# QA Sprint 3 · Jacobo (M1, M2, M3, M8, M9, T1)

**Responsable:** Jacobo · **Preparado:** 8 nov 2026 · **Ambiente:** Render (`https://dinno-backend.onrender.com`) + Neon, según `AVISOS.md` («concurrencia M2 y M3 por HTTP en Render con 2 o más comensales»).

**Fuentes:** `CLAUDE.md` §12 (contratos) y las entradas del Sprint 3 de `AVISOS.md`. Cada fila cita su sección. Lo que no está ahí está marcado **«Por confirmar»**.

> **La definición de cada caso (M1…T1) está en el §9 del plan del sprint, que no está en el repo.** Las de M2, M3, M9 y T1 salen de lo que pidió Jacobo y del §12. **M1 y M8 quedan sin filas hasta confirmar su definición** (sección «Por confirmar»).

**Nombres de campos (§12.8):** la mesa de la reserva del comensal es `table.identifier` (con `table.capacity`); en la reserva del restaurante y en el check-in es `tableIdentifier`. En el §12 y en el código no aparece `table.label`.

**Cómo llenar «Resultado y evidencia»:** ✅ / ❌, la hora y la evidencia (código HTTP y `errorCode` de la respuesta, captura de la web o salida del script). **Nunca pegues tokens ni códigos de reserva activos** en la evidencia.

---

## M1 · **Por confirmar**

Definición del caso: **Por confirmar** (plan del sprint §9).

| # | Pasos | Esperado (HTTP · `errorCode`) | Fuente | Resultado y evidencia |
|---|---|---|---|---|
| 1 | Por confirmar | Por confirmar | — | |

---

## M2 · Dos o más comensales compiten por la última mesa (concurrencia)

Definición tomada de `AVISOS.md` (concurrencia por HTTP, 2 o más comensales) y §12.4. **Por confirmar** que M2 es exactamente «una sola mesa».

**Precondición:** restaurante de pruebas abierto ahora (§12.1), con **una sola** mesa activa, Disponible y con capacidad ≥ `PARTY_SIZE`. Ningún comensal tiene una reserva activa.

| # | Pasos | Esperado (HTTP · `errorCode`) | Fuente | Resultado y evidencia |
|---|---|---|---|---|
| 1 | Ensayo: `scripts/qa/concurrencia.mjs` sin `CONFIRM`, con 2 tokens y `EXPECTED_TABLES=1` | Muestra `BASE_URL`, `RESTAURANT_ID` y «2 solicitudes»; no envía nada | — | |
| 2 | Lo mismo con `CONFIRM=1` (2 comensales a la vez) | 1 × `201`; 1 × `409 NO_TABLE_AVAILABLE`. Veredicto PASA | §12.4, §12.9 | |
| 3 | Con la reserva `201`: mirar la mesa en la web | La mesa pasa de Disponible a **Reservada** | §12.3 | |
| 4 | Bitácora (`GET /v1/table-logs` o la web) | Una fila `available` → `reserved`, `source: reservation`, `userEmail: null` (la web muestra «Comensal») | §12.3 | |
| 5 | El comensal que perdió: `GET /v1/reservations/active` | `200 { reservation: null, serverTime }` | §12.8 | |
| 6 | Limpieza (`CLEANUP=1` o `POST /v1/reservations/:id/cancel`) | `200`, `status: cancelled`, `code: null`; la mesa vuelve a Disponible; bitácora `reserved` → `available` con `source: reservation` | §12.3, §12.8 | |
| 7 | Repetir 2 a 6 con **5** comensales a la vez (`EXPECTED_TABLES=1`) | 1 × `201`; 4 × `409 NO_TABLE_AVAILABLE`. PASA | §12.4 | |
| 8 | Repetir el paso 7 al menos 3 veces (una carrera puede no darse en un solo intento) | PASA en todas las rondas | §12.4 | |

---

## M3 · Varias mesas, varios comensales (concurrencia)

**Precondición:** restaurante de pruebas abierto, con **K** mesas activas, Disponibles y con capacidad ≥ `PARTY_SIZE` (por ejemplo K = 3), y **N = 5** comensales sin reserva activa.

| # | Pasos | Esperado (HTTP · `errorCode`) | Fuente | Resultado y evidencia |
|---|---|---|---|---|
| 1 | Script con 5 tokens, `EXPECTED_TABLES=K`, `CONFIRM=1` | K × `201`; (5 − K) × `409 NO_TABLE_AVAILABLE`. PASA | §12.4, §12.9 | |
| 2 | En la salida del script: la mesa de cada `201` | **Todas distintas** (el script lo comprueba y da FALLA si dos comparten mesa) | §12.4 (una reserva `active` por mesa) | |
| 3 | En la web: estado de las K mesas | Las K quedan **Reservadas**; ninguna otra cambia | §12.3 | |
| 4 | Restaurante: `GET /v1/restaurants/me/reservations` | `200` con K reservas `active`, la más próxima a vencer primero, **sin `code`** | §12.6, §12.8 | |
| 5 | Limpieza (`CLEANUP=1`) | K cancelaciones `200`; las K mesas vuelven a Disponible | §12.3 | |
| 6 | Asignación (sin concurrencia): mesas Disponibles de capacidad 2, 4 y 6; un comensal reserva con `partySize: 2` | `201` con `table.capacity: 2` (la más pequeña que alcance) | §12.1 | |
| 7 | Desempate: dos mesas Disponibles de la misma capacidad (por ejemplo «2» y «10»); un comensal reserva | `201` con la de identificador menor | §12.1 | |
| 8 | Una mesa puesta en Reservada **a mano** y ninguna otra libre que alcance; un comensal reserva | `409 NO_TABLE_AVAILABLE` (la mesa reservada a mano nunca se asigna) | §12.1 | |

> En el paso 7, «menor» con dos identificadores numéricos: el §12.1 dice «identificador menor», y `CLAUDE.md` §11 precisa el orden numérico («2» antes que «10»). **Por confirmar** si el caso lo exige.

---

## M8 · **Por confirmar**

Definición del caso: **Por confirmar** (plan del sprint §9).

| # | Pasos | Esperado (HTTP · `errorCode`) | Fuente | Resultado y evidencia |
|---|---|---|---|---|
| 1 | Por confirmar | Por confirmar | — | |

---

## M9 · Check-in con códigos válidos e inválidos

Todo con `POST /v1/restaurants/me/check-ins` y el token del `restaurant_admin` del restaurante A (el de pruebas). «B» es otro restaurante con su propio admin.

| # | Pasos | Esperado (HTTP · `errorCode`) | Fuente | Resultado y evidencia |
|---|---|---|---|---|
| 1 | Código **válido** de una reserva activa de A, tal cual | `200 { reservationId, tableIdentifier, partySize, dinerName, checkedInAt }`. La web: «Check-in confirmado · Mesa {tableIdentifier} · {partySize} personas · {dinerName}» (`dinerName` `null` → «Comensal») | §12.6, §12.8 | |
| 2 | Después del paso 1: mesa y bitácora | Mesa `reserved` → `occupied`; bitácora con `source: reservation` y el correo del admin | §12.3 | |
| 3 | Después del paso 1: el comensal consulta `GET /v1/reservations/:id` | `200`, `status: completed`, `checkedInAt` lleno, `code: null` | §12.1, §12.8 | |
| 4 | Código válido escrito **en minúsculas y con espacios** (por ejemplo `k7m 4qx` para `K7M4QX`), con otra reserva activa | `200` (el backend quita los espacios y pasa a mayúsculas) | §12.1 («Código») | |
| 5 | **Ya usado:** repetir el código del paso 1 | `409 RESERVATION_ALREADY_USED`; `message` «Este código ya se usó a las HH:mm.» (hora de Bogotá, 24 h); la web lo muestra tal cual | §12.6, §12.9 | |
| 6 | **Cancelado:** el comensal cancela su reserva y luego A escribe el código | `409 RESERVATION_CANCELLED`; la web: «El comensal canceló esta reserva.» | §12.6, §12.9 | |
| 7 | **Vencido:** reserva que pasó su vigencia sin check-in | `409 RESERVATION_EXPIRED`; `message` «Esta reserva se venció a las HH:mm. La mesa ya se liberó.» (hora del vencimiento, Bogotá) | §12.5, §12.6, §12.9 | |
| 8 | **Inexistente:** código con formato correcto que no existe (por ejemplo `ZZZZZZ`) | `404 RESERVATION_CODE_NOT_FOUND`; la web: «No encontramos una reserva con ese código en tu restaurante.» | §12.6, §12.9 | |
| 9 | **De otro restaurante:** código activo de una reserva de B, escrito por el admin de A | `404 RESERVATION_CODE_NOT_FOUND` (igual que uno inexistente) | §12.6 | |
| 10 | Después del paso 9: el comensal de B consulta su reserva | Sigue `active`: el intento de A no la tocó | §12.6 | |
| 11 | **Formato inválido:** `ABC` (corto), `K7M4QX9` (largo), `K7M4Q0` (con `0`, fuera del alfabeto), `K7-M4Q` (símbolo) | `404 RESERVATION_CODE_NOT_FOUND` en todos | §12.1 (alfabeto), §12.6 | |
| 12 | **Vacío:** `{ "code": "" }` y `{ "code": "   " }` | `404 RESERVATION_CODE_NOT_FOUND` | §12.6 («formato inválido») | |
| 13 | **Sin `code`:** body `{}` | `400`, sin `errorCode` | `CLAUDE.md` §11 «Check-in» (no está en el §12) | |
| 14 | **`code` que no es texto:** `{ "code": 123456 }` y `{ "code": null }` | `400`, sin `errorCode` | `CLAUDE.md` §11 «Check-in» (no está en el §12) | |

**Cómo conseguir cada estado:** para el 5, el código del paso 1. Para el 6, el comensal cancela desde la app o con `POST /v1/reservations/:id/cancel`. Para el 7, esperar la vigencia (15 min por defecto; 3 si Render corre con `RESERVATION_TTL_MINUTES=3`, `AVISOS.md`). **Por confirmar** con Elizabeth el valor actual en Render. Para el 9, un comensal reserva en B.

---

## T1 · Cada rol solo hace lo suyo (HTTP y WebSocket)

| # | Pasos | Esperado (HTTP · `errorCode`) | Fuente | Resultado y evidencia |
|---|---|---|---|---|
| 1 | El **restaurante** intenta reservar: `POST /v1/reservations` con su token | `403 RESTAURANT_ACCOUNT` | §12.8 (nota de roles), §10 | |
| 2 | El restaurante: `GET /v1/reservations/active` | `403 RESTAURANT_ACCOUNT` | §12.8, §10 | |
| 3 | El **comensal** intenta un check-in: `POST /v1/restaurants/me/check-ins` | `403 DINER_ACCOUNT` | §12.8, §10 | |
| 4 | El comensal intenta ver reservas de restaurante: `GET /v1/restaurants/me/reservations` | `403 DINER_ACCOUNT` | §12.8, §10 | |
| 5 | Sin token, cualquiera de las rutas anteriores | `401`, sin `errorCode` | §10 | |
| 6 | El comensal consulta la reserva de **otro** comensal: `GET /v1/reservations/:id` | `404 RESERVATION_NOT_FOUND` | §12.8, §12.9 | |
| 7 | **Socket, comensal:** conectar con su token | Conecta. Recibe `availability.changed` (sala `diners`) y solo **sus** `reservation.cancelled`, `reservation.expired` y `reservation.checked_in` (sala `diner:{id}`). **No** recibe `reservation.created` ni `table.status_changed` | §12.7, §12.8 | |
| 8 | **Socket, restaurante con restaurante registrado:** conectar | Conecta. Recibe `reservation.created` (sin `code`), `reservation.cancelled`, `reservation.expired`, `reservation.checked_in` y `table.status_changed` **de su restaurante**. **No** recibe `availability.changed` | §12.7, §12.8 | |
| 9 | Socket: el admin de A está conectado y un comensal reserva en B | A no recibe nada de B | §12.7 («Cada uno recibe solo lo suyo») | |
| 10 | Socket: un admin **sin** restaurante registrado | `connect_error` con `message` `RESTAURANT_REQUIRED` | §12.7, §10 | |
| 11 | Socket sin token o con un token inválido | `connect_error` `UNAUTHORIZED` | §10 | |
| 12 | Socket con una cuenta sin perfil | `connect_error` `PROFILE_REQUIRED` | §10 | |
| 13 | Check-in con el socket del comensal conectado | El comensal recibe `reservation.checked_in` `{ reservationId, status: completed, tableId, at }` | §12.8 | |

**Herramienta para el socket:** `scripts/listen-availability.mjs` solo imprime `availability.changed`. Para los eventos de reserva (filas 8, 9 y 13) hace falta otra forma de escucharlos (el panel de la web o un script nuevo): **Por confirmar**.

---

## Resultados locales

**Fecha:** 9 nov 2026 · **Ambiente:** backend local con PostgreSQL y Redis propios (no Render ni Neon) · **Restaurante A:** Casa 72 (`2d162fd1-2df1-4cac-9931-d0870c29e1d9`) · **Restaurante B:** Piazza Italia Calle 93.

### Resumen

| Caso | Herramienta | Resultado | Veredicto |
|---|---|---|---|
| M1 | `scripts/qa/reserva-casos.mjs` | 6 PASA · 0 FALLA | **PASA** |
| M2 | `scripts/qa/concurrencia.mjs` | 1 × `201`, 1 × `409 NO_TABLE_AVAILABLE` | **PASA** |
| M3 | `scripts/qa/concurrencia.mjs` | 2 corridas (1 mesa y 3 mesas) | **PASA** |
| M8 | `scripts/qa/checkin.mjs` | 3 de 4 comprobaciones; falta el duplicado de `check_ins` | **Pendiente** |
| M9 | `scripts/qa/checkin.mjs` | 19 PASA · 0 FALLA · 0 OMITIDA | **PASA** |
| T1 HTTP (filas 1 a 6) | `scripts/qa/roles.mjs` | 15 PASA · 0 FALLA | **PASA** |
| T1 WebSocket (filas 7 a 13) | `scripts/qa/escuchar-eventos.mjs` | 18 PASA · 0 FALLA | **PASA** |

### Cuentas de QA usadas

Cuentas de Firebase con correo y clave, todas alias de la bandeja `dinnoteam2026@gmail.com`. Las claves están fuera del repo.

| Rol | Cuenta | Para qué |
|---|---|---|
| `restaurant_admin` de A | `dinnoteam2026+casa72@gmail.com` | Dueño de Casa 72: check-in, cerrar y abrir, mesas, eventos del restaurante |
| `restaurant_admin` sin restaurante | `dinnoteam2026+qaadmin@gmail.com` | T1 fila 10 (`RESTAURANT_REQUIRED`). Habilitado en la base local con el `INSERT` de `docs/database.md`, sin restaurante |
| `diner` | `dinnoteam2026+qa21@gmail.com` a `+qa25@gmail.com` | Reservas, concurrencia (2 o 5 a la vez), check-in, roles y eventos del comensal |
| Cuenta sin perfil local | `dinnoteam2026+qa26@gmail.com` | T1 fila 12 (`PROFILE_REQUIRED`). Verificada en Firebase, sin `POST /v1/diners/me` |

- **`dinnoteam2026@gmail.com` no se usó:** solo tiene inicio de sesión con Google, sin clave, así que los scripts no pueden iniciar sesión con ella. Por eso el administrador sin restaurante es `qaadmin`.
- El restaurante B no necesita cuenta: solo recibe una reserva de un comensal.

### M1 · Reservar: casos que no salen en la concurrencia

La mesa más pequeña que alcanza y el caso «con mesa» ya salieron en las corridas de concurrencia (M3, variante de 3 mesas).

| Fila | Caso | Esperado | Resultado |
|---|---|---|---|
| b | 8 personas, sin mesa activa de 8 o más (Mesa 8 inactiva) | `409 NO_TABLE_AVAILABLE` | PASA |
| c1 | Un comensal con reserva activa pide otra | `409 ACTIVE_RESERVATION_EXISTS` | PASA |
| c2 | La primera reserva sigue siendo la activa | `200`, la misma reserva | PASA |
| a1 | Reservar con el restaurante Cerrado | `409 RESTAURANT_CLOSED` | PASA |
| a2 | Detalle público con el restaurante Cerrado | `200`, `isOpenNow: false`, `closed` | PASA |
| a3 | El restaurante vuelve a Abierto | `200`, `isOpen: true` | PASA |

- El script canceló las reservas que creó y dejó Casa 72 Abierto.

### M2 y M3 · Concurrencia

| Corrida | Caso | Parámetros | Resultado | Veredicto |
|---|---|---|---|---|
| 1 | M2 | 2 solicitudes simultáneas (`QA_DINERS=2`), `PARTY_SIZE=6`, `EXPECTED_TABLES=1` | 1 × `201` (Mesa 7); 1 × `409 NO_TABLE_AVAILABLE` | **PASA** |
| 2 | M3 | 5 solicitudes simultáneas (`QA_DINERS=5`), `PARTY_SIZE=6`, `EXPECTED_TABLES=1` | 1 × `201` (Mesa 7); 4 × `409 NO_TABLE_AVAILABLE` | **PASA** |
| 3 | M3, variante de 3 mesas | 5 solicitudes simultáneas (`QA_DINERS=5`), `PARTY_SIZE=2`, `EXPECTED_TABLES=3` | 3 × `201`, cada una en una mesa distinta (Mesa 1, Mesa 4 y Mesa 7); 2 × `409 NO_TABLE_AVAILABLE` | **PASA** |

- Ninguna corrida tuvo respuestas distintas de `201` y `409 NO_TABLE_AVAILABLE`.

### M8 · Efectos del check-in

| Comprobación | Esperado | Resultado | Fuente |
|---|---|---|---|
| Estado de la reserva | `completed` | `completed` | §12.1, §12.3 |
| Estado de la mesa | `reserved` → `occupied` | `occupied` | §12.3 |
| Bitácora de la mesa | `reserved` → `occupied`, `source: reservation`, con el correo del `restaurant_admin` | `reserved` → `occupied`, `source: reservation`, con el correo del admin | §12.3 |
| Registro único en `check_ins` (evento facturable) | Una sola fila por reserva (`UQ_check_ins_reservation_id`) | **Por confirmar:** la comprobación de duplicados la hace Jacobo | §12.6 |

- **Veredicto de M8:** pendiente de la fila de `check_ins`; las otras tres comprobaciones pasaron.

### M9 · Check-in con códigos válidos e inválidos

**Parámetros:** `CONFIRM=1`, `INCLUDE_EXPIRED=1`, `RESERVATION_TTL_MINUTES=3`.

| Filas | Resultado | Veredicto |
|---|---|---|
| 19 (las 14 filas de M9; la 11 con 4 formatos, y la 12 y la 14 con 2 variantes cada una) | 19 PASA · 0 FALLA · 0 OMITIDA | **PASA** |

- Incluye la fila 7 (código vencido), que corrió esperando la vigencia de 3 minutos.

### T1 · Roles por HTTP (filas 1 a 6)

| Filas | Qué cubren | Resultado | Veredicto |
|---|---|---|---|
| 15 | 1 y 2a–2d: el restaurante en las rutas de comensal → `403 RESTAURANT_ACCOUNT`, y la reserva no cambia · 3a, 3b y 4: el comensal en las rutas de restaurante → `403 DINER_ACCOUNT`, y su check-in no cambia la reserva · 5a–5d: sin token y con token falso, una ruta de cada rol → `401` sin `errorCode` · 6a–6c: otro comensal ve y cancela la reserva → `404 RESERVATION_NOT_FOUND`, y la reserva sigue activa | 15 PASA · 0 FALLA | **PASA** |

### T1 · WebSocket (filas 7 a 13)

| Filas | Qué cubren | Resultado |
|---|---|---|
| 10, 11a, 11b, 12 | `qaadmin` → `connect_error RESTAURANT_REQUIRED`; sin token y token falso → `UNAUTHORIZED`; `qa26` → `PROFILE_REQUIRED` | PASA |
| 7a, 7b, 8a | `qa21`, `qa22` y el admin de Casa 72 se conectan | PASA |
| 7c, 7d | `qa21` recibe `availability.changed`, pero no `reservation.created` ni `table.status_changed` | PASA |
| 8b, 8c, 8d | Casa 72 recibe `reservation.created` (sin código) y `table.status_changed`, pero no `availability.changed` | PASA |
| 9a, 9b, 9c | Casa 72 no recibe eventos de B; un comensal no recibe las reservas del otro; control: `qa22` sí recibe su `reservation.cancelled` | PASA |
| 13a, 13b, 13c | `reservation.checked_in` llega a `qa21` y a Casa 72 con `{ reservationId, status: completed, tableId, at }`; ningún evento trae el código | PASA |

- **Total:** 18 PASA · 0 FALLA. El script dejó la mesa en Disponible después del check-in y canceló la reserva de B.

### Observaciones

- **`dinerName` llega `null` en `reservation.created`** (y por eso la web mostraría «Comensal»). **Por confirmar con Elizabeth** si es lo esperado. Causa probable, según `CLAUDE.md` §11 («Check-in y reservas del restaurante»): los comensales de QA se crearon sin `displayName`, así que `POST /v1/diners/me` guardó la parte del correo antes de `@`, y la regla de privacidad devuelve `null` cuando el nombre es igual a esa parte. Con un nombre real debería llegar el nombre.
- **Render sigue pendiente para el Día 5:** todo lo anterior es local. `AVISOS.md` pide además la concurrencia de M2 y M3 por HTTP en Render.
- **Sin probar todavía:** las filas de M2 y M3 que miran la web, la bitácora y la limpieza, y las filas 7 (desempate por identificador) y 8 (mesa Reservada a mano) de M3.

## Antes de ejecutar

- **Restaurante de pruebas:** **Por confirmar** cuál (Casa 72 es el de la demo y solo Elizabeth corre `demo:reset`). Debe estar abierto ahora, y su admin debe tener cuenta de Firebase. Para M9 (paso 9) y T1 (paso 9) hace falta un segundo restaurante con su admin (por ejemplo Casa16). Anota el `RESTAURANT_ID` y el número exacto de mesas activas y Disponibles con capacidad ≥ `PARTY_SIZE` (`EXPECTED_TABLES`) justo antes de cada corrida.
- **Render escribe en Neon, la base real:** avisa en el grupo antes y después. Las reservas, los cambios de mesa y la bitácora quedan registrados. Corre con `CLEANUP=1` y deja las mesas como estaban.
- **5 comensales verificados:** la cuenta `dinnoteam2026+comensal@gmail.com` y 4 alias nuevos `dinnoteam2026+<algo>@gmail.com` (§10), cada uno con el correo verificado y el perfil creado (`POST /v1/diners/me`, que la app hace sola al entrar). Ninguno con una reserva activa al empezar.
- **Tokens:** cómo obtener el token de Firebase de cada cuenta es **Por confirmar**. Un token de Firebase dura una hora: sácalos justo antes de correr. Se escriben sin eco y sin dejarlos en el historial (zsh):

  ```zsh
  for i in 1 2 3 4 5; do read -rs "TOKEN_$i?Token del comensal $i: "; echo; export TOKEN_$i; done
  BASE_URL=https://dinno-backend.onrender.com ALLOW_HOST=dinno-backend.onrender.com \
  RESTAURANT_ID=<uuid> PARTY_SIZE=2 EXPECTED_TABLES=1 \
  node scripts/qa/concurrencia.mjs                       # ensayo
  # Revisa el ensayo y repite con CONFIRM=1 CLEANUP=1 delante para enviarlo.
  unset TOKEN_1 TOKEN_2 TOKEN_3 TOKEN_4 TOKEN_5          # al terminar, siempre
  ```

  En bash: `read -rs -p "Token del comensal $i: " "TOKEN_$i"`.
- **En local**, el backend tiene que correr con `DEV_USER_ENABLED=false`: con el usuario de desarrollo ignora los tokens, y todas las solicitudes serían del mismo usuario (`AVISOS.md`, «Historial»). En local la base también es Neon.

## Por confirmar

1. Definición de **M1** y **M8** (plan del sprint §9, no está en el repo).
2. Las «tablas 3.1 a 3.5» no están en `CLAUDE.md` §12; probablemente son del plan del sprint.
3. Que **M2** sea exactamente «una sola mesa, varios comensales».
4. Qué restaurante se usa para las pruebas.
5. Cómo se obtiene el token de Firebase de cada cuenta.
6. El valor actual de `RESERVATION_TTL_MINUTES` en Render, para el caso «vencido» de M9.
7. Una herramienta para escuchar los eventos de reserva del socket (T1, filas 8, 9 y 13).
8. Si el caso de desempate de M3 exige el orden numérico (§11) o solo «identificador menor» (§12.1).
9. Los `400` de M9 (filas 13 y 14) salen de `CLAUDE.md` §11, no del §12.
10. La evidencia de la fila en `check_ins` (evento facturable, §12.6): no hay ruta que la muestre. Hace falta que Elizabeth la confirme (por ejemplo con `export:data`).
