# Plan de migración a Azure: de Render + Neon + Upstash a Azure

**Sprint 3 · PBI 7.1 · Tarea 7.1.5** · Autor: Jacobo · 8 nov 2026
**Alcance:** solo el plan. **No se creó ningún recurso, no se corrió ningún comando contra Neon, Upstash, Render ni Azure y no cambia código.**
**Fuentes:** `CLAUDE.md` (§10, §11 «Migración a Azure», §12), `AVISOS.md`, [`docs/azure-revision-servicios.md`](azure-revision-servicios.md) (los datos de Azure), `package.json`, `.env.example`, `src/data-source.ts`, `src/migrations/` y el código citado en cada sección.
**Regla del documento:** lo que no está en el repo ni en la revisión de servicios está marcado **«Por confirmar»**.

> **Neon es la base real y compartida** (desarrollo y producción son la misma). **Ningún paso que lea o escriba en Neon se corre sin la aprobación de Elizabeth**, que es además la única que corre migraciones y seed (`CLAUDE.md` §11, «Migraciones»).

---

## 1. Estado actual y estado objetivo

| Pieza | Hoy | Objetivo en Azure | Fuente |
|---|---|---|---|
| Backend (NestJS, Node 24) | Render, despliegue automático en cada push a `develop`; una sola instancia | Azure Container Apps, **una réplica** | `CLAUDE.md` §11 «Despliegue»; revisión §3 y §4 |
| Base de datos | PostgreSQL en Neon (plan gratuito, se duerme), compartida | Azure Database for PostgreSQL Flexible Server, Burstable **B1ms**, sin alta disponibilidad, copias 7 días | revisión §1 y §4 |
| Redis | Upstash; el backend se conecta al arrancar (`REDIS_URL` obligatoria) pero **no envía ningún comando**: solo `app.module.ts` usa `REDIS_CLIENT` | **Azure Managed Redis**, Balanced 0,5 GB (Azure Cache for Redis se está retirando) | `src/app.module.ts:74-79`; revisión §2 |
| Tiempo real | Socket.IO en el mismo host del backend, salas en la memoria del proceso | Igual, con una réplica. El adaptador de Redis queda para el Sprint 4 | `CLAUDE.md` §11 «Tiempo real»; §12.7 |
| Web (React) | Vercel, desde `main` | **Se queda en Vercel**; solo cambia la URL del backend que usa | `CLAUDE.md` §1 |
| App (Expo) | Expo / EAS | Se queda; solo cambia la URL del backend | `CLAUDE.md` §1 |
| Autenticación | Firebase Authentication | Sin cambios (el backend solo valida tokens con `FIREBASE_PROJECT_ID`) | `CLAUDE.md` §8 y §10 |
| Geocodificación | Google Geocoding con llave sin restricción de IP («Render no tiene IP fija») | Sin cambios: la misma llave funciona desde Azure | `AVISOS.md`, «Equipo de Google Cloud» |
| CI | GitHub Actions: `checks` y `verify-deployment` (espera a que Render sirva el commit del push) | `checks` igual; `verify-deployment` apunta a Azure | `.github/workflows/ci-cd.yml` |

**Requisito previo:** la cuenta de Azure del equipo está pendiente (Microsoft no dio elegibilidad para la cuenta gratuita; ver `AVISOS.md`, entrada del 8 nov). Nada de este plan empieza sin esa cuenta.

---

## 2. Orden de migración

| Paso | Qué | Por qué en este orden |
|---|---|---|
| 0 | Preparación: cuenta de Azure, resolver los «Por confirmar» de la sección 8, decidir lo de la sección 9 | La revisión de servicios pide resolverlos **antes de crear nada** (por ejemplo, el modo de red de PostgreSQL y la redundancia geográfica solo se eligen al crear el servidor) |
| 1 | **PostgreSQL** en Azure, con una **copia de ensayo** de Neon | Es lo único con datos. Es lo más lento de preparar y probar, y el backend no arranca sin `DATABASE_URL`. Ensayar la copia antes de tocar nada más deja ver cuánto tarda y qué falla |
| 2 | **Redis** (Azure Managed Redis) | El backend no arranca sin `REDIS_URL` (`getOrThrow`), pero hoy no usa Redis para nada: es el paso de menos riesgo y debe existir antes de levantar el backend en Azure |
| 3 | **Backend** en Container Apps, apuntando al PostgreSQL y al Redis de Azure | Necesita los dos anteriores. Se prueba completo contra la copia de ensayo **sin cambiar el tráfico real** (Render sigue atendiendo) |
| 4 | **Corte**: copia final de Neon, cambio de la URL en web, app y CI | Solo cuando los pasos 1 a 3 pasaron todas las pruebas de la sección 6 |
| 5 | Observación con Render vivo como respaldo; después, apagar Render, Neon y Upstash | Ver sección 7 |

---

## 3. Esquema y datos: de Neon a Azure (documentado, **no se ejecuta ahora**)

### 3.1 Qué hay en la base

- **10 migraciones**, en este orden (`src/migrations/`):
  1. `1791092320241-CreateInitialTables`
  2. `1791250327133-AddRestaurantProfile`
  3. `1791268910540-AddFirebaseUidToUsers`
  4. `1791340136261-CreateTableLogs`
  5. `1791342586330-AddRestaurantIsOpen`
  6. `1792087341885-AddDinerRoleAndRestaurantLocation`
  7. `1793084146913-AddTablePlan`
  8. `1793840000001-CreateReservations`
  9. `1793840000002-CreateCheckIns`
  10. `1793840000003-AddTableLogSource`
- Las migraciones aplicadas se registran en la tabla de TypeORM; `data-source.ts` no cambia su nombre, así que es la de por defecto. **Por confirmar** el nombre exacto en Neon antes de la copia.
- **Extensiones:** ninguna instalada por la app (`installExtensions: false`); los ids usan `gen_random_uuid()`, nativa desde PostgreSQL 13 (`docs/database.md`). Por eso el servidor de Azure debe ser **PostgreSQL 13 o más nuevo**. **Por confirmar:** la versión de PostgreSQL de Neon (Azure debe ser igual o mayor) y que Neon no tenga extensiones propias en la base.
- Hay un **índice escrito a mano** (`UQ_tables_restaurant_id_identifier`, sobre una expresión) y **índices únicos parciales** de reservas (`UQ_reservations_active_*`). Una copia con `pg_dump` los conserva; **no se recrea el esquema con `migration:generate`** ni con `synchronize`.

### 3.2 Método recomendado: `pg_dump` + `pg_restore` (esquema y datos juntos)

Se copia todo, incluida la tabla de migraciones, así Azure queda en el mismo punto que Neon y no hace falta correr `migration:run` sobre una base vacía.

Pasos (las cadenas de conexión **nunca** se escriben en el repo, en un commit ni en el chat; se pasan desde un archivo local ignorado por git o se escriben en la terminal):

1. **Aprobación de Elizabeth** para leer Neon. Avisar en el grupo.
2. **Ensayo (copia de prueba):** desde el equipo de quien lo corra, con una versión de `pg_dump` **igual o mayor** que la del servidor de Neon:
   - `pg_dump --format=custom --no-owner --no-privileges --file=dinno.dump "<URL de Neon>"`
   - `--no-owner` y `--no-privileges` porque los roles de Neon no existen en Azure.
   - El archivo `.dump` tiene datos personales (correos de usuarios): **no se sube al repo** y se borra al terminar.
3. **Restauración en Azure** (base vacía, recién creada):
   - `pg_restore --no-owner --no-privileges --dbname="<URL de Azure>" dinno.dump`
4. **Verificación de la copia** (solo lectura, en las dos bases):
   - `npm run build` y luego `node --env-file=<archivo local con la URL de Azure> node_modules/typeorm/cli.js migration:show -d dist/data-source.js` → las 10 migraciones con `[X]`. **Ojo:** los scripts `migration:*` de `package.json` cargan `.env` (que apunta a Neon), por eso se llama al CLI directo con otro archivo, igual que con `.env.test` en `CLAUDE.md` §11 «Scripts de datos».
   - Contar filas por tabla en Neon y en Azure (`users`, `restaurants`, `restaurant_schedules`, `tables`, `table_logs`, `reservations`, `check_ins`) y comparar.
5. **Copia final (en el corte, sección 7):** se repiten los pasos 2 a 4 con Render **sin escribir** en Neon durante la ventana, sobre una base de Azure vacía (se borra la de ensayo y se crea de nuevo, o se restaura con `--clean`). **Por confirmar:** cómo se detienen las escrituras en Render durante la ventana (suspender el servicio desde el panel u otra forma).

**Alternativa:** volcar solo datos (`--data-only`) y crear el esquema con `migration:run` sobre la base vacía. **No se recomienda:** `migration:run` y el orden de las llaves foráneas al cargar datos agregan pasos que pueden fallar, y el resultado debería ser el mismo.

### 3.3 Después de restaurar

- `DATABASE_URL` de Azure **debe llevar `sslmode=require`**: el código solo activa TLS si la URL lo trae (`src/app.module.ts:49-51`, `src/data-source.ts:18-20`), y Azure exige conexión cifrada (revisión §1). Sin eso, la conexión falla.
- El backend espera hasta 10 s para conectarse (`connectTimeoutMS`, `src/app.module.ts:55`), pensado para Neon que se duerme. En Azure no hace falta cambiarlo.
- `.env.test` y la base de pruebas (rama de Neon) quedan fuera de esta migración. **Por confirmar** si se mueven después.

---

## 4. Dependencias de Render: qué cambia

| # | Dependencia | Dónde está | Qué hay que cambiar | Riesgo si no se hace |
|---|---|---|---|---|
| 1 | **Detección del ambiente desplegado** | `src/modules/identity-access/auth/deployed-environment.ts:6-10` (`RENDER` en la línea 8, `NODE_ENV === 'production'` en la 9). La usan `deployment-safety.ts:8`, `app.setup.ts:20-22` (`resolveListenHost`) y `current-user/dev-user.resolver.ts:44` | **Sin cambio de código:** definir `NODE_ENV=production` en el Container App. Opcional: actualizar los textos que nombran Render (comentario de `deployed-environment.ts:3`, mensaje de error de `deployment-safety.ts:22`, comentario de `app.setup.ts:17`) | **Alto.** Sin `NODE_ENV=production`, Azure no define `RENDER`, así que: (a) la API escucha en `127.0.0.1` y el contenedor no recibe tráfico; (b) `DEV_USER_ENABLED` y `FIREBASE_AUTH_EMULATOR_HOST` dejan de bloquearse al arrancar, y con el usuario de desarrollo la API no pide credenciales |
| 2 | **Commit desplegado en `GET /v1/health`** | `src/app.service.ts:16` lee solo `RENDER_GIT_COMMIT`. El CI lo compara en `.github/workflows/ci-cd.yml:83-130`; la URL de Render está fija en `ci-cd.yml:66` (`SERVICE_URL`) | Dos opciones, **sin decidir**: (a) que el pipeline de Azure defina `RENDER_GIT_COMMIT` con el SHA (sin tocar código, pero el nombre engaña); (b) que `app.service.ts` lea una variable neutra (nombre **por decidir**) y, si no existe, `RENDER_GIT_COMMIT`. En los dos casos: cambiar `SERVICE_URL` y los mensajes que nombran Render en `ci-cd.yml`. **Por confirmar** cómo se despliega en Container Apps desde GitHub (Render despliega solo; Azure necesita un pipeline que construya la imagen y la publique) | **Medio.** `commit` llega en `null` y el job `verify-deployment` nunca termina bien (`CLAUDE.md` §11). No rompe la app, pero se pierde la comprobación de qué versión está en producción |
| 3 | **WebSocket de una sola instancia** | `src/modules/search-availability/realtime/availability.gateway.ts:32` (`@WebSocketGateway()`), `:46` (handshake), `:58` (`handleConnection`); salas en `realtime-rooms.ts:12` (`roomsFor`, «viven en la memoria del proceso»); CORS del socket en `src/config/socket-io.adapter.ts:8`, registrado en `app.setup.ts:82` | **Sin cambio de código:** mínimo y máximo de réplicas en **1**. El adaptador de Redis y la afinidad de sesión quedan para el Sprint 4. **Por confirmar** que el ingress de Container Apps acepta WebSockets y cómo se configura (`CLAUDE.md` §11 habla de activar «Web sockets» en App Service, no en Container Apps) | **Alto si hay más de una réplica:** cada réplica tiene sus propias salas, así que un cambio hecho en una no llega a los clientes conectados a la otra (reservas, check-in, disponibilidad). **Por confirmar** si un cambio de revisión deja dos réplicas a la vez por un momento |

**Otras dependencias menores (no son de Render, pero se revisan):**

| Qué | Dónde | Nota |
|---|---|---|
| Puerto | `src/main.ts:12-15` lee `PORT` (3000 por defecto) | **Por confirmar** si se define `PORT` o se configura el puerto de destino del ingress en 3000 |
| Cierre ordenado | `main.ts:9` (`enableShutdownHooks`), `app.module.ts:97-99` (cierra Redis), `reservation-expiry.scheduler.ts` (`beforeApplicationShutdown`) | Funciona con `SIGTERM`. **Por confirmar** el tiempo de gracia que da Container Apps antes de matar el proceso |
| Proceso de vencimiento | `reservation-expiry.scheduler.ts:38` (`setInterval`, 15 s) | Seguro con varias instancias (`FOR UPDATE SKIP LOCKED`, `CLAUDE.md` §11 «Reservas»). Con escala a cero no corre mientras no hay réplicas; al arrancar hace el barrido inicial, y las lecturas vencen igual (§12.5) |
| Cliente de Redis | `src/config/redis.config.ts:9` (`new Redis(url)`, cliente sin modo clúster) | Azure Managed Redis usa clúster por defecto (revisión §2). Como el backend no envía comandos, hoy no afecta. **Por confirmar** el formato de `REDIS_URL` (TLS, puerto) y el modo clúster antes del Sprint 4 |
| Imagen del contenedor | No hay `Dockerfile` en el repo | **Por confirmar** cómo se construye la imagen (Node 24, `npm ci`, `npm run build`, `node dist/main`, que es `start:prod`). Crear ese archivo es un cambio de código y va en su propio PR |

---

## 5. Variables de entorno en Azure

Solo nombres y para qué sirven. **Los valores nunca van en el repo:** los secretos van como **secretos del Container App**, y las demás como variables del Container App. La lista sale de `.env.example` y de `CLAUDE.md` §11.

| Variable | ¿Secreto? | Para qué | En Azure |
|---|---|---|---|
| `DATABASE_URL` | **Sí** | Conexión a PostgreSQL (obligatoria) | URL del Flexible Server, con `sslmode=require` |
| `REDIS_URL` | **Sí** | Conexión a Redis (obligatoria aunque hoy no se use) | URL de Azure Managed Redis (formato **por confirmar**) |
| `GOOGLE_GEOCODING_API_KEY` | **Sí** | `GET /v1/geocode`. Opcional: sin ella responde `503` | La misma de Render |
| `FIREBASE_PROJECT_ID` | No | Verificar tokens de Firebase (obligatoria sin usuario de desarrollo) | El mismo de Render |
| `CORS_ORIGINS` | No | Orígenes permitidos para la API y el socket. **Nunca `*`** | La URL de Vercel y `http://localhost:5173`, igual que en Render |
| `NODE_ENV` | No | Marca el ambiente como desplegado (sección 4, fila 1) | **`production`, obligatoria** |
| `RESERVATION_TTL_MINUTES` | No | Vigencia de la microreserva: entero de 2 a 15; sin definir, 15. Un valor inválido impide arrancar | `15`; `3` solo durante la demo de expiración |
| `RESERVATION_EXPIRY_ENABLED` | No | Proceso de vencimiento cada 15 s: `true` o `false`; sin definir, `true`. Otro valor impide arrancar | `true` |
| Commit desplegado | No | `GET /v1/health` → `commit` | `RENDER_GIT_COMMIT` o una variable nueva (sección 4, fila 2; **sin decidir**). La define el pipeline, no se escribe a mano |
| `PORT` | No | Puerto HTTP | **Por confirmar** (sección 4) |

**No se definen en Azure** (igual que en Render): `DEV_USER_ENABLED`, `DEV_USER_ID`, `FIREBASE_AUTH_EMULATOR_HOST` y `RENDER`. Con `NODE_ENV=production`, las dos primeras activas o el emulador definido hacen que la app no arranque.

**Fuera del backend:** la web (Vercel) y la app (Expo) tienen su propia variable con la URL del backend. **Por confirmar** sus nombres en cada repo y si la app necesita una compilación nueva (EAS) para cambiarla.

---

## 6. Pruebas después de cada paso

### Paso 1: PostgreSQL

- [ ] `migration:show` contra Azure: las 10 migraciones con `[X]` (sección 3.2, paso 4).
- [ ] Mismo número de filas por tabla en Neon y en Azure.
- [ ] Existen los índices `UQ_tables_restaurant_id_identifier` y `UQ_reservations_active_*` y los checks (`CHK_*`) de `docs/database.md`.
- [ ] La conexión sin TLS es rechazada y con `sslmode=require` funciona.

### Paso 2: Redis

- [ ] Con `REDIS_URL` de Azure, el backend en local o en el contenedor registra «Redis conectado» y no «Error de conexion a Redis».

### Paso 3: backend en Azure (contra la copia de ensayo)

- [ ] `GET /v1/health` → `200 { "status": "ok", "commit": "<SHA desplegado>" }`; el `commit` no es `null`.
- [ ] El log muestra «PostgreSQL conectado» y «Barrido inicial de reservas terminado: N vencidas».
- [ ] La app **no** arranca si se define `DEV_USER_ENABLED=true` (prueba de que `NODE_ENV=production` funciona); después se quita.
- [ ] `GET /docs` (Swagger) carga.
- [ ] **Inicio de sesión:** con un token real de Firebase de cada cuenta de prueba (`CLAUDE.md` §10), `GET /v1/me` → `200` con el rol correcto; sin token → `401`; comensal en una ruta de restaurante → `403 DINER_ACCOUNT`.
- [ ] **CORS:** la web local (`http://localhost:5173`) llama a la API de Azure sin errores de CORS.
- [ ] **Búsqueda:** `GET /v1/search/zones`, `GET /v1/search/restaurants?zone=calle-72` y el detalle `GET /v1/restaurants/:id/public` dan lo mismo que Render en el mismo minuto (la copia de ensayo no tiene los cambios posteriores a la copia: comparar solo restaurantes que no cambiaron).
- [ ] **Geocodificación:** `GET /v1/geocode?address=…` → `200`.
- [ ] **Reserva:** el comensal crea una reserva en Casa 72 (`POST /v1/reservations` → `201` con `code`, `expiresAt` y `serverTime`), la consulta (`GET /v1/reservations/active`) y la cancela (`POST /v1/reservations/:id/cancel` → `200`); la mesa vuelve a `available` y la bitácora lo registra.
- [ ] **Vencimiento:** con `RESERVATION_TTL_MINUTES=3`, una reserva sin check-in pasa a `expired` sola en ≤ 3 min + 15 s, y la mesa vuelve a `available` con `source: system` en la bitácora. Después, volver a `15`.
- [ ] **Check-in:** el restaurante valida el código (`POST /v1/restaurants/me/check-ins` → `200`); repetirlo → `409 RESERVATION_ALREADY_USED`.
- [ ] **WebSocket:** `node scripts/listen-availability.mjs --url <URL de Azure>` con `DINNO_TOKEN` de un comensal se conecta y recibe `availability.changed` al cambiar una mesa de Casa 72 (como en la prueba del 26 oct en Render, `AVISOS.md`). Con el token de Casa 72 se reciben `reservation.created` y `table.status_changed`. Sin token → `connect_error: UNAUTHORIZED`.
- [ ] La copia de ensayo se descarta antes de la copia final: las reservas de prueba no pasan a producción.

### Paso 4: corte

- [ ] Las mismas comprobaciones del paso 3, ahora con la copia final y desde la web en Vercel y la app.
- [ ] `verify-deployment` del CI en verde contra Azure.
- [ ] La demo completa del sprint (`CLAUDE.md` §12, plan del sprint) funciona de punta a punta.

---

## 7. Render vivo mientras tanto, corte y vuelta atrás

### Mientras se preparan los pasos 1 a 3

- **Render + Neon + Upstash siguen siendo producción.** Nada cambia para la web, la app ni el equipo.
- Azure se prueba con la copia de ensayo, **nunca apuntando a Neon**: dos backends contra la misma base partirían el tiempo real (los clientes de un backend no reciben los eventos del otro, sección 4, fila 3).
- `develop` sigue desplegando en Render. **Por confirmar** si Azure despliega también desde `develop` durante la prueba o desde una rama aparte.

### Corte (cuándo y cómo)

1. **Cuándo:** cuando la sección 6 (pasos 1 a 3) pasó completa, en una ventana acordada con el equipo, **fuera de una demo** y sin reservas activas (una reserva dura máximo 15 min). **Por confirmar** la fecha y quién la ejecuta.
2. Avisar en el grupo. Detener las escrituras en Render (**por confirmar** el método, sección 3.2).
3. Copia final de Neon a Azure, con aprobación de Elizabeth (sección 3.2, paso 5) y verificación.
4. Cambiar la URL del backend en la web (Vercel), en la app y `SERVICE_URL` en el CI. **Por confirmar** si se usa un dominio propio: con él, el corte y la vuelta atrás serían solo un cambio de DNS y la app no necesitaría otra compilación.
5. Pruebas del paso 4 (sección 6).

### Vuelta atrás

- **Render y Neon no se borran** durante la observación. **Por confirmar** cuánto dura (propuesta: hasta cerrar el Sprint 4).
- **Si algo falla antes de abrir el tráfico a Azure:** se reactiva Render y no se pierde nada (Neon no cambió).
- **Si algo falla después:** se vuelve a apuntar la web, la app y el CI a Render. **Riesgo:** lo escrito en Azure después del corte (reservas, check-ins, bitácora, cuentas nuevas de comensal) no está en Neon. Hay que copiarlo de vuelta con el mismo método, con aprobación de Elizabeth, o aceptarlo como pérdida; **sin decidir**. Los `check_ins` son el evento facturable, así que perderlos importa.

---

## 8. Riesgos y «Por confirmar»

### Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Falta `NODE_ENV=production` | La API no recibe tráfico y los interruptores locales no se bloquean | Prueba del paso 3 que comprueba el bloqueo de `DEV_USER_ENABLED` |
| Más de una réplica, o dos revisiones a la vez | Eventos de tiempo real que no llegan a parte de los clientes | Réplicas en 1; adaptador de Redis en el Sprint 4 |
| Dos backends contra la misma base | Tiempo real partido; los dos barridos son seguros, pero los clientes no ven todo | Azure solo con la copia de ensayo hasta el corte |
| `commit` en `null` | `verify-deployment` siempre en rojo | Decidir la fila 2 de la sección 4 antes del corte |
| `DATABASE_URL` sin `sslmode=require` | No conecta | Prueba del paso 1 |
| Escrituras en Neon durante la copia final | Datos perdidos en Azure | Ventana sin escrituras; contar filas antes y después |
| `.dump` con datos personales fuera de control | Fuga de correos | No subirlo a ningún lado; borrarlo al terminar |
| B1ms (Burstable) no es para producción según Microsoft | Rendimiento si crece el uso | Alcanza para el piloto y la demo; subir de nivel si se pasa a producción real (revisión §1) |
| Escala a cero | La primera conexión espera el arranque; el barrido periódico no corre sin réplicas | Decidir según la demo (revisión §3); el vencimiento al leer cubre la corrección |
| URL de la app fija en la compilación | Cortar o volver atrás exige compilar la app de nuevo | Dominio propio (**por confirmar**) |
| `CLAUDE.md` §11 habla de App Service y la revisión de Container Apps | Instrucciones contradictorias para el equipo | Actualizar `CLAUDE.md` §11 cuando se decida (lo hace su responsable) |

### «Por confirmar» de la revisión de servicios (`docs/azure-revision-servicios.md` §5)

- Precio actual de B1ms con almacenamiento, y de Azure Managed Redis Balanced 0,5 GB.
- Si el modo de red de PostgreSQL se puede cambiar después de crear el servidor.
- Guía oficial para conectar Container Apps con PostgreSQL (red, secretos y variables), y si el Container App tiene una IP de salida fija (de eso depende la regla de firewall).
- Qué niveles admiten copias en otra región, y cómo cobra apagar el servidor.
- Pub/Sub y modo clúster en Azure Managed Redis frente al adaptador de Socket.IO.
- Cómo se comporta Socket.IO con la afinidad de sesión de Container Apps.

### «Por confirmar» nuevos de este plan

- Versión de PostgreSQL de Neon (Azure debe ser 13 o más y no menor que Neon) y que Neon no tenga extensiones propias.
- Nombre de la tabla de migraciones en Neon.
- Cómo detener las escrituras en Render durante la copia final.
- Cómo se despliega en Container Apps desde GitHub (pipeline, registro de imágenes) y desde qué rama.
- Cómo se construye la imagen (no hay `Dockerfile`).
- Si el ingress de Container Apps acepta WebSockets y cómo se configura.
- Si un cambio de revisión deja dos réplicas a la vez.
- `PORT` o puerto de destino del ingress.
- Tiempo de gracia de Container Apps al apagar (`SIGTERM`).
- Formato de `REDIS_URL` de Azure Managed Redis (TLS, puerto, clúster).
- Nombres de la variable de la URL del backend en la web y en la app, y si la app necesita una compilación nueva.
- Si la base de pruebas (`.env.test`) se mueve a Azure.
- Quién crea los recursos y ejecuta el corte, y en qué fecha.
- Cuánto tiempo se mantienen Render, Neon y Upstash después del corte.

---

## 9. Lo que NO está decidido

1. **La cuenta de Azure** del equipo (la gratuita no se aprobó; el equipo decide la alternativa).
2. **Cómo se publica el commit** en `GET /v1/health`: reutilizar `RENDER_GIT_COMMIT` o una variable nueva (y su nombre).
3. **Cómo se despliega** en Azure: pipeline, registro de imágenes, rama de origen y si se crea un `Dockerfile`.
4. **Modo de red de PostgreSQL:** acceso privado, IP de salida permitida o la casilla «cualquier servicio de Azure».
5. **Escala a cero** o una réplica siempre encendida.
6. **Si Redis se migra ahora o se queda Upstash** hasta el Sprint 4, ya que el backend todavía no lo usa (este plan sigue el orden pedido: PostgreSQL → Redis → backend).
7. **El adaptador de Redis para Socket.IO** y la afinidad de sesión (Sprint 4), y si funciona con el modo clúster.
8. **Dominio propio** para el backend.
9. **Fecha y responsable del corte**, y cuánto tiempo se mantiene Render como respaldo.
10. **Qué pasa con los datos escritos en Azure** si hay que volver a Render.
11. **Si la base de pruebas** se mueve a Azure.
12. **Región de Azure** para todos los recursos (la revisión cita precios de terceros en East US; no hay decisión).
