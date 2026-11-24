# QA · Cancelación de reserva (M5 y M6)

Azure 3.1.5 "Probar cancelación de reserva" (Sprint 3). Prueba contra la API real las 8 variantes de
`DiNNo_Sprint3_Reparto.md` §12 / `CLAUDE.md` §12: M5 (cancelar) y M6 (mesa liberada). No prueba nada
visual (app ni web) — eso se prueba a mano.

Node con `fetch`, sin dependencias nuevas. Mismo estilo que `scripts/listen-availability.mjs`.

**El restaurante sale siempre de `DINNO_RESTAURANT_ID`.** El script no asume Casa 72 ni ningún otro
en particular (ni nombre, ni cantidad de mesas, ni umbrales): el cálculo de M6.2 y el forzado de
`--force-threshold` se hacen con las mesas reales que devuelve la API para ese restaurante. Al
arrancar, además, confirma que la cuenta admin (`DINNO_DEV_ADMIN_ID` / `DINNO_ADMIN_TOKEN`) es
dueña de ese mismo `DINNO_RESTAURANT_ID` — si no coinciden, se detiene sin tocar nada.

**Decisión del equipo:** la primera corrida real se hace contra **Casa 72** (el restaurante de la
demo). Ver "Cuándo correrlo" más abajo.

## Qué revisa

| ID | Variante | Esperado |
|---|---|---|
| M5.1 | Cancelar una reserva activa propia | 200, `status: "cancelled"`, con `cancelledAt` |
| M5.2 | Cancelar dos veces la misma | La segunda: 409 `RESERVATION_NOT_ACTIVE` |
| M5.3 | Cancelar una reserva vencida | 409 `RESERVATION_NOT_ACTIVE`; `GET /reservations/:id` la devuelve `"expired"` |
| M5.4 | Comensal B cancela la reserva de A | 404 `RESERVATION_NOT_FOUND`; la reserva de A sigue activa |
| M6.1 | Mesa liberada | La mesa asignada pasa de `reserved` a `available` |
| M6.2 | Disponibilidad pública | El nivel de `GET /restaurants/:id/public` refleja la mesa liberada |
| M6.3 | Bitácora | El cambio de la mesa queda en `table_logs` con `source: "reservation"` |
| M6.4 | Cancelar con el restaurante cerrado | Cancela igual, la mesa vuelve a `available`, el restaurante sigue sin aparecer en la búsqueda |

M5.1, M6.1, M6.2 y M6.3 comparten una sola reserva (se crea y se cancela una vez; M6.* revisa los
efectos de esa cancelación). Las demás son independientes.

## Local y Render escriben en la misma base

**Local no es una base aparte.** El backend local usa `DATABASE_URL` de Neon — la misma base que
Render (confirmado en el `README.md` y `.env.example` del backend; no hay Docker ni Postgres local
en este repo). Por eso:

- El script pide **la misma confirmación explícita** (`--confirm-shared-db`) sin importar el
  ambiente: sin ella no crea nada, ni en local ni en Render.
- El forzado de umbral de M6.2 (ocupar otras mesas) es **opcional en los dos modos**, solo con
  `--force-threshold`. Por defecto, en local y en Render, M6.2 solo reporta el nivel de
  disponibilidad antes y después, sin tocar otras mesas.

## Credenciales

**El script nunca escribe ni imprime credenciales.** Las lee de variables de entorno al correr.

**Local** (`DEV_USER_ENABLED=true` en el backend): cabecera `x-dev-user-id`, así que necesitas el
**UUID** de cada usuario (no hace falta contraseña):

| Variable | Quién |
|---|---|
| `DINNO_DEV_ADMIN_ID` | dueño del restaurante de prueba (`restaurant_admin`) |
| `DINNO_DEV_DINER_A_ID` | comensal de prueba |
| `DINNO_DEV_DINER_B_ID` | *(opcional)* un segundo comensal; sin esto, M5.4 queda "Omitida" y no cuenta como falla — hoy el seed solo trae uno |

**No hay un UUID fijo en el código:** `users` y `restaurants` usan `gen_random_uuid()` de Postgres,
no una constante. El seed (`src/seed-data/run-seed.ts`) busca por **correo**, nunca por id, y solo
lo corre Elizabeth contra Neon — no lo corras tú para "sacar" un id. Para conseguirlos, pide en el
chat del equipo el `id` de `dinnoteam2026+casa72@gmail.com` (admin) y el de `comensal@example.com`
(diner A), como ya se hace con `DEV_USER_ID` (`AVISOS.md`). El id del restaurante
(`DINNO_RESTAURANT_ID`) también se puede leer con `GET /v1/restaurants/me` una vez autenticado como
el admin.

**Render**: token de Firebase (`Authorization: Bearer`) de cada cuenta:

| Variable | Quién |
|---|---|
| `DINNO_ADMIN_TOKEN` | `dinnoteam2026+casa72@gmail.com` |
| `DINNO_DINER_A_TOKEN` | `dinnoteam2026+comensal@gmail.com` |
| `DINNO_DINER_B_TOKEN` | *(opcional)* una segunda cuenta de comensal de prueba; sin esto, M5.4 queda "Omitida". Si la cuenta nunca inició sesión, el script llama `POST /diners/me` para crear su perfil (igual que el primer login real) — no inserta nada a mano en la base |

**Cómo conseguir un token de Firebase:** no hay ninguna ruta ni script en el repo que lo entregue
(revisado `README.md`, `AVISOS.md` y `scripts/listen-availability.mjs`: los tres asumen que ya lo
tienes). La forma más simple es iniciar sesión una vez en la web del frontend y copiarlo de las
DevTools del navegador — **funciona igual para la cuenta del restaurante y para una cuenta de
comensal** (ver abajo por qué). Dura **una hora**; pasado ese tiempo hay que repetir el login y
volver a copiarlo.

1. Abre la web (`http://localhost:5173` en local o la URL de Vercel) y entra con la cuenta de
   prueba (correo y clave).
2. Abre las DevTools (F12) → pestaña **Network** (Red) → filtra por **Fetch/XHR**.
3. Busca cualquier petición al backend (por ejemplo a `/v1/me`) y ábrela → pestaña **Headers** →
   **Request Headers** → copia el valor de `Authorization` sin el prefijo `Bearer `.
4. Ese valor es el token. Pégalo como `DINNO_ADMIN_TOKEN` / `DINNO_DINER_A_TOKEN` /
   `DINNO_DINER_B_TOKEN` (como variable de entorno, nunca en un archivo).

**Con una cuenta de comensal:** revisé `AuthProvider.tsx` y `WrongAccountScreen.tsx` del frontend.
Desde el Sprint 2 la web rechaza a los comensales con la pantalla "Cierra sesión para continuar.",
pero **ese cierre de sesión es manual** (un botón "Cerrar sesión" que el usuario tiene que pulsar) —
`DINER_ACCOUNT_EVENT` solo cambia qué pantalla se muestra, nunca llama a `signOut()`. El login de
Firebase sí se completó antes de que el backend rechazara la petición (el error 403 `DINER_ACCOUNT`
llega con el token ya puesto en el `Authorization` de esa misma petición, en `api-client.ts`), así
que **el token de un comensal se puede copiar de las DevTools con los mismos pasos de arriba**,
aunque la pantalla diga "cuenta equivocada". Solo hay que copiarlo **antes** de pulsar "Cerrar
sesión" (que si se pulsa por accidente, basta con iniciar sesión de nuevo para generar otro).

**Recomendación:** como el backend local también usa Neon (ver arriba), el **modo local con usuario
de desarrollo es la forma recomendada de correr todas las variantes** — no necesita tokens ni
depende de que ninguna sesión de Firebase siga vigente a mitad de la corrida. El **modo Render sirve
para confirmar que el código ya desplegado se comporta igual**, no como la forma principal de
probar.

**Siempre:**

| Variable | Qué es |
|---|---|
| `DINNO_BASE_URL` | `http://localhost:3000` (local, por defecto) o `https://dinno-backend.onrender.com` |
| `DINNO_RESTAURANT_ID` | id del restaurante de prueba. Nunca hardcodeado: así Neon (compartida) no se toca por accidente |
| `DINNO_RESERVATION_TTL_MINUTES` | *(opcional)* para M5.3; si falta, el script usa `reservationTtlMinutes` del detalle público del restaurante |

## Uso

### Bash / Git Bash

```bash
# Local — arranca el backend con RESERVATION_TTL_MINUTES=2 para que M5.3 no tarde:
RESERVATION_TTL_MINUTES=2 npm run start:dev

# en otra terminal (local también escribe en Neon: pide confirmación igual):
DINNO_RESTAURANT_ID=<uuid> \
DINNO_DEV_ADMIN_ID=<uuid> \
DINNO_DEV_DINER_A_ID=<uuid> \
node scripts/qa-cancel-reservation.mjs --confirm-shared-db

# Render:
DINNO_BASE_URL=https://dinno-backend.onrender.com \
DINNO_RESTAURANT_ID=<uuid> \
DINNO_ADMIN_TOKEN=<token> \
DINNO_DINER_A_TOKEN=<token> \
node scripts/qa-cancel-reservation.mjs --confirm-shared-db

# una sola variante:
node scripts/qa-cancel-reservation.mjs --confirm-shared-db --only M5.2
```

### PowerShell (Windows)

En PowerShell las variables de entorno no se anteponen al comando como en bash: se fijan con
`$env:NOMBRE = "valor"` en líneas separadas antes de correr el script.

```powershell
# Local — arranca el backend con RESERVATION_TTL_MINUTES=2 para que M5.3 no tarde:
$env:RESERVATION_TTL_MINUTES = "2"
npm run start:dev

# en otra terminal (local también escribe en Neon: pide confirmación igual):
$env:DINNO_RESTAURANT_ID = "<uuid>"
$env:DINNO_DEV_ADMIN_ID = "<uuid>"
$env:DINNO_DEV_DINER_A_ID = "<uuid>"
node scripts/qa-cancel-reservation.mjs --confirm-shared-db

# Render:
$env:DINNO_BASE_URL = "https://dinno-backend.onrender.com"
$env:DINNO_RESTAURANT_ID = "<uuid>"
$env:DINNO_ADMIN_TOKEN = "<token>"
$env:DINNO_DINER_A_TOKEN = "<token>"
node scripts/qa-cancel-reservation.mjs --confirm-shared-db

# una sola variante:
node scripts/qa-cancel-reservation.mjs --confirm-shared-db --only M5.2
```

Las variables quedan fijadas solo en esa ventana de PowerShell (no persisten al cerrarla), así
que un token nunca queda guardado en el perfil ni en el sistema.

### Banderas

- `--confirm-shared-db`: **obligatoria siempre**, en local y en Render — los dos escriben en Neon.
  Sin ella el script no crea nada.
- `--include-expired`: corre M5.3 en Render (sin ella queda "Omitida": depende del TTL configurado
  allí). En local M5.3 siempre corre.
- `--force-threshold`: antes de M6.2, ocupa (vía la API) las demás mesas libres y activas del
  restaurante para forzar que el nivel de disponibilidad cruce de umbral, y las devuelve a
  `available` al terminar. **Opcional en los dos modos** — por defecto M6.2 solo reporta el nivel
  antes/después sin tocar otras mesas. Pide explícitamente esta bandera antes de usarla contra
  Casa 72 si hay riesgo de pisar una demo o prueba de otra persona al mismo tiempo.
- `--only <ID>`: corre una sola variante (por ejemplo `M5.2`); M6.1/M6.2/M6.3 igual necesitan crear
  y cancelar su propia reserva primero.
- `--url <url>`: alternativa a `DINNO_BASE_URL`.

## Limpieza

Todo lo que el script crea o cambia queda revertido al terminar, **incluso si una prueba falla**:
cancela cualquier reserva que haya quedado activa (de A o de B), revierte las mesas que ocupó con
`--force-threshold` y reabre el restaurante si lo cerró (M6.4), cada una en su propio
`try/finally`. También hace una limpieza de seguridad al inicio y al final, por si quedó algo de
una corrida anterior.

**Resumen de limpieza al final de cada corrida:** antes de salir, el script imprime cada reserva
que creó con su estado final, cada mesa que tocó directamente (solo con `--force-threshold`) con su
estado antes y después, y si el restaurante quedó abierto/cerrado igual que al empezar. Si algo no
volvió exactamente a su sitio, lo marca con `⚠` y lo dice explícitamente — en ese caso, revisa el
restaurante a mano y, si hace falta, pídele a Elizabeth que corra `demo:reset`.

## Salida

Tabla `ID · Variante · Pasa/Falla/Omitida · Detalle`, con los mismos IDs de la matriz de Santiago,
seguida del resumen de limpieza. Exit code `1` si algún `Falla` (una variante `Omitida` no cuenta
como falla), `0` si todo pasó o se omitió.

## Cuándo correrlo (Casa 72 es la demo)

Antes de correr el script, avisa en el grupo del equipo. No lo corras durante la prueba completa
del Día 6 ni el día de la demo. Al terminar, revisa el resumen de limpieza (sección anterior); si
algo quedó mal, avísale a Elizabeth para que corra `demo:reset`.

## Qué no hace

- No prueba nada visual: la app y la web se prueban a mano.
- No corre migraciones, seeds ni SQL directo contra Neon.
- No crea usuarios nuevos: en local reutiliza los que ya existen (`DEV_USER_ID` de cada actor); en
  Render crea el perfil de un comensal nuevo solo a través de `POST /diners/me` (la misma ruta que
  usa la app en el primer login), nunca con una escritura directa a la base.
