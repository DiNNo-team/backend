# CLAUDE.md · DiNNo · backend

> Instrucciones para Claude Code y para el equipo. Las secciones 1 a 10 y 12 son **iguales en los tres repositorios** (backend, frontend, mobile); la sección 11 es propia de este repositorio.
> Si una regla cambia, se cambia en los tres repos en el mismo PR o en PRs del mismo día, y se avisa al equipo.

## 1. Contexto del proyecto

**DiNNo**: plataforma de microreservas de mesas en restaurantes con disponibilidad inmediata. Promesa: *“Dile no a la espera.”*

| Repositorio (org `DiNNo-team`) | Qué es | Stack | Despliegue |
|---|---|---|---|
| `backend` | API (monolito modular) | NestJS 12 + TypeORM + PostgreSQL (Neon) + Redis (Upstash) | Render (desde `develop`) |
| `frontend` | Dashboard web del restaurante | React 19 + Vite 8 + Tailwind CSS v4 | Vercel (desde `main`) |
| `mobile` | App del comensal | Expo SDK 57 + Expo Router + NativeWind v4 (Tailwind v3) | Expo / EAS |

**Equipo y responsables:**

| Persona | Rol en el Sprint 1 |
|---|---|
| Elizabeth | Backend base, backend de mesas y de la edición del restaurante, integración y demo. Revisa los PR de backend |
| Sebastián | Kit visual (`components/ui`), pantallas de mesas. Revisa los PR de web y mobile |
| Santiago | Registro del restaurante (onboarding) |
| Jacobo | Autenticación (login y control de acceso); pantalla del restaurante |
| Sergio | Estado abierto/cerrado del restaurante y bitácora de cambios de mesas |

**Sprint 3 (actual): Microreservas y check-in (contratos en la sección 12). Sprint 2 cerrado: Búsqueda y disponibilidad para el comensal (contratos en la sección 10). Sprint 1 cerrado: Restaurante operativo.** Un restaurante puede iniciar sesión, registrar y editar sus datos, crear y administrar mesas, cambiar su estado, marcarse como abierto o cerrado y ver la bitácora, todo en el ambiente desplegado.

---

## 2. Antes de empezar cualquier tarea

1. **Pregunta qué PBI o tarea de Azure DevOps se está trabajando**, si la persona no lo dijo. No trabajes sin saber el alcance.
2. **Si no tienes en el contexto el manual de identidad v2.0 (`frontend/docs/DiNNo_Manual_Identidad_v2_0.md`) ni el plan del sprint, pídelos** antes de tocar algo visual o algo que dependa de otra persona. No inventes colores, componentes, textos ni flujos.
3. **Confirma qué está dentro y qué está fuera de la tarea.** Si algo parece necesario pero es de otra persona (ver la tabla de responsables), dilo en vez de hacerlo.
4. **Busca si ya existe algo parecido** en el repo (componente, servicio, validación, utilidad) antes de crear algo nuevo.
5. **Verifica que la rama esté actualizada con `develop`** antes de empezar (ver sección 3).

---

## 3. Git y flujo de trabajo

### Reglas que nunca se rompen
- **Nunca hagas commit, push, merge, rebase ni borres ramas sin que la persona lo pida explícitamente.** Propón el comando y espera confirmación.
- **Nunca trabajes ni hagas push directo a `develop` ni a `main`.** `develop` se despliega automáticamente: todo entra por Pull Request revisado.
- **Nunca uses `git push --force`** sobre ramas compartidas, `develop` ni `main`.
- **No hagas commit** de `.env`, `node_modules/`, `dist/`, `.expo/`, archivos del sistema operativo ni archivos generados.

### Ramas
- Siempre desde `develop` actualizado: `git checkout develop && git pull` y luego crear la rama.
- Formato: **`<tipo>/sprint<N>-<descripcion-corta>`**, en minúsculas, con guiones y sin tildes.
- Tipos: `feat` (funcionalidad), `fix` (corrección), `chore` (configuración o mantenimiento), `docs` (documentación), `refactor` (sin cambiar comportamiento), `test` (pruebas).
- Ejemplos: `feat/sprint1-crear-mesas`, `feat/sprint1-login-firebase`, `fix/sprint1-validacion-horarios`, `chore/sprint1-migraciones`.
- **Una rama por tarea.** No mezcles tareas distintas en la misma rama.

### Commits (Conventional Commits, en inglés)
- Formato: `<tipo>(<ámbito>): <descripción en imperativo>`. El ámbito es el módulo o la zona tocada.
- Ejemplos: `feat(restaurant-operations): add table status change`, `fix(auth): show generic error on invalid credentials`, `chore(ui): add button and text field components`, `docs: update database schema`.
- Opcional: agrega `AB#<id>` al final para enlazar el commit con el work item de Azure.
- Commits pequeños y con sentido. No uses mensajes como “cambios”, “fix” o “wip”.

### Mantenerse al día con `develop`
- Antes de abrir el PR y cada día de trabajo: trae los cambios de `develop` a tu rama (`git fetch` + `git merge origin/develop`) y vuelve a correr las verificaciones.
- **Conflictos:** nunca descartes cambios de otra persona para resolverlos. Si no es claro qué conservar, pregunta a la persona y al dueño de ese código.
- **Conflictos en `package-lock.json`:** conserva el `package.json` correcto y regenera el lock con `npm install`. No lo edites a mano.

### Pull Requests
- Siempre hacia `develop`. Pequeños: una tarea por PR.
- La descripción incluye: qué hace, el PBI o la tarea de Azure, cómo probarlo, capturas si hay pantallas y si cambia algo que afecta a otros (API, base de datos, componentes del kit, variables de entorno).
- **Revisión obligatoria:** Elizabeth revisa backend; Sebastián revisa web y mobile. Nadie aprueba su propio PR.
- Antes de pedir revisión, corre las verificaciones del repo (sección de comandos) y deja todo en verde.
- Después del merge se borra la rama.

---

## 4. Seguridad
- **Nunca leas, muestres, copies, edites ni subas archivos `.env`** ni su contenido. Si necesitas saber qué variables existen, usa `.env.example`.
- No escribas secretos, contraseñas, tokens, llaves de servicios ni cadenas de conexión en el código, los logs, los comentarios ni los mensajes de commit.
- **Toda variable nueva va en `.env.example`** con un valor de ejemplo y un comentario, y se avisa en el PR para que la agreguen en Render, Vercel o Expo.
- Las variables públicas (`VITE_*`, `EXPO_PUBLIC_*`) terminan dentro de la web o la app: **nunca pongas secretos en ellas**.
- **No corras migraciones, seeds ni comandos que escriban en bases remotas** (Neon, Upstash) sin confirmación explícita de la persona.

---

## 5. Dependencias y entorno
- **Node 24** (fijado en `.nvmrc` y `engines`). Usa `nvm use`.
- **Solo npm**: no uses yarn, pnpm ni bun, y no borres ni reemplaces `package-lock.json`.
- **No instales, actualices ni elimines dependencias sin preguntar.** Primero revisa si algo ya instalado lo resuelve. Si se agrega una, se explica por qué en el PR.
- Después de cada `git pull` o merge de `develop`, corre `npm install` (o `npm ci`) antes de cualquier otro comando: si alguien agregó una dependencia, los comandos fallan sin eso.
- No cambies versiones mayores de frameworks ni configuraciones globales (tsconfig, linter, formateador, build) sin acordarlo con el equipo.
- **Las versiones instaladas son más nuevas que lo que suele conocer un asistente:** revisa `package.json` y la documentación oficial de la versión instalada antes de usar una API de memoria.

---

## 6. Forma de trabajar
- **Cambios mínimos y dentro del alcance de la tarea.** No reformatees, renombres ni muevas archivos que no son parte de la tarea.
- **No modifiques código de otro módulo ni de otra persona** sin avisar. Si lo necesitas, propónlo y que lo revise su dueño.
- **Reutiliza antes de crear:** componentes del kit, validaciones, servicios, utilidades.
- **Nombres en inglés en el código** (variables, funciones, archivos, rutas de la API, tablas). **Textos de la interfaz en español**, tuteando y con el glosario del manual: mesa, comensal, restaurante, Disponible, Reservada, Ocupada, Inactiva, Abierto, Cerrado, bitácora, capacidad (“4 personas”), iniciar sesión / cerrar sesión.
- **Errores:** al usuario siempre se le muestra un mensaje claro que diga qué hacer, nunca un error técnico. En el código, no se ignoran errores (nada de `catch` vacíos).
- **Sin `console.log`, código comentado ni `TODO` sin dueño** en el PR.
- Funciones y componentes pequeños, con una sola responsabilidad. Tipado estricto: evita `any`.
- **Si algo de estas instrucciones contradice el código o una decisión nueva, avisa** en vez de suponer.

---

## 7. Lo que afecta a otros: avisar siempre
Estos cambios rompen el trabajo de otras personas si no se comunican. Cuando los hagas, **dilo en la descripción del PR y en el grupo del equipo**:
- Cambios en **rutas, DTOs o respuestas de la API** (afecta a web y mobile). No rompas endpoints existentes; si cambian, se actualiza Swagger.
- Cambios en **la base de datos** (nuevas tablas, columnas o migraciones). Se documentan en `docs/database.md` del backend.
- Cambios en **componentes del kit visual** o en los tokens de diseño (afecta todas las pantallas).
- **Variables de entorno nuevas** o cambios en `CORS_ORIGINS`.
- **Dependencias nuevas.**

---

## 8. Decisiones del equipo (no se cambian sin acordarlo)
Las decisiones y contratos del Sprint 2 están en la sección 10.
- **Autenticación:** Firebase Authentication (confirmado). Se usa en la web (restaurantes) y en la app móvil (comensales), con Google y con correo y clave. El backend valida el token de Firebase y decide el rol; ver sección 10.
- **Estados de mesa:** Disponible, Reservada y Ocupada. *Inactiva* es una mesa desactivada, no un estado del control. “Pocas mesas” es disponibilidad del restaurante para el comensal, no un estado de mesa.
- **Estado del restaurante:** Abierto o Cerrado.
- **Diseño:** el manual de identidad v2.0 manda sobre cualquier otra preferencia (el v1.1 queda como histórico; lo que el v2.0 todavía no implementa está en su sección 19). Un solo kit de componentes; nadie crea estilos propios.
- **API:** prefijo `/v1`, contrato documentado en Swagger (`/docs`).
- **Base de datos:** cambios de esquema solo con migraciones; nunca `synchronize`.
- **Identificador de mesa:** corto ("04", "T1") y se muestra "Mesa 04"; "4", "04" y "Mesa 4" son la misma mesa; máximo 10 caracteres; en la interfaz se llama "Identificador" (manual 12.4).
- **Bitácora de mesas:** cambiar el estado, desactivar (`available` → `inactive`; desde §12.2 solo se desactiva una mesa `available`) y reactivar (`inactive` → `available`) se registran; editar el identificador o la capacidad no. Desde el Sprint 3, cada registro lleva `source` (`manual`, `reservation` o `system`) y las entradas automáticas (`system`, el vencimiento de una reserva) tienen `user_id` en `null` (§12.3).
- **Plano de mesas:** la posición de cada mesa vive en `tables` (`plan_x`, `plan_y`, `plan_shape`, en NULL mientras no está ubicada) y se guarda con `PUT /v1/tables/plan`, que reemplaza el plano completo (gana el último que guarda). No se registra en la bitácora ni cambia la disponibilidad.
- Nuevas decisiones: se agregan aquí, en una línea, en el mismo PR que las aplica.

---

## 9. Definición de terminado
Una tarea está lista solo si:
- [ ] Cumple los criterios de aceptación del PBI.
- [ ] Pasan el lint, el chequeo de tipos o build y las pruebas del repo.
- [ ] (Pantallas) Usa solo el kit, sigue el manual y tiene estados de carga, vacío y error, en modo claro y oscuro.
- [ ] Lo que afecta a otros está avisado (sección 7).
- [ ] Funciona en el ambiente desplegado, no solo en local.
- [ ] El PR está revisado y aprobado.

---

## 10. Sprint 2 · Contratos (fuente de verdad)

> Responsable: Elizabeth. Si algo no está aquí, se pregunta antes de inventarlo. Los cambios a esta sección se anuncian en `AVISOS.md`.

### Cuentas y roles
- Roles posibles: `restaurant_admin` (solo web) y `diner` (solo app). Cada cuenta tiene **un solo rol**.
- **Lista de restaurantes habilitados** = filas de `users` con rol `restaurant_admin`. Para habilitar un correo se inserta una fila (ver `docs/database.md` del backend). No hay registro público de restaurantes.
- **Cuentas de prueba (Firebase, correo verificable):** `dinnoteam2026@gmail.com` (restaurante Casa16), `dinnoteam2026+casa72@gmail.com` (restaurante Casa 72) y `dinnoteam2026+comensal@gmail.com` (comensal). Las credenciales están en Discord (#usuarios-restaurante y #usuarios-comensal), **nunca** en el repo. Una cuenta nueva usa un alias `dinnoteam2026+algo@gmail.com` (llega a la misma bandeja). Los dueños de los 15 restaurantes reales del seed (`restaurante-XX@dinno.test`) son solo datos: no tienen cuenta de Firebase ni inician sesión.
- **El backend ya no crea usuarios automáticamente.** El único endpoint que crea un usuario es `POST /v1/diners/me`, y siempre lo crea con el rol `diner`.
- Resolución del usuario en cada petición: token válido → se busca por `firebase_uid` → si no aparece y el correo está verificado, se busca por correo y se vincula el UID (igual que en el Sprint 1) → si no existe, la cuenta queda **sin perfil**.

**Códigos de cuenta.** Precedencia: 401 de sesión → `EMAIL_NOT_VERIFIED` → códigos de rol → `RESTAURANT_REQUIRED`.

| Situación | HTTP | `errorCode` | Mensaje (`message`) |
|---|---|---|---|
| Token ausente, inválido o vencido | 401 | — | Tu sesión terminó. Inicia sesión de nuevo. |
| Correo sin verificar (cuenta todavía sin vincular) | 401 | `EMAIL_NOT_VERIFIED` | Verifica tu correo para continuar. |
| Sin perfil + endpoint de restaurante | 403 | `ACCOUNT_NOT_ENABLED` | Esta cuenta no está habilitada como restaurante. Si eres comensal, encuentra mesa desde la app DiNNo. |
| Sin perfil + endpoint de comensal | 403 | `PROFILE_REQUIRED` | Completa tu perfil para continuar. *(la app no lo muestra: llama a `POST /v1/diners/me` y reintenta)* |
| Comensal en endpoint de restaurante | 403 | `DINER_ACCOUNT` | Esta es una cuenta de comensal. Para buscar mesa, usa la app DiNNo. |
| Restaurante en endpoint de comensal | 403 | `RESTAURANT_ACCOUNT` | Esta es una cuenta de restaurante. Administra tu restaurante desde la web. |
| Restaurante habilitado sin restaurante registrado | 403 | `RESTAURANT_REQUIRED` | Primero registra tu restaurante. *(sin cambios)* |

- **Endpoints de restaurante:** todos los del Sprint 1 (`/v1/restaurants`, `/v1/restaurants/me*`, `/v1/tables*`, `/v1/table-logs`).
- **Endpoints de comensal:** `/v1/search/*` y `/v1/restaurants/:id/public`.
- **Ambos roles:** `GET /v1/me` y `GET /v1/geocode` (una cuenta sin perfil recibe `PROFILE_REQUIRED` en los dos).
- La forma del error no cambia: `{ statusCode, message, error, errorCode? }`. Los clientes deciden por `errorCode`, nunca por el texto.

### Endpoints nuevos o modificados
Todos bajo `/v1`, con `Authorization: Bearer <token de Firebase>`.

| Método | Ruta | Rol | Entrada | Respuesta |
|---|---|---|---|---|
| GET | `/me` | ambos | — | 200 `{ id, email, displayName: string \| null, role, restaurantId: string \| null }` · sin perfil → 403 `PROFILE_REQUIRED` |
| POST | `/diners/me` | token válido con correo verificado | `{ displayName?: string }` (1–60 caracteres, con trim) | 201 si lo crea · 200 si ya existía como comensal. Misma forma que `GET /me`. Si no llega `displayName`: el nombre de la cuenta de Google y, si no hay, la parte del correo antes de `@`. Correo o UID de restaurante → 403 `RESTAURANT_ACCOUNT` |
| GET | `/search/zones` | diner | — | 200 `[{ id, name, latitude, longitude }]` |
| GET | `/search/restaurants` | diner | `lat` + `lng` **o** `zone` · `radiusKm` ∈ {1, 2, 5, 10} (por defecto 2) · `category?` · `partySize?` (1–20) | 200 `[{ id, name, category, address, latitude, longitude, distanceKm, availability }]`, ordenado por distancia, máximo 50 |
| GET | `/restaurants/:id/public` | diner | `lat?` + `lng?` (juntos o ninguno) | 200 `{ id, name, category, address, latitude, longitude, schedules[], isOpenNow, availability, distanceKm? }` · 404 `RESTAURANT_NOT_FOUND` |
| GET | `/geocode` | ambos (el restaurante no necesita tener restaurante registrado) | `address` (3–255 caracteres) | 200 `{ latitude, longitude, formattedAddress }` · 404 `ADDRESS_NOT_FOUND` «No encontramos esa dirección en Bogotá.» · 503 `GEOCODING_UNAVAILABLE` «No pudimos ubicar la dirección en este momento.» · sin perfil → 403 `PROFILE_REQUIRED`. Los mensajes son neutros: cada cliente muestra su propio texto según el `errorCode` |
| POST | `/restaurants` | restaurant_admin | agrega `latitude?`, `longitude?` | la respuesta agrega `latitude`, `longitude` (number \| null) |
| PATCH | `/restaurants/me` | restaurant_admin | agrega `latitude?`, `longitude?` | igual que arriba |
| GET | `/restaurants/me` | restaurant_admin | — | agrega `latitude`, `longitude` (number \| null) |

**Reglas de los campos:**
- `latitude` y `longitude` son `number` en JSON, con hasta 6 decimales. Se aceptan con más de 6: el backend las **redondea** a 6 antes de guardar (no es un error), y las respuestas traen el valor redondeado. Se envían **los dos o ninguno** (si llega solo uno → 400). Deben estar dentro de Bogotá: latitud entre 4.45 y 4.85, longitud entre -74.25 y -73.95 (fuera → 400). En el backend las coordenadas son opcionales para no romper la web actual; la obligatoriedad al registrar la impone el formulario web.
- Búsqueda: `lat`/`lng` y `zone` son excluyentes (los dos o ninguno → 400). `lat`/`lng` pueden estar fuera de Bogotá (simplemente no habrá resultados). Una `zone` desconocida, una `category` inválida, un `radiusKm` fuera de la lista o un `partySize` fuera de rango → 400 con un mensaje en español.
- **Búsqueda por dirección (app):** la búsqueda no recibe `address`. La app llama a `GET /geocode?address=…`, muestra «Resultados cerca de: `formattedAddress`» y busca con `GET /search/restaurants?lat=…&lng=…` usando `latitude` y `longitude`. Con `404` o `503` la app muestra su propio texto y ofrece buscar por zona o por ubicación. Una dirección que existe en Bogotá se acepta aunque el comensal pensara en otra ciudad (las direcciones colombianas se repiten entre ciudades): por eso se muestra `formattedAddress`.
- `distanceKm`: número en km con 2 decimales. El formato para mostrar («a 650 m», «a 1,4 km») lo hace la app.
- `category`: `colombian`, `italian`, `mexican`, `asian`, `grill`, `fast_food`, `healthy`, `seafood`, `cafe`, `other` (los mismos del Sprint 1).
- `schedules[]` del detalle: el mismo formato que `GET /restaurants/me`: `{ dayOfWeek (1 = lunes … 7 = domingo), isOpen24h, opensAt: "HH:MM" | null, closesAt: "HH:MM" | null }`. Si `closesAt < opensAt`, el horario cierra al día siguiente. Los días cerrados no aparecen.
- `/restaurants/:id/public` → 404 `RESTAURANT_NOT_FOUND` si el id no es un UUID válido, si no existe o si no tiene coordenadas.
- Zonas (`id` → nombre): `chapinero` Chapinero · `calle-72` Calle 72 · `zona-g` Zona G · `zona-t` Zona T · `usaquen` Usaquén · `teusaquillo` Teusaquillo · `parque-93` Parque 93 · `cedritos` Cedritos · `salitre` Salitre · `centro` Centro · `la-candelaria` La Candelaria · `galerias` Galerías · `modelia` Modelia · `suba` Suba · `kennedy` Kennedy · `colina` Colina · `niza` Niza · `chico` Chicó · `quinta-camacho` Quinta Camacho · `normandia` Normandía.

### Disponibilidad
- **Abierto ahora** = `is_open = true` **y** la hora actual en **America/Bogota** está dentro del horario: el rango de hoy, o la parte después de medianoche de un horario de ayer que cierra al día siguiente, o un día de 24 horas. El cierre es exclusivo (a las 22:00 en punto, un horario que cierra a las 22:00 ya está cerrado).
- **Mesas libres** = `is_active = true` y `status = 'available'`.
- **Aparece en la búsqueda** solo si tiene coordenadas, está abierto ahora y tiene al menos 1 mesa activa (más el filtro de `partySize`: al menos 1 mesa libre y activa con `capacity ≥ partySize`).

| `availability` | Regla | Texto en pantalla |
|---|---|---|
| `available` | libres / activas > 30 % | Disponible |
| `few` | al menos 1 libre y ≤ 30 % | Pocas mesas |
| `none` | 0 libres | Sin mesas |
| `closed` | no está abierto ahora (solo en el detalle y en tiempo real; nunca en la búsqueda) | Cerrado |

- **Nunca** se expone el número de mesas libres ni de mesas totales.

### Tiempo real
- Socket.IO en el mismo host del backend (ruta por defecto `/socket.io`). Conexión: `io(BASE_URL, { auth: async (cb) => cb({ token: await user.getIdToken() }) })`. El `auth` va **como función** para que cada reconexión envíe un token vigente (con un objeto fijo, la reconexión usaría el token viejo). Solo se aceptan comensales; si no, la conexión se rechaza con `connect_error`, cuyo `message` es un código: `UNAUTHORIZED` (token ausente, inválido o vencido; solo existe en el WebSocket, en HTTP es el 401 sin `errorCode`), `EMAIL_NOT_VERIFIED` (correo sin verificar), `PROFILE_REQUIRED`, `RESTAURANT_ACCOUNT` o `SERVER_ERROR` (el handshake falló por algo distinto a la sesión, por ejemplo la base caída).
- Socket.IO **no reintenta solo** cuando el servidor rechaza la conexión. Con `SERVER_ERROR` la app reintenta ella misma con espera creciente (por ejemplo 5 s, 15 s, 30 s) y, mientras tanto, sigue la consulta cada 60 s. Con los demás códigos no reintenta.
- Un token que vence **no desconecta** un socket ya abierto: el token solo se revisa al conectar, y la siguiente reconexión pide uno nuevo con la función de `auth`.
- Evento del servidor `availability.changed`: `{ restaurantId, availability, isOpenNow, isSearchable }`. Se envía a todos los comensales conectados.
  - `isSearchable` = cumple las reglas para aparecer en la búsqueda (sin filtros). Si es `false` → la app lo quita de la lista y del mapa (el detalle muestra `closed` si `isOpenNow` es `false`). Si es `true` y el restaurante no estaba en la lista → la app vuelve a consultar la búsqueda.
- Se emite cuando: cambia el estado de una mesa, se crea, desactiva o reactiva una mesa, se abre o cierra el restaurante, o se edita su horario o ubicación. Solo después de que la operación queda guardada.
- Respaldo en la app: vuelve a consultar al regresar al primer plano, al reconectarse y cada 60 s en resultados y detalle.

### Cuándo está listo cada contrato en `develop`
**Todo el backend del Sprint 2 ya está en `develop`** (fusionado el 15 oct). Ya no hace falta usar datos de ejemplo: se consume la API real.

| Qué | En `develop` desde |
|---|---|
| Roles, `GET /me`, `POST /diners/me`, coordenadas en la base | 15 oct (PR #35) |
| Regla de disponibilidad (`AvailabilityService`, sin endpoints) | 15 oct (PR #36) |
| Búsqueda, zonas, disponibilidad, filtros y detalle público | 15 oct (PR #37) |
| `GET /geocode` y coordenadas en POST/PATCH | 15 oct (PR #38) |
| WebSocket `availability.changed` | 15 oct (PR #40) |
| Seed con los 15 restaurantes reales en Neon y Casa 72 con dueño `dinnoteam2026+casa72@gmail.com` | 24 oct (PR #44) |
| Llave real de Google Geocoding en local y en Render: `GET /geocode` ya no responde siempre `503` | 26 oct |
| `GET /geocode` para comensales (búsqueda por dirección) y mensajes neutros en 404 y 503 | 26 oct (PR #46) |

---

## 11. Este repositorio: backend (NestJS)

**Antes de empezar cualquier tarea, lee [`AVISOS.md`](AVISOS.md):** cambios recientes que afectan al equipo y acciones pendientes.

### Versiones (revisa antes de usar una API)
NestJS **12**, TypeORM **1.x**, TypeScript **6**, Node **24**, Vitest **4**. Lee `package.json` y consulta https://docs.nestjs.com y https://typeorm.io para la versión instalada; no confíes en APIs de versiones anteriores.

### Comandos
- **Finales de línea:** `.gitattributes` fija LF en el repositorio y en el disco (`* text=auto eol=lf`, igual que Prettier) y marca los binarios. No se corre `git add --renormalize`: el repositorio ya está en LF. Un archivo que en Windows siga en CRLF en el disco pasa a LF la próxima vez que git lo escriba, sin cambio de contenido.
- **Formatear solo los archivos propios del cambio**, nunca `prettier --write` sobre carpetas completas (ni `npm run format`): reformatea código ajeno.

```bash
npm install          # siempre primero, y después de cada pull
npm run start:dev    # servidor en modo desarrollo (http://localhost:3000)
npm run build        # compila a dist/
npm run lint         # oxlint sobre src/, test/ y scripts/ (no revisa tipos)
npm run typecheck    # tsc --noEmit con el tsconfig.json raíz: revisa tipos también en pruebas y test/, que el build excluye
npm run format       # prettier (comillas simples, trailing commas)
npm run test         # pruebas unitarias (Vitest)
npm run test:e2e     # pruebas e2e de la capa HTTP (no requieren base de datos)
npm run test:db      # pruebas contra un Postgres REAL (solo la base de pruebas; ver "Pruebas"). No está en CI
npm run test:cov     # cobertura
```
**Antes de dar una tarea por terminada:** `npm run lint`, `npm run typecheck`, `npm run test` y `npm run build` sin errores.

### Arquitectura: monolito modular
- El código de negocio vive en `src/modules/<dominio>/`, un módulo por dominio, registrado en `src/app.module.ts`.
- Cada módulo es dueño de sus controladores, servicios, entidades y DTOs. **Entre módulos solo se usan los providers que el otro módulo exporta**; nunca se importa desde las carpetas internas de otro módulo.
- **API pública de cada módulo:** su `index.ts`. Hoy la tienen `identity-access`, `search-availability` y `restaurant-operations`. La de `restaurant-operations` (`restaurant-operations/index.ts`) exporta `RestaurantOperationsModule`, `RESTAURANT_CATEGORIES`, `RestaurantCategory` y el evento `RESTAURANT_AVAILABILITY_AFFECTED` con su tipo `RestaurantAvailabilityAffectedEvent`; las categorías siguen viviendo en `restaurants/restaurant.entity.ts`. Lo que otro módulo necesite de `restaurant-operations` se agrega a ese `index.ts`, nunca se importa de sus carpetas.
- **`src/common/`** es para lo que de verdad usan varios módulos y no pertenece a ningún dominio (por ejemplo `common/dto/error-response.dto.ts`, la forma de error de toda la API). Nada de lógica de negocio ni entidades: si algo solo lo usa un módulo, o es de un dominio, va en ese módulo.
- **`src/modules/restaurant-operations/shared/`** es para lo que comparten varias funcionalidades de `restaurant-operations` (mesas, restaurante, estado abierto/cerrado, bitácora) y no es de ninguna en particular, por ejemplo `shared/restaurant-required.ts`, el `403` del usuario sin restaurante. Va aquí y no en `src/common/` porque es dominio de este módulo; tampoco en `restaurants/` ni `tables/`, que tienen dueños.
- La configuración global (ConfigModule, TypeORM, Redis) vive en `src/app.module.ts` y `src/config/`. La configuración HTTP (prefijo, CORS, validación, filtro de errores, Swagger) vive en `src/app.setup.ts`.

**Dónde va cada cosa del Sprint 1:**

| Funcionalidad | Módulo | Subcarpeta sugerida | Dueño |
|---|---|---|---|
| Usuarios, autenticación, control de acceso por rol | `identity-access` | `users/`, `auth/` | Jacobo |
| Datos del restaurante (registro y edición) | `restaurant-operations` | `restaurants/` | Santiago (registro), Elizabeth (edición) |
| Estado abierto/cerrado del restaurante | `restaurant-operations` | `restaurants/` (su propio archivo de servicio o controlador) | Sergio |
| Mesas (crear, consultar, cambiar estado) | `restaurant-operations` | `tables/` | Elizabeth |
| Editar y desactivar mesas | `restaurant-operations` | `tables/` | Sebastián |
| Bitácora de cambios de mesas | `restaurant-operations` | `table-logs/` | Sergio |

El módulo `reservations-checkin` tiene la creación, la consulta y la cancelación de la microreserva y el vencimiento al leer, al crear y al operar (ver "Reservas"; el proceso periódico de vencimiento y el check-in llegan después) y `notifications` todavía no tiene código. `search-availability` es del Sprint 2 (búsqueda, detalle público, disponibilidad y WebSocket; ver más abajo).

### Configuración y variables de entorno
- **Nunca leas `process.env` en el código de una funcionalidad:** usa `ConfigService` (`getOrThrow` para lo obligatorio).
- Variables actuales (ver `.env.example`): `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `PORT` (solo local), `DEV_USER_ENABLED`, `DEV_USER_ID`, `RENDER`, `NODE_ENV`, `RENDER_GIT_COMMIT`, `FIREBASE_PROJECT_ID`, `GOOGLE_GEOCODING_API_KEY` (opcional, ver "Geocodificación") y `RESERVATION_TTL_MINUTES` (opcional, ver "Reservas").
  - **Obligatorias:** `DATABASE_URL` y `REDIS_URL`; además, `FIREBASE_PROJECT_ID` cuando el usuario de desarrollo está deshabilitado. La app no arranca si falta una variable obligatoria (`getOrThrow`).
  - `DEV_USER_ENABLED=true` activa el usuario de desarrollo y `DEV_USER_ID` es el uuid del usuario por defecto. Solo local, nunca se definen en Render: sin ellas, toda ruta protegida responde `401`.
  - `FIREBASE_AUTH_EMULATOR_HOST` es opcional y solo para el emulador de Firebase en local; la usa el SDK de Firebase, y nuestro código solo comprueba si está definida. **Nunca se define en Render:** con ella, el SDK deja de verificar la firma de los tokens.
  - `RENDER` (la define Render) y `NODE_ENV=production` marcan el ambiente como desplegado (`isDeployedEnvironment`, en `identity-access/auth/deployed-environment.ts`). No se definen a mano. En un ambiente desplegado, **la app no arranca** si `FIREBASE_AUTH_EMULATOR_HOST` está definida o `DEV_USER_ENABLED` es `true`: el error nombra la variable, nunca su valor (`identity-access/auth/deployment-safety.ts`).
  - `RENDER_GIT_COMMIT` la define Render con el commit desplegado; `GET /v1/health` la devuelve en `commit` y el CI la compara con el commit del push. En local es `null`.
- `CORS_ORIGINS`: lista separada por comas, sin `/` final. **Nunca la abras a `*`.** Si un origen nuevo necesita acceso, se agrega en Render.

### Base de datos (PostgreSQL en Neon, TypeORM)
- `synchronize: false` y `autoLoadEntities: true`. **Todo cambio de esquema va por migraciones de TypeORM.** Cómo crearlas y correrlas: subsección "Migraciones".
- **Nunca corras migraciones contra Neon sin confirmación.**
- Convenciones: entidad en PascalCase singular (`Restaurant`); tabla y columnas en `snake_case`; la tabla en plural. Toda tabla con `id`, `created_at` y `updated_at`.
- **El esquema vigente se documenta en `docs/database.md`.** Si cambias una tabla, actualízalo en el mismo PR y avisa al equipo.
- Cada consulta de datos de un restaurante filtra por el restaurante del usuario de la sesión.

### Migraciones
**Cómo se corren**
- `npm run migration:generate -- src/migrations/<Nombre>`: compara las entidades con la base y escribe la migración en `src/migrations/`.
- `npm run migration:run` aplica las pendientes; `npm run migration:revert` deshace la última.
- Los tres compilan primero (`npm run build`): el CLI de TypeORM lee de `dist/` y `migration:run` solo opera sobre `.js`.
- **No se usa `typeorm-ts-node-esm`:** `ts-node` no está instalado y no se va a instalar. No lo propongas.
- `src/data-source.ts` es solo para el CLI y el seed, y lee `process.env` directo porque vive fuera de la inyección de dependencias de Nest. Es una de las **dos** excepciones conscientes a la regla de "Configuración y variables de entorno"; la otra es `src/main.ts`, que lee `PORT` porque lo necesita antes de crear la app. Ningún otro archivo lee `process.env`.

**Quién las corre**
- En el Sprint 1 los cinco compartimos una sola base en Neon. Por eso **solo Elizabeth ejecuta `migration:run` y `migration:generate`.**
- `migration:generate` compara las entidades contra el estado real de la base: si otra persona lo corre en la base compartida, la migración le sale con las tablas de los demás y ensucia el historial.
- Los demás crean la migración con `npm run migration:create -- src/migrations/<Nombre>` y escriben el SQL a mano, o se la piden a Elizabeth.
- Nada se corre contra Neon sin avisar (sección 4).

**Cómo se agregan columnas**
- Cada quien hace `ALTER` sobre las tablas que ya existen. **Nadie recrea una tabla ni toca columnas de otra persona.**
- `Restaurant` la editan tres personas, cada una con su propia migración: Elizabeth dejó el mínimo (`name`), Santiago agrega categoría, dirección y horarios, y Sergio el estado abierto/cerrado.
- `docs/database.md` se actualiza en el mismo PR que cambia el esquema.

**Convenciones del esquema**
- Llaves primarias: `@PrimaryGeneratedColumn('uuid')`, generadas con `gen_random_uuid()` (`uuidExtension: 'pgcrypto'` e `installExtensions: false` en `app.module.ts` y `data-source.ts`: la app no ejecuta `CREATE EXTENSION` al conectarse). Las FK hacia ellas son de tipo `uuid`.
- Fechas en `timestamptz`.
- Nombre explícito en checks, índices y restricciones únicas (`CHK_`, `UQ_`), no los hashes que genera TypeORM. Las PK y FK quedan con el nombre generado.
- Para apuntar a una entidad de otro módulo sin importar sus carpetas internas: `@ForeignKey('NombreEntidad')` con el nombre en texto, no `@ManyToOne`.

**Advertencia: índice escrito a mano**
- `UQ_tables_restaurant_id_identifier` está sobre `(restaurant_id, lower(trim(identifier)))` y vive escrito a mano en la migración `CreateInitialTables`, porque `@Index` no acepta expresiones.
- Por eso la entidad `Table` lo declara con `{ synchronize: false }`. **No quites esa línea:** si falta, el próximo `migration:generate` genera un `DROP INDEX` y se pierde la regla de identificadores únicos sin que nadie lo note.

### Datos de prueba: el seed (Elizabeth)
- **Cómo se corre:** `npm run seed` compila (`nest build`) y ejecuta `dist/seed.js` con el `.env`. **Contra Neon solo lo corre Elizabeth.** Nunca es una migración ni llega a Render solo.
- **Archivos:** `src/seed.ts` es solo la entrada (conexión, transacción y log); la lógica está en `src/seed-data/run-seed.ts` (`runSeed(manager, restaurantes)`) y el archivo de Santiago se lee con `loadRealRestaurants()` (`src/seed-data/real-restaurants.ts`). `nest-cli.json` copia `seed-data/*.json` a `dist` (`assets`). Lee las entidades por nombre (`manager.getRepository('Restaurant')`) e importa de las carpetas internas de los módulos lo que su `index.ts` no exporta, porque vive fuera de ellos.
- **Qué crea:** `onboarding@example.com` (sin restaurante), `demo@example.com` (sin restaurante, reservado para la demo), `dinnoteam2026@gmail.com` (restaurante habilitado, sin restaurante del seed), `comensal@example.com` (comensal), Casa 72 con su dueño `dinnoteam2026+casa72@gmail.com` y 8 mesas, y los 15 restaurantes de `src/seed-data/restaurants.json`, cada uno con su dueño `restaurant_admin` (`restaurante-XX@dinno.test`), horarios y mesas.
- **Todo o nada:** corre en una sola transacción; si algo falla, no queda nada a medias.
- **Idempotente; al repetirlo:**
  - Los usuarios se buscan por correo y no se cambian (un rol distinto solo deja un aviso), salvo el cambio de dueño de Casa 72.
  - Casa 72 restablece categoría, dirección, coordenadas y horarios; no toca su nombre ni sus mesas (crea solo las que falten).
  - Los 15 restaurantes reales restablecen todo lo del archivo: nombre, categoría, dirección, coordenadas, `is_open`, horarios y la capacidad, el estado y si está activa cada mesa del archivo (por identificador). Las mesas que no están en el archivo no se tocan. Un correo del archivo que ya existe como comensal detiene el seed.
  - Los horarios se borran y se vuelven a insertar (cambian sus `id`, nada apunta a ellos).
  - Lo que cambia el seed no pasa por los servicios: no escribe en la bitácora ni emite `availability.changed`.
  - No toca otras cuentas ni otros restaurantes (por ejemplo, Casa16).
- **Dueño de Casa 72:** una base que todavía tiene `casa72@example.com` pasa ese mismo usuario (mismo `id`, el usuario de desarrollo de Casa 72) a `dinnoteam2026+casa72@gmail.com` con `firebase_uid` en `null`; el primer inicio de sesión con ese correo verificado lo vincula. Si existen los dos correos a la vez, el seed se detiene.
- **Pruebas:** `run-seed.spec.ts` corre el seed contra una base en memoria (creación, segunda corrida idéntica, restablecimiento, cambio de dueño, cuentas ajenas); `restaurants.spec.ts` revisa el archivo de Santiago.

### Bitácora de mesas (`restaurant-operations/table-logs/`, Sergio)
- **Contrato:** la clase abstracta `TableStatusLog` (`tables/table-status-log.ts`), con un método `record(change, manager)`. `change` es `TableStatusChange`: `tableId`, `previousStatus`, `newStatus` (`TableLogStatus`: `available`, `reserved`, `occupied` o `inactive`), `userId` y `changedAt`. El contrato vive en `tables/` y `table-logs/` lo implementa, así que `tables/` nunca importa de `table-logs/`.
- **Implementación real:** `DbTableStatusLog` (`table-logs/table-logs.recorder.ts`), registrada en `restaurant-operations.module.ts` como `{ provide: TableStatusLog, useClass: DbTableStatusLog }`. Inserta una fila en `table_logs` (entidad `TableLog`, `table-logs/table-log.entity.ts`).
- **Cómo usarla desde otro servicio de mesas:** inyecta `TableStatusLog` (nunca `DbTableStatusLog` ni el repositorio de `TableLog`) y llama a `record(...)` **dentro de la misma transacción** que cambia la mesa, pasándole el `manager` de esa transacción. No atrapes su error: si el insert falla, la transacción se revierte y la mesa queda como estaba. Ejemplo completo: `updateStatus` y `changeActive` en `tables.service.ts`.
- **Qué se registra:** cambiar el estado (`<anterior>` → `<nuevo>`), desactivar (`available` → `inactive`) y reactivar (`inactive` → `available`). **Qué no:** crear una mesa, editar identificador o capacidad, y pedir el estado que la mesa ya tiene (responde 200 sin escribir nada).
- **Origen (`source`, Sprint 3):** `TableStatusChange` lleva `source` (`manual`, `reservation` o `system`, `TABLE_LOG_SOURCES`) y `userId` puede ser `null` solo con `system` (check en la base). Hoy `TablesService` pasa siempre `'manual'`; las reservas pasarán `reservation` y `system` (§12.3). `GET /v1/table-logs` devuelve `source` y `userEmail` en `null` para los registros automáticos.
- **Desactivar (§12.2, vigente):** solo se desactiva una mesa `available` y sin reserva DiNNo activa, así que lo que se registra al desactivar es siempre `available` → `inactive`. Antes del Sprint 3 se desactivaba una mesa `reserved` u `occupied` conservando su estado; ya no (ver "Mesas con reserva activa").
- **`inactive` solo existe en la bitácora**, nunca en `tables.status`. Si cambia `TABLE_LOG_STATUSES`, hace falta una migración escrita a mano que borre y vuelva a crear `CHK_table_logs_previous_status` y `CHK_table_logs_new_status` (TypeORM compara los checks solo por nombre).
- **Requisitos de toda consulta sobre `table_logs`** (acordado con Elizabeth): (a) filtra siempre por el restaurante del usuario de la sesión, con un join a `tables` (`tables.restaurant_id`), nunca por un dato que mande el cliente (`table_logs` no tiene `restaurant_id`); (b) tiene una prueba e2e que confirma que el usuario de un restaurante no ve los registros de las mesas de otro.
- **Pruebas e2e:** toda prueba que monte `RestaurantOperationsModule` necesita `.overrideProvider(getRepositoryToken(TableLog)).useValue({})`. Las que prueban mesas además reemplazan `TableStatusLog` por un mock.
- **Consulta: `GET /v1/table-logs`** (`table-logs/table-logs.controller.ts` y `table-logs.service.ts`). Lleva `@Roles(UserRole.RESTAURANT_ADMIN)` + `CurrentUserGuard`.
  - **Parámetros:** solo `tableId` (uuid, opcional) para filtrar por mesa. Cualquier otro parámetro, incluido `restaurantId`, da `400`; un `tableId` que no es uuid, `400` con "El id de la mesa no es un UUID válido." (`TABLE_ID_INVALID` de `tables.controller.ts`).
  - **Respuesta:** `200` con `[{ id, tableId, tableIdentifier, previousStatus, newStatus, changedAt, userEmail }]` (`TableLogResponseDto`). `tableIdentifier` es el identificador actual de la mesa; `userEmail`, el correo de quien hizo el cambio (`users` no tiene nombre). Estados de `TABLE_LOG_STATUSES`, incluido `inactive`.
  - **Orden y límite:** `changed_at DESC` (desempate por `id DESC`), máximo **200 filas**, sin paginación (`TABLE_LOGS_LIMIT`).
  - **Restaurante:** sale de la sesión, con un join a `tables` (`tables.restaurant_id`); los correos de los autores salen de `UsersService.findEmailsByIds` (exportado por `identity-access`), en una sola consulta adicional: la bitácora no consulta la tabla `users`. Un `tableId` de otro restaurante o que no existe responde `[]`, igual que una mesa sin cambios: no revela qué mesas tiene otro restaurante.
  - **Errores:** `401` sin sesión o con `EMAIL_NOT_VERIFIED`; `403` con `errorCode: "RESTAURANT_REQUIRED"` sin restaurante; `403` `DINER_ACCOUNT` (comensal) o `ACCOUNT_NOT_ENABLED` (sin perfil).
  - **Pruebas:** `table-logs.service.spec.ts` fija la consulta (join a `tables`, filtro, orden, límite) y que los correos salen de una sola llamada a `findEmailsByIds` y `test/table-logs.e2e-spec.ts` prueba el aislamiento con un query builder simulado que aplica esos filtros a filas de dos restaurantes. Ninguna ejecuta SQL real.

### Redis (Upstash)
Cliente `ioredis` en `src/config/redis.config.ts`, inyectable con el token `REDIS_CLIENT`. No se usa en el Sprint 1 salvo que una tarea lo pida.

### API
- Todas las rutas bajo **`/v1`** (definido en `app.setup.ts`). Health check: `GET /v1/health`.
- **Swagger en `/docs`** (fuera del prefijo `/v1`). Toda ruta nueva queda documentada con sus DTOs y respuestas: es el contrato con web y mobile.
- Rutas en inglés, sustantivos en plural y `kebab-case` (por ejemplo `/v1/restaurants/me`, `/v1/tables/:id/status`).
- **Toda entrada se valida en el backend**, aunque la web también valide, con `class-validator` y `class-transformer`: decoradores sobre el DTO, cada uno con su `message` en español que diga cómo corregir. El `ValidationPipe` es global (en `app.setup.ts`, con `whitelist`, `forbidNonWhitelisted` y `transform`): **cualquier campo que no esté en el DTO se rechaza con 400**, en todos los endpoints.
- Errores con las excepciones HTTP de Nest (`BadRequestException`, `NotFoundException`, `ForbiddenException`…) y un mensaje claro. Nunca se devuelve un error interno, una consulta SQL ni un stack trace.
- Forma de los errores: `{ statusCode, message, error }` y, a veces, `errorCode` (`src/common/dto/error-response.dto.ts`). **Lleva `errorCode` el error donde el front tiene que ramificar según el motivo; los demás no lo llevan.** Hoy existen `EMAIL_NOT_VERIFIED` (401 del correo sin verificar), `RESTAURANT_REQUIRED` (403 del usuario sin restaurante) los cuatro códigos de cuenta del Sprint 2 (`ACCOUNT_NOT_ENABLED`, `PROFILE_REQUIRED`, `DINER_ACCOUNT`, `RESTAURANT_ACCOUNT`; tabla en la sección 10, textos en `identity-access/roles/account-errors.ts`) `RESTAURANT_NOT_FOUND` (404 del detalle público, `search-availability/public-restaurant/restaurant-not-found.ts`) y los dos de `GET /v1/geocode`, `ADDRESS_NOT_FOUND` (404) y `GEOCODING_UNAVAILABLE` (503) (`restaurant-operations/geocoding/geocoding-errors.ts`). Se usa la opción nativa de Nest 12 (`HttpExceptionOptions.errorCode`): `new ForbiddenException(mensaje, { errorCode: '...' })`. No se arma el cuerpo a mano ni se crea un campo propio.
- **Un error no controlado** (no es una excepción HTTP: se cae la base, un bug) responde `500` con la forma de Nest y el mensaje en español "No pudimos completar la acción. Intenta de nuevo en un momento.", sin `errorCode`. El detalle real (mensaje, stack) **solo va al log del servidor, nunca al cliente**. Lo hace el filtro global `src/common/filters/unhandled-exception.filter.ts`, registrado en `app.setup.ts`: nadie monta su propio manejo de errores genéricos, y las excepciones HTTP que lanzamos pasan sin cambios.
- No cambies la forma de una respuesta existente sin avisar (sección 7).

### Estado abierto/cerrado del restaurante (`restaurant-operations/restaurants/restaurant-status.*`, Sergio)
- **Columna:** `restaurants.is_open` (`boolean`, NOT NULL, por defecto `true`), propiedad `isOpen` de `Restaurant`. Migración `1791342586330-AddRestaurantIsOpen`.
- **`GET /v1/restaurants/me/status`:** no recibe nada. Responde `200` con `{ "isOpen": boolean }` (`RestaurantStatusResponseDto`).
- **`PATCH /v1/restaurants/me/status`:** recibe `{ "isOpen": boolean }` (`UpdateRestaurantStatusDto`; un texto `"true"`, `null`, un campo faltante o un campo de más dan `400`). Responde `200` con `{ "isOpen": boolean }`, el estado después del cambio. Enviar el estado que ya tiene responde `200` igual, sin escribir en la base ni emitir el evento de disponibilidad. Desde el Sprint 2 es **una sola sentencia condicional** (`UPDATE … WHERE id = :id AND is_open <> :isOpen`, con `Not(isOpen)` en `Repository.update`): la base decide si cambió, y el evento se emite solo si `affected === 1`. Así, dos peticiones simultáneas con el mismo estado nuevo emiten un solo evento, y una escritura que falla no emite. La respuesta se lee después de la sentencia.
- Los dos: llevan `@Roles(UserRole.RESTAURANT_ADMIN)` + `CurrentUserGuard`; el restaurante sale siempre de la sesión (no hay id en la ruta ni en el body); `401` sin sesión (sin `Authorization: Bearer` válido) o con el correo sin verificar (`EMAIL_NOT_VERIFIED`), `403` con `errorCode: "RESTAURANT_REQUIRED"` si el usuario no tiene restaurante (`requireRestaurant`) y `403` `DINER_ACCOUNT` (comensal) o `ACCOUNT_NOT_ENABLED` (sin perfil).
- **Es manual en el Sprint 1:** no depende de `restaurant_schedules`. La confirmación de cerrar con mesas reservadas (y el conteo de esas mesas) la hace la web con `GET /v1/tables`; el endpoint no la pide ni la devuelve.
- Es independiente de `GET`/`PATCH /v1/restaurants/me`: `RestaurantResponseDto` no incluye `isOpen`.

### Disponibilidad (`search-availability`, Elizabeth)
- **Dónde vive:** `search-availability/availability/`. La regla de la sección 10 ("Disponibilidad") está en funciones puras, sin Nest ni base de datos:
  - `toBogotaTime` en `bogota-time.ts`;
  - `isOpenNow` y `parseTimeOfDay` en `opening-hours.ts`;
  - `availabilityLevel`, `hasTableFor` y `hasActiveTable` en `table-availability.ts`;
  - `computeAvailability` en `compute-availability.ts`.
  
  Trabajan con tipos propios del módulo (`availability.types.ts`), nunca con entidades de `restaurant-operations`.
- **Cómo se usa:** importa `SearchAvailabilityModule` e inyecta `AvailabilityService` (los dos desde `search-availability/index.ts`). Tiene tres métodos:
  - `getForRestaurant(id)` → `AvailabilityResult | null` (`null` si el restaurante no existe);
  - `getForRestaurants(ids, { partySize? })` → `Map<id, AvailabilityResult>`, siempre con tres consultas sin importar cuántos ids lleguen. **Es el que usa la búsqueda:** con `partySize` (filtro de personas), `isSearchable` además exige una mesa libre y activa con `capacity ≥ partySize`, sobre las mesas ya cargadas. No llames `canSeat` por cada restaurante: sería N+1;
  - `canSeat(id, partySize)` → `boolean`, para un solo restaurante (asignación de mesa del Sprint 3). **Solo mira las mesas, no el horario:** para asignar una mesa, combínalo con `getForRestaurant(id)` y su `isOpenNow`.
  
  `AvailabilityResult` es `{ isOpenNow, availability, isSearchable }`. Los ids deben ser UUID válidos: quien recibe el id del cliente lo valida antes.
- **Lectura de datos:** solo lectura de `Restaurant`, `RestaurantSchedule` y `Table` por nombre de entidad (`DataSource.getRepository('Restaurant')`), con las columnas justas. El mapeo de filas a tipos está en `availability-rows.ts`. Nunca escribe.
- **Hora:** se calcula con `Intl.DateTimeFormat` en `America/Bogota`; depende solo del instante, no del `TZ` del servidor (Render corre en UTC). El instante sale de `Clock` (`SystemClock` en el módulo). En las pruebas se fija con `.overrideProvider(Clock).useValue({ now: () => new Date('2026-10-16T18:00:00Z') })`, y en las unitarias se pasa el instante directamente. Escribe los instantes en UTC con su hora de Bogotá en un comentario.
- **Nunca expongas conteos:** ni `AvailabilityResult` ni ninguna respuesta lleva cuántas mesas hay o cuántas están libres. Si necesitas una decisión nueva, agrega una función que devuelva un booleano o un nivel, nunca un número.

### Búsqueda (`search-availability/search/`, Elizabeth)
- **Rutas:** `GET /v1/search/zones` y `GET /v1/search/restaurants` (`search.controller.ts`, `@Roles(UserRole.DINER)` + `CurrentUserGuard`). El controlador solo valida y delega.
- **Zonas:** lista cerrada en `zones.ts` (`ZONES`, `listZones`, `zoneCenter`); no consulta la base.
- **Filtros (PBI 4.1), opcionales y combinables:**
  - `category` (uno de `RESTAURANT_CATEGORIES`, importado de `restaurant-operations/index.ts`) se aplica **en SQL**: el lector agrega la igualdad sobre `category` a la misma consulta, así no trae filas que se descartarían. Un restaurante con `category` NULL nunca coincide.
  - `partySize` (entero de 1 a 20) **no** se aplica en la búsqueda: se pasa como `{ partySize }` a `getForRestaurants`, que exige una mesa libre y activa con `capacity ≥ partySize` sobre las mesas ya cargadas. La búsqueda no conoce ninguna regla de mesas. Sin `partySize`, la opción no se envía.
  - En `lat`, `lng`, `radiusKm` y `partySize` solo valen números escritos en decimal (`toNumberOrNaN`, en `search-availability/location/location-fields.ts`): vacío, hexadecimal (`0x10`), exponentes (`1e1`), `Infinity` o `+5` dan `400`, nunca `0` ni otro número.
- **Validación:** `dto/search-restaurants-query.dto.ts`. La regla del origen (`lat`/`lng` juntas **o** `zone`, nunca las dos) es `searchOriginProblem` y va como decorador sobre `zone`, que a propósito no lleva `@IsOptional`.
- **Flujo** (`RestaurantSearchService.search`): centro (ubicación o centro de la zona) → `RestaurantCandidatesReader.findWithin(boundingBox(...), { category })`, una sola consulta de solo lectura con el prefiltro por rectángulo → `haversineKm` exacta, fuera los que pasan el radio, orden por distancia y desempate por `id` → **una** llamada a `AvailabilityService.getForRestaurants(ids, { partySize })` → solo `isSearchable` → máximo 50. `distanceKm` se redondea a 2 decimales al final; el filtro usa la distancia exacta.
- **Geometría** (`geo.ts`, pura): `haversineKm` (radio 6371,0088 km) y `boundingBox`, que siempre contiene el círculo. Los km por grado salen del mismo radio (~111,195 km): con 111,32 km el rectángulo se queda corto y pierde el borde del círculo.
- **Pruebas:** unitarias de `geo`, `zones`, el DTO, el lector y el servicio; `test/search.e2e-spec.ts` monta el módulo con una base simulada que aplica `Between` e `In`.

### Detalle público (`search-availability/public-restaurant/`, Elizabeth)
- **Ruta:** `GET /v1/restaurants/:id/public` (`PublicRestaurantController`, `@Roles(UserRole.DINER)` + `CurrentUserGuard`), con `lat` y `lng` opcionales (juntas o ninguna). Convive con las rutas de `restaurant-operations` bajo `/restaurants` porque ninguna de ellas termina en `/:id/public`; `test/public-restaurant.e2e-spec.ts` monta los dos módulos y lo prueba.
- **Ubicación del comensal:** `lat` y `lng` usan los mismos campos que la búsqueda (`LatitudeField`, `LongitudeField` y `LocationPair` en `search-availability/location/location-fields.ts`), con los mismos mensajes.
- **Flujo** (`PublicRestaurantService.getById`): en paralelo, `PublicRestaurantReader.findProfile(id)` (solo lectura con `find` por nombre de entidad: datos, coordenadas y horarios en `HH:MM`, de lunes a domingo, igual que `GET /restaurants/me`) y `AvailabilityService.getForRestaurant(id)`. No recalcula nada: `isOpenNow` y `availability` (que aquí **sí** puede ser `closed`) salen tal cual. `distanceKm` (`haversineKm` + `roundKm`) solo si llegan `lat` y `lng`; si no, la propiedad no aparece.
- **404 `RESTAURANT_NOT_FOUND`** ("Este restaurante ya no está disponible."), en un solo lugar (`restaurant-not-found.ts`), en tres casos: el `:id` no es un UUID válido (lo revisa `ParseUUIDPipe` antes de consultar; no es 400 porque la app solo maneja el 404), el restaurante no existe, o no tiene coordenadas.

### Geocodificación y ubicación del restaurante (`restaurant-operations/geocoding/`, Elizabeth)
- **Límites de Bogotá:** una sola fuente, `BOGOTA_BOUNDS`, `isInsideBogota` y `roundCoordinate` en `restaurant-operations/shared/bogota-location.ts`. Los usan el DTO de coordenadas y el geocodificador; no se repiten los números en otro lugar.
- **Puerto y adaptador:** `Geocoder` (`geocoder.ts`) con `geocode(address)` → `GeocodeResult`, una unión `found` / `not_found` / `unavailable`; el adaptador nunca lanza. `GoogleGeocoder` (`google-geocoder.ts`) usa el `fetch` de Node con `AbortSignal.timeout(5000)`, arma la URL con `URLSearchParams` (`components=locality:Bogotá|country:CO`, `language=es`, `region=co`), redondea a 6 decimales y responde `not_found` si el resultado queda fuera de Bogotá o si es demasiado general: cuando **todos** los `types` del primer resultado están entre `locality`, `political`, `administrative_area_level_1`, `administrative_area_level_2` y `country` (por ejemplo "Bogotá, Colombia" para una dirección que Google no entiende). Un barrio (`neighborhood`, `sublocality`) o algo más preciso (`route`, `street_address`, `premise`, `establishment`, `intersection`…) se acepta. `partial_match` y `geometry.location_type` no se usan como criterio.
  - **Por qué (medido el 2026-10-26 con 25 direcciones contra Google):**
    - Las 14 direcciones únicas del seed y 4 válidas de prueba se aceptan.
    - Las 5 inexistentes o de otra ciudad (`Carrera 300 # 500-99`, `Calle 999 # 999-99`, `… Pitalito`, `… Medellín`, `Avenida Siempre Viva 742`) ya dan `404`, porque Google responde «Bogotá, Colombia» (`locality`, `political`).
    - El único hueco es «asdfghjkl qwerty 999999» → `200` con «Cra. 85 #20-33». Llega con la misma forma (`partial_match: true`, `ROOFTOP`, tipos de establecimiento) que dos direcciones válidas del seed: «Calle 93A #11-49» (Al Alma) y «Calle 82 #12-21» (Andrés D.C.). Ninguna regla sobre esos campos rechaza el texto sin sentido sin rechazar esas dos.
    - Exigir `street_address`, `premise`, `subpremise`, `route` o `intersection` en `types` también rechaza 4 direcciones del seed: centros comerciales, parques y restaurantes que Google devuelve como establecimiento.
    - Por eso no se cambió la regla.
  - **La protección está en los clientes:** la web muestra el pin para que el dueño lo confirme o lo mueva antes de guardar, y la app muestra «Resultados cerca de: `formattedAddress`».
  - **Direcciones repetidas entre ciudades:** las direcciones colombianas se repiten entre ciudades. Una dirección que existe en Bogotá se acepta aunque el usuario pensara en otra ciudad; por eso los clientes muestran `formattedAddress`.
  - **Ambiguo, rechazado por los límites:** `Calle 5 # 4-20` sin ciudad → Google la ubica en Chía (latitud 4.852, justo fuera de Bogotá) → `404`.
- Un resultado sin `types` (o con una lista vacía) es una respuesta inesperada: `unavailable`. Se registra con `{ provide: Geocoder, useClass: GoogleGeocoder }`; las pruebas lo reemplazan con `.overrideProvider(Geocoder)`.
- **Sin llave** (`GOOGLE_GEOCODING_API_KEY` vacía o sin definir): la app arranca, no se llama a Google y `GET /v1/geocode` responde `503 GEOCODING_UNAVAILABLE`.
- **La llave nunca se registra:** ni ella ni la URL (que la lleva) ni la dirección van a logs, errores ni respuestas. El adaptador solo deja un WARN con el `status` de Google o el tipo de error (`timeout`, `HTTP 500`, `invalid JSON`…).
- **`GET /v1/geocode`** (`geocode.controller.ts`): `@Roles(UserRole.RESTAURANT_ADMIN, UserRole.DINER)` + `CurrentUserGuard`, **sin** `requireRestaurant` (el formulario de registro lo usa antes de que exista el restaurante). El comensal lo usa para buscar por dirección (§10). Como la ruta acepta `diner`, `RolesGuard` responde `PROFILE_REQUIRED` a una cuenta sin perfil, igual que `GET /v1/me`; no hay otro `403` de cuenta. `address` recortada, de 3 a 255 caracteres y sin caracteres invisibles. Los mensajes de `404` y `503` son neutros (`geocoding-errors.ts`): la web y la app ponen su propio texto según el `errorCode`.
- **Coordenadas del restaurante:** `latitude` y `longitude` están en `RestaurantFieldsDto` con `RestaurantCoordinateField` (`restaurants/dto/restaurant-location-fields.ts`), así que POST y PATCH validan igual: opcionales, las dos o ninguna, dentro de Bogotá, `null` rechazado y redondeadas a 6 decimales antes de guardar. `RestaurantResponseDto` las devuelve como `number | null`.

### Tiempo real: eventos y WebSocket (Elizabeth)
- **Flujo:** servicio de `restaurant-operations` → guarda (commit) → emite `RESTAURANT_AVAILABILITY_AFFECTED` (`'restaurant.availability-affected'`, `{ restaurantId }`) con `EventEmitter2` → `AvailabilityChangedListener` (`search-availability/realtime/`, `@OnEvent(..., { async: true })`) → `AvailabilityService.getForRestaurant` → `AvailabilityGateway.broadcast` → evento `availability.changed` a la sala `diners`.
- **Dónde se emite** (`restaurant-operations/shared/availability-affected.event.ts`): `TablesService.create`, `updateStatus` (solo si el estado cambió), `deactivate` y `reactivate`; `RestaurantStatusService.update` (solo si la sentencia condicional cambió `is_open`: `affected === 1`); `RestaurantEditService.update` (si llegan horarios, o si las coordenadas cambian). **Siempre fuera de la transacción**, después de que `manager.transaction(...)` resuelve: si la operación falla, no se emite nada. No emiten: editar identificador o capacidad de una mesa, registrar un restaurante ni editar nombre, categoría o dirección.
- **Desacople:** `restaurant-operations` solo emite; no conoce el WebSocket ni `search-availability`. `EventEmitterModule.forRoot()` se registra **una sola vez**, en `AppModule`.
- **Listener:** si `getForRestaurant` devuelve `null`, no envía nada. Cualquier error se atrapa y queda un WARN con el `restaurantId` y el tipo de error; nunca afecta la respuesta HTTP de quien hizo el cambio (corre después y aparte, `async: true`).
- **Gateway** (`availability.gateway.ts`): mismo host y puerto, `/socket.io`, CORS con `CORS_ORIGINS` (`CorsIoAdapter` en `src/config/socket-io.adapter.ts`, registrado en `configureApp`). El handshake se valida en un middleware (`server.use`): un rechazo llega como `connect_error` y el cliente nunca queda conectado. No recalcula nada. El log solo tiene conteos de conexiones.
- **Identidad en el handshake:** `DinerSocketAuthenticator` (`identity-access/realtime/`, exportado en `identity-access/index.ts`) arma `{ headers }` desde `auth` (`authorization: Bearer <auth.token>` y, en local, `x-dev-user-id: <auth.devUserId>`) y llama al mismo `CurrentUserResolver` que HTTP (Firebase, vinculación por correo, usuario de desarrollo). `CurrentUserResolver.resolve` recibe `IdentityRequest` (`{ headers }`), no el `Request` de Express. `devUserId` no tiene efecto con el usuario de desarrollo apagado ni en un ambiente desplegado, porque ese resolver nunca se selecciona ahí. Un fallo que no es de sesión (la base caída) responde `connect_error` `SERVER_ERROR`.
- **Probarlo a mano:** `node scripts/listen-availability.mjs --dev-user-id <uuid del comensal>` (local) o con `DINNO_TOKEN=<token>` contra Render; imprime cada `availability.changed` con la hora (README, sección 6).
- **Una sola instancia:** la sala `diners` vive en la memoria del proceso. Con más de una instancia (o al pasar a Azure con escalado) haría falta un adaptador compartido de Socket.IO (por ejemplo Redis) y sesiones pegajosas; hoy Render corre una.

### Reservas (`reservations-checkin/reservations/`, Elizabeth)
- **Ruta:** `POST /v1/reservations` (`reservations.controller.ts`, `@Roles(UserRole.DINER)` + `CurrentUserGuard`). El comensal sale de la sesión. El controlador solo valida y delega en `CreateReservationService`. La respuesta es `Reservation` (§12.8), armada por `toReservationResponse` (`reservation.mapper.ts`), que reutilizan las rutas de lectura y cancelación.
- **Estructura:** `create-reservation.service.ts` (orquesta), `table-assignment.ts` (regla pura de asignación), `reservation-code.ts` (`CodeGenerator` abstracto y `RandomCodeGenerator`, con `crypto.randomInt`), `reservation.config.ts` (TTL), `reservation-errors.ts` (los tres 409), `dto/`.
- **Dependencias entre módulos:** importa `SearchAvailabilityModule` (`AvailabilityService`, `Clock`, `canSeatParty`, `restaurantNotFound`) y `RestaurantOperationsModule` (el puerto `TableStatusLog`, exportado por su `index.ts`). Ninguno importa de este módulo. Restaurantes y mesas se leen y escriben por nombre de entidad (`'Restaurant'`, `'Table'`), porque son de `restaurant-operations`; esta es la excepción documentada a "no se escribe en tablas de otro módulo": §12.3 exige que reserva y mesa cambien en una sola transacción.
- **Orden de las reglas:** (a) el restaurante existe y es visible (existe y tiene coordenadas, igual que el detalle público; si no, 404 `RESTAURANT_NOT_FOUND`), (b) abierto ahora (`AvailabilityService.getForRestaurant().isOpenNow`; si no, 409 `RESTAURANT_CLOSED`; un restaurante cerrado con coordenadas es 409, no 404), (c) el comensal no tiene otra reserva activa (409 `ACTIVE_RESERVATION_EXISTS`), (d) mesa (409 `NO_TABLE_AVAILABLE`), (e) código, (f) `expiresAt` = ahora + TTL con `Clock`.
- **Regla de asignación** (`rankCandidateTables`): solo mesas que pueden recibir al grupo (`canSeatParty`: activa, `available` y capacidad ≥ personas, la misma regla de la búsqueda), de la más pequeña a la más grande; a igual capacidad, la de **identificador menor con orden numérico** (`localeCompare` con `numeric: true`: "2" va antes que "10"). Una mesa `reserved` u `occupied` a mano nunca se asigna.
- **Concurrencia (§12.4):** todo va en una transacción (`DataSource.transaction`). Se leen las candidatas, se ordenan con la regla pura y se recorren **en ese orden**: para cada una se intenta `findOne` con `lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' }` (`FOR UPDATE SKIP LOCKED`). Si otra transacción la tiene bloqueada, no devuelve nada y se pasa a la siguiente; bajo el bloqueo se revalida (del restaurante, activa, `available`, capacidad). `NO_TABLE_AVAILABLE` solo cuando se agotan todas. **Se bloquea una mesa a la vez, nunca todas las candidatas:** si no, con mesas de sobra dos solicitudes se verían las mesas bloqueadas y una fallaría por error. Defensa final: los índices únicos parciales (`UQ_reservations_active_diner` → `ACTIVE_RESERVATION_EXISTS`; `UQ_reservations_active_table` → `NO_TABLE_AVAILABLE`; `UQ_reservations_active_code` → se repite la transacción completa con otro código, máximo 5 intentos; agotados, un error normal que el filtro global responde como 500).
- **Mesa y bitácora (§12.3):** en la misma transacción la mesa pasa `available` → `reserved` y `TableStatusLog.record` escribe `source: 'reservation'`, `userId` = el comensal. Si algo falla, no queda reserva ni mesa a medias.
- **Evento:** después del commit emite `RESTAURANT_AVAILABILITY_AFFECTED` (`{ restaurantId }`); `availability.changed` sale como siempre. El servicio no conoce el WebSocket (`reservation.created` es de otra tarea).
- **Decisión conocida: el horario se evalúa antes de la transacción.** Si el restaurante cierra o termina su horario en los milisegundos entre esa comprobación y el commit, la reserva se crea igual. §12.2 respeta las reservas existentes al cerrar, así que no deja nada trabado; evitarlo exigiría leer los horarios dentro de la transacción y duplicar `isOpenNow`.
- **Consulta del comensal:** `GET /v1/reservations/active` → `200 { reservation: Reservation | null, serverTime }` (sin reserva activa, `reservation: null`, nunca 404; `serverTime` es el mismo dentro y fuera). `GET /v1/reservations/:id` → `200 Reservation` en cualquier estado, solo la del comensal de la sesión: una reserva que no existe o es de otro comensal da el mismo `404 RESERVATION_NOT_FOUND` («No encontramos esa reserva.»); un `:id` que no es UUID da `400` en español. `code` solo viene cuando `status = active`. Los atiende `ReservationQueryService`; la respuesta se arma con el mismo mapper de la creación (`ReservationViewReader` carga restaurante y mesa). `/active` está declarada antes que `/:id`.
- **Vencimiento al leer y al crear (§12.5):** `ReservationExpirationService` (`reservation-expiration.service.ts`) es la única lógica de vencimiento. Todo pasa por un núcleo privado `expireDue(scope)` (`scope` vacío = todas las debidas); hoy se exponen `expireIfDue(reservationId)` y `expireDueForDiner(dinerId)`. Una transacción por llamada: (1) un solo `UPDATE reservations ... RETURNING` con la condición dentro (`status = 'active' AND expires_at <= ahora`) que deja `status 'expired'`, `expired_at` = ahora (`Clock`) y `no_show = true`; es idempotente y no pisa una reserva que otra operación acaba de cancelar o cumplir; (2) por cada reserva vencida, la mesa vuelve de `reserved` a `available` con `UPDATE ... WHERE id = :tableId AND status = 'reserved'`: nunca se pisa un estado que el restaurante cambió después; (3) la bitácora (`source 'system'`, `userId null`, `reserved` → `available`) solo si la mesa realmente cambió. Después del commit, y solo si alguna mesa cambió, emite `RESTAURANT_AVAILABILITY_AFFECTED` una vez por restaurante. Dos lecturas simultáneas de la misma reserva vencida: una sola la vence (la otra espera el bloqueo de fila, ya no la ve activa y no hace nada). No emite `reservation.expired` ni nada del WebSocket (otra tarea).
  - **Al leer:** `/active` llama a `expireDueForDiner` antes de buscar; `/:id` llama a `expireIfDue` si la reserva está activa y la vuelve a leer. Nunca se devuelve como activa una reserva con `expires_at` pasado.
  - **Al crear:** `CreateReservationService.create` llama a `expireDueForDiner` después de comprobar que el restaurante está abierto y **antes** de abrir la transacción de creación. Así un comensal con una reserva vencida que nadie barrió puede reservar de nuevo, y la creación no cambia. Va fuera de su transacción porque reutiliza el servicio de vencimiento tal cual (con su propio commit y su evento); si la creación falla después, el vencimiento ya hecho sigue siendo correcto. Solo vence las reservas **del comensal que crea**: la mesa de la reserva vencida de otro comensal sigue reservada hasta que alguien lea esa reserva o corra el proceso periódico.
  - **Tarea 6 (proceso cada 15 s):** agrega `expireAllDue()` llamando a `expireDue({})` (el mismo `UPDATE ... RETURNING`, sin filtro) y lo programa; no reescribe nada de lo anterior. `expireDue({})` ya está cubierto por una prueba unitaria.
  - **Decisión conocida: `expired_at` es la hora en que se vence (ahora), no `expires_at`.** Si nadie leyó la reserva ni corrió el proceso, `expired_at` queda después del vencimiento real. Por eso el mensaje del check-in de la tarea 7, «Esta reserva se venció a las HH:mm», usará `expires_at`, no `expired_at`.
- **`RESERVATION_TTL_MINUTES`:** minutos enteros entre 2 y 15; sin definir, 15. Una variable definida pero inválida (texto, decimal, vacía, fuera de rango) **impide que la app arranque**, con un mensaje en español (la factory de `ReservationConfig` lanza al crear el módulo). Se lee con `ConfigService`, nunca de `process.env`. Para la demo de expiración se usa 3 en Render.
- **Pruebas de concurrencia:** `test/db/reservations-concurrency.db-spec.ts`, con `npm run test:db` (ver "Pruebas"). Llaman al servicio real con peticiones en paralelo contra la base de pruebas. A diferencia del resto de `test/db`, **sin ROLLBACK** (la concurrencia necesita commits): cada prueba crea sus datos con ids únicos y borra solo lo que creó, en orden de FK, aunque falle. El montaje (`DataSource`, escenarios, borrado) vive en `test/db/support/scenario.ts` y lo comparten la suite de concurrencia y `reservations-expiration.db-spec.ts` (vencimiento al leer y al crear: reserva vencida, lecturas simultáneas, mesa que ya no estaba reservada, reservas ya resueltas, vencer al crear y mesa libre otra vez).

### Cancelar la reserva (`POST /v1/reservations/:id/cancel`, Elizabeth)
- **Contrato:** `@Roles(UserRole.DINER)`; `:id` con `ParseUUIDPipe` y el mismo `400` en español que `GET /reservations/:id`. `200 Reservation` (§12.8) con `status 'cancelled'`, `cancelledAt` = ahora (`Clock`), `code` `null`, `expiredAt` y `checkedInAt` `null`. Solo el dueño: una reserva que no existe o es de otro comensal da el mismo `404 RESERVATION_NOT_FOUND`. Si ya no está activa (`cancelled`, `expired` o `completed`): `409 RESERVATION_NOT_ACTIVE` («Esta reserva ya no está activa.»); la app consulta `GET /reservations/:id` y muestra el estado real. Lo atiende `ReservationCancellationService`.
- **Orden (vencer antes de transaccionar):** (1) lectura propia (`{ id, dinerId }`; 404 si no existe o es ajena, y por eso **nunca se vence la reserva de un tercero** solo por conocer su id), (2) si no está `active`, 409, (3) `ReservationExpirationService.expireIfDue(id)` **antes** de abrir la transacción (vencer toca la fila de la mesa; dentro de la transacción de cancelación las dos se esperarían entre sí, el mismo criterio de las acciones de mesa), (4) la transacción de cancelación. Una activa que ya pasó su `expires_at` queda `expired` y la cancelación responde 409: el comensal no puede cancelar algo ya vencido.
- **Transacción (§12.3, todo o nada):** (a) un solo `UPDATE reservations SET status='cancelled', cancelled_at=:now WHERE id AND diner_id AND status='active' AND expires_at > :now RETURNING "id", "table_id", "restaurant_id"`; (b) `releaseReservedTable`: la mesa pasa de `reserved` a `available` solo si sigue `reserved`, y solo entonces se escribe la bitácora (`source 'reservation'`, `userId` = el comensal, `reserved` → `available`, mismo `manager`). Si el `UPDATE` no devuelve fila se distingue leyendo: no existe o es ajena → 404; ya no está activa → 409 (si sigue `active` es que venció entre medias: se vence ahora y es 409). Después del commit, y solo si la mesa cambió, emite `RESTAURANT_AVAILABILITY_AFFECTED`. No emite `reservation.cancelled` ni nada del WebSocket (otra tarea).
- **Concurrencia:** la condición va dentro del `UPDATE`, así que varias cancelaciones a la vez, o una cancelación contra un vencimiento, no se pisan: la que llega segunda espera el bloqueo de la fila, ya no la ve activa y devuelve cero filas (409 o ya vencida). Exactamente una operación transiciona la reserva; la mesa se libera una sola vez y la bitácora se escribe una sola vez. Lo fijan `test/db/reservations-cancellation.db-spec.ts` (5 cancelaciones simultáneas y 16 rondas de cancelar contra vencer, con desfases a los dos lados para que la carrera sea real).
- **No se pisa una mesa cambiada a mano:** si el restaurante cambió la mesa (por ejemplo a `occupied`) mientras la reserva seguía activa, la reserva queda `cancelled` pero la mesa no se toca y no hay bitácora ni evento.
- **`releaseReservedTable` (`reservations/release-reserved-table.ts`) es la única regla de «liberar la mesa solo si sigue `reserved`».** La usan el vencimiento (usuario `null`, `source 'system'`) y la cancelación (el comensal, `source 'reservation'`). No abre transacciones ni emite eventos: actúa con el `manager` recibido y quien la llama emite el evento después de su commit. No la dupliques en otro servicio (el check-in de la tarea 7 pasa la mesa a `occupied`, que es otra regla).
- **Por qué el `RETURNING` va como texto** (`.returning('"id", "table_id", "restaurant_id"')`): con un arreglo, TypeORM interpreta cada elemento como nombre de **propiedad** de la entidad (`tableId`) y descarta en silencio lo que no encuentra; con `'table_id'` devolvía solo `"id"` y la mesa llegaba `undefined` (nos pasó en el vencimiento). Las pruebas unitarias usan el query builder real de TypeORM y un doble que devuelve solo las columnas que pide el SQL, para que no vuelva a pasar desapercibido.

### Mesas con reserva activa y `activeReservationsCount` (§12.2, Elizabeth)
- **Definición:** una mesa tiene reserva DiNNo activa si existe una reserva con `table_id` = la mesa, `status = 'active'` Y `expires_at > ahora`. Una activa ya vencida que el proceso periódico aún no barrió se vence primero y la mesa se trata como sin reserva. Una mesa `reserved` u `occupied` puesta a mano **no** tiene reserva DiNNo y se maneja como siempre.
- **Reglas** (`TablesService`, errores en `tables/table-reservation-errors.ts`; las demás respuestas de mesas siguen sin `errorCode`):
  - **Cambiar estado** (`PATCH /v1/tables/:id/status`): con reserva activa → `409 TABLE_HAS_ACTIVE_RESERVATION`. Va **antes** del atajo de "sin cambios": pedir el estado que la mesa ya tiene (el "Deshacer") también responde 409. Decisión conocida.
  - **Desactivar** (`POST /v1/tables/:id/deactivate`), en este orden: (a) 404 como hoy, (b) 409 de "ya inactiva" sin `errorCode`, (c) reserva activa → `TABLE_HAS_ACTIVE_RESERVATION` (prioridad), (d) estado distinto de `available` → `409 TABLE_NOT_AVAILABLE_TO_DEACTIVATE` («primero márcala como Disponible»). Reactivar no cambia.
  - **Editar** (`PATCH /v1/tables/:id`): cambiar solo el identificador se permite siempre. Bajar la capacidad con reserva activa es `409 TABLE_HAS_ACTIVE_RESERVATION` solo si queda **por debajo** de las personas (`party_size`) de la reserva; igual o más, se permite.
  - **Cerrar el restaurante** (`PATCH /v1/restaurants/me/status`) no toca las reservas activas (lo cubren una e2e y `test/db/table-protection.db-spec.ts`); las nuevas responden `RESTAURANT_CLOSED`.
- **Dónde vive la regla (un solo lugar):** `restaurant-operations` declara el puerto `TableReservations` (`shared/table-reservations.ts`, exportado por su `index.ts`) con `expireDueForTable`, `findActiveForTable` y `countActive`. Lo implementa `reservations-checkin` (`reservations/reservations-for-tables.ts`, registrado con `{ provide: TableReservations, useClass: ReservationsForTables }`), porque `reservations-checkin` ya importa `restaurant-operations` y no puede haber ciclos. Con esto **no hace falta leer `'Reservation'` por nombre** desde `restaurant-operations`: la implementación usa la entidad de su propio módulo, y el vencimiento reutiliza `ReservationExpirationService` (con el alcance `tableId`).
- **Cómo llega el puerto a las mesas sin importar `reservations-checkin`:** `TablesService` y los controladores del perfil inyectan `TableReservationsAccess` (de `restaurant-operations`), que busca el puerto con `ModuleRef.get(TableReservations, { strict: false })`. Si nadie lo registró usa una implementación **nula** (sin reservas, contador 0), que existe **solo para las pruebas que montan `RestaurantOperationsModule` aislado**.
- **En la aplicación real el puerto es obligatorio:** `AppModule` registra `RequireTableReservationsPort`, que en `onApplicationBootstrap` lanza si el puerto no es el real: la app **no arranca**, con un mensaje en español, en vez de seguir con las mesas sin proteger. Los módulos aislados de las pruebas no lo registran, y por eso pueden usar la nula. Lo fijan `table-reservations.spec.ts` y `test/table-reservations-composition.e2e-spec.ts` (la composición real resuelve `ReservationsForTables`; sin él el arranque falla; `AppModule` conserva el chequeo).
- **Concurrencia:**
  1. **Antes** de abrir la transacción de la acción: `expireDueForTable(tableId)` (su propia transacción). No puede ir dentro: vencer actualiza la fila de la mesa y, con el `FOR UPDATE` ya tomado, las dos transacciones se esperarían entre sí (interbloqueo). Solo lo hacen el cambio de estado, desactivar y editar la **capacidad**.
  2. Dentro de la transacción y **después** de bloquear la fila de la mesa (`FOR UPDATE`): `findActiveForTable(tableId, manager)` (activa Y `expires_at > ahora`; una vencida que aparezca entre el barrido y el bloqueo se ignora). Como la creación de reservas bloquea la misma fila con `SKIP LOCKED` y revalida, o la reserva ya está confirmada y se ve (la acción del restaurante espera el bloqueo y relee la fila), o el restaurante tiene la fila bloqueada y la creación pasa a otra mesa. Nada se cuela entre la comprobación y el cambio.
  3. **El vencimiento previo corre aunque el `tableId` sea de otro restaurante.** Solo vence algo que ya estaba vencido (inocuo) y la respuesta es el mismo 404 de siempre, sin ningún dato de la reserva (lo fijan pruebas unitarias, e2e y db).
- **`activeReservationsCount`:** número en `RestaurantProfileResponseDto`, así que sale en `POST /v1/restaurants` (siempre 0, sin consultar), `GET /v1/restaurants/me` y `PATCH /v1/restaurants/me` (`TableReservations.countActive(restaurantId)`: reservas `active` del restaurante con `expires_at > ahora`). Las tres respuestas siguen siendo iguales más ese campo.
- **Aviso a la web:** el `409` al desactivar ahora lleva `errorCode` (`TABLE_HAS_ACTIVE_RESERVATION` o `TABLE_NOT_AVAILABLE_TO_DEACTIVATE`); la web debe ramificar por `errorCode`, no tratar todo 409 como éxito (ver `AVISOS.md`).

### Pruebas
- **`npm run test:db` (pruebas contra Postgres real):** archivos `test/db/*.db-spec.ts`, config `vitest.config.db.ts`, cliente `pg` directo. Son las únicas que ejecutan SQL de verdad (índices parciales, checks, restricciones únicas). **No forman parte de `npm test`, `npm run test:e2e` ni del CI.**
  - **Requiere `.env.test`** (ignorado por git) con `TEST_DATABASE_URL`, la URL de la base de **pruebas**. Para correr las migraciones sobre esa base con el CLI de TypeORM, el mismo archivo define `DATABASE_URL` con el mismo valor y se pasa con `--env-file=.env.test` (los scripts `migration:*` cargan `.env`, no `.env.test`).
  - **Se niegan a correr** si `TEST_DATABASE_URL` falta o es igual a la `DATABASE_URL` de desarrollo (`.env` o el entorno): nunca tocan la base de desarrollo.
  - **No aplican migraciones:** asumen que `migration:run` ya se corrió sobre la base de pruebas; si falta una tabla o columna, fallan diciendo qué migración falta.
  - Cada prueba crea sus datos dentro de una transacción que termina en `ROLLBACK`: no dejan nada. Las excepciones son `reservations-concurrency.db-spec.ts` y `reservations-expiration.db-spec.ts` (commits reales; borran lo que crearon, ver "Reservas").
  - `test/db/support/pg.d.ts` declara los tipos mínimos de `pg` porque `@types/pg` no está instalado.
- Vitest. Pruebas unitarias junto al código (`*.spec.ts`) y e2e en `test/`.
- **Toda e2e que monte `RestaurantOperationsModule` importa `EventEmitterModule.forRoot()`** (sus servicios inyectan `EventEmitter2`). Las e2e de WebSocket (`test/realtime.e2e-spec.ts`) levantan el servidor con `app.listen(0, '127.0.0.1')`, conectan `socket.io-client` sin reconexión y cierran sockets y app en `afterEach`.
- Cada servicio nuevo con pruebas de casos felices y de error (por ejemplo: mesa de otro restaurante, datos inválidos, mesa inactiva).

### Despliegue
- **Render**, con despliegue automático en cada push a `develop`. URL: https://dinno-backend.onrender.com (health: `/v1/health`).
- `.github/workflows/ci-cd.yml` tiene dos jobs. `checks` corre en cada PR hacia `develop` y en cada push a `develop`: Node 24, `npm ci`, lint, typecheck, test, test:e2e y build. `verify-deployment` corre solo en cada push a `develop`, después de `checks`, y espera a que `/v1/health` devuelva el commit del push.
- `PORT` lo asigna Render; no lo fijes. Las variables se configuran en el panel de Render, nunca en el repositorio.

### Migración a Azure (pendiente)
Tres cosas dependen hoy de Render y hay que resolverlas al pasar a Azure:
- **Ambiente desplegado:** `isDeployedEnvironment` (`identity-access/auth/deployed-environment.ts`) lo detecta por `RENDER` o `NODE_ENV=production`. En Azure no existe `RENDER`: hay que asegurar `NODE_ENV=production`. Si falta, el usuario de desarrollo y el emulador de Firebase no se bloquean al arrancar, y la API escucha solo en `127.0.0.1`.
- **Commit desplegado:** `GET /v1/health` lee `RENDER_GIT_COMMIT` (`app.service.ts`). En Azure hay que pasar el commit con otra variable desde el pipeline y leerla en su lugar; si no, `commit` llega en `null` y el job `verify-deployment` del CI nunca termina bien.
- **WebSocket:** en Azure App Service hay que activar *Web sockets*. Con más de una instancia hace falta ARR affinity (sesiones pegajosas) o un adaptador compartido de Socket.IO (por ejemplo Redis), porque la sala `diners` vive en la memoria del proceso (ver "Tiempo real: eventos y WebSocket").

### Sprint 2 · Notas de implementación
- `UserRole` tiene `RESTAURANT_ADMIN` y `DINER`. Nada de literales `'restaurant_admin'` en el código; `users.role` lleva un check con los dos valores.
- La cuenta sin perfil se resuelve a una `RequestIdentity` con `kind: 'unregistered'` en lugar de crearla. `RolesGuard` traduce cada caso a su `errorCode` según los roles que exige el endpoint (tabla de códigos de cuenta).
- `search-availability` es dueño de la búsqueda, el detalle público, las zonas, la disponibilidad y el WebSocket. La regla de disponibilidad vive en **funciones puras** (`isOpenNow`, `availabilityLevel`) sin dependencias de Nest ni de la base, con la hora inyectable para las pruebas, más un `AvailabilityService` **exportado** para el Sprint 3.
- Lectura entre módulos: `search-availability` lee restaurantes, horarios y mesas con consultas de solo lectura (`find` con el nombre de la entidad (`DataSource.getRepository('Restaurant')`), como la excepción documentada de `table-logs`). Nunca escribe en tablas de `restaurant-operations`.
- Eventos: `restaurant-operations` emite eventos internos (EventEmitter2) **después del commit**, solo con `{ restaurantId }`. `search-availability` los escucha, recalcula y envía por el WebSocket. La lógica de mesas no conoce al WebSocket.
- Distancia: Haversine **en TypeScript** (`search/geo.ts`), con un prefiltro barato por rectángulo en SQL (`BETWEEN` sobre `latitude` y `longitude`). Así la regla se prueba sin base de datos (las pruebas nunca ejecutan SQL real). Sin PostGIS. Redis no se usa en este sprint.
- Zona horaria: `Intl.DateTimeFormat` con `timeZone: 'America/Bogota'`. Sin librerías de fechas nuevas.
- Geocodificación: Google Geocoding API con `GOOGLE_GEOCODING_API_KEY` (solo en Render y en `.env.example` sin valor; nunca en logs), restringida a Bogotá (`components=locality:Bogotá|country:CO`). Un resultado fuera de los límites de Bogotá → `ADDRESS_NOT_FOUND`. Sin llave, cuota agotada o timeout → `GEOCODING_UNAVAILABLE`.
- Identificadores de mesa del seed: los existentes (`Mesa N`) se quedan como están para no duplicar mesas en Neon. Los restaurantes nuevos del seed usan identificadores cortos (`01`, `T1`).

---

## 12. Sprint 3 · Contratos (microreservas y check-in)

> Responsable: Elizabeth. Si algo no está aquí, se pregunta antes de inventarlo. Los cambios a esta sección se anuncian en `AVISOS.md`.

**Objetivo del sprint:**
- Un comensal elige en la app un restaurante disponible, reserva una mesa por unos minutos y recibe un código y un temporizador. Puede cancelar la reserva o dejarla vencer.
- El restaurante ve las reservas entrantes en la web sin recargar y valida el check-in con el código cuando el comensal llega.
- Reserva, mesa y disponibilidad quedan siempre sincronizadas entre app, web y backend.

### 12.1 La microreserva
- **Estados:** `active` (Activa) · `cancelled` (Cancelada) · `expired` (Vencida) · `completed` (Cumplida). Solo se pasa de `active` a uno de los otros tres; nunca al revés.
- **Vigencia:** 15 minutos, configurable con la variable `RESERVATION_TTL_MINUTES` (entero entre 2 y 15; por defecto 15). Para la demo de expiración se usa 3 en Render.
- **Una sola reserva activa por comensal.** Si ya tiene una → 409 `ACTIVE_RESERVATION_EXISTS`.
- **Personas:** de 1 a 20, igual que el filtro del Sprint 2. Si el comensal ya filtró por personas, la app lo trae precargado.
- **Cuándo se puede reservar:** solo si el restaurante está abierto ahora (`is_open` y horario de Bogotá, la misma regla `isOpenNow` de disponibilidad) y tiene una mesa activa (`is_active`), con estado `available` y capacidad ≥ personas. Se reutilizan las reglas de disponibilidad del Sprint 2; no se duplican.
- **Asignación de mesa:** la mesa libre más pequeña que alcance. Si hay empate, la de identificador menor. Así no se gasta una mesa de 8 en una pareja.
- Una mesa que el restaurante puso en Reservada a mano nunca se asigna a una microreserva, porque no está `available`.
- **Código:** 6 caracteres de mayúsculas y números, sin los que se confunden (0, O, 1, I, L). Alfabeto: `23456789ABCDEFGHJKMNPQRSTUVWXYZ`. Ejemplo: `K7M4QX`. Único entre las reservas activas. Al validarlo, el backend lo normaliza (quita espacios y pasa a mayúsculas).
- **Temporizador:** manda la hora del servidor. Cada respuesta de reserva trae `expiresAt` y `serverTime`. La app calcula la diferencia con su propio reloj y cuenta hacia atrás con eso.
- **Fechas:** todas las fechas de la API van en ISO 8601 UTC. `serverTime` es la hora del servidor al momento de responder.

### 12.2 Mesas con reserva activa
Una microreserva dura como máximo 15 minutos y siempre termina sola (check-in, cancelación o vencimiento), así que bloquear la mesa mientras tanto no deja nada trabado. Si el restaurante pudiera liberarla a mano, DiNNo podría asignársela a otro comensal mientras el primero va en camino. Si el comensal llega, el camino es el check-in, no cambiar el estado.

| Acción del restaurante | Mesa con reserva DiNNo activa | Mesa Ocupada o Reservada a mano |
|---|---|---|
| Cambiar el estado (`PATCH /v1/tables/:id/status`) | 409 `TABLE_HAS_ACTIVE_RESERVATION` | Permitido |
| Desactivar (`POST /v1/tables/:id/deactivate`) | 409 `TABLE_HAS_ACTIVE_RESERVATION` | 409 `TABLE_NOT_AVAILABLE_TO_DEACTIVATE` (primero se pasa a Disponible) |
| Bajar la capacidad (`PATCH /v1/tables/:id`) | 409 `TABLE_HAS_ACTIVE_RESERVATION` solo si queda por debajo de las personas de la reserva | Permitido |
| Editar el identificador | Permitido | Permitido |
| Cerrar el restaurante | Permitido, con aviso; la reserva se respeta | Permitido |

- Si aplican los dos 409, gana `TABLE_HAS_ACTIVE_RESERVATION`.
- **Cambio de comportamiento frente al Sprint 2:** antes se podía desactivar una mesa `reserved` u `occupied` conservando su estado. Desde ahora solo se desactiva una mesa `available`.
- Reactivar no cambia: la mesa vuelve como `available`.
- **Cerrar el restaurante con reservas activas:** el cierre se hace igual. Las reservas existentes siguen hasta el check-in, la cancelación o el vencimiento, y no se aceptan nuevas (`RESTAURANT_CLOSED`).
- **Mensajes en la web:**
  - `TABLE_HAS_ACTIVE_RESERVATION` → «Esta mesa tiene una reserva de DiNNo en curso. Se libera sola cuando el comensal llegue, cancele o se venza la reserva.»
  - `TABLE_NOT_AVAILABLE_TO_DEACTIVATE` → «Para desactivar esta mesa, primero márcala como Disponible.»
  - Cerrar con reservas activas → «Tienes N reservas en curso; se mantendrán hasta que lleguen o se venzan.» (N = `activeReservationsCount`).

### 12.3 Mesa y reserva siempre juntas

| Evento | Reserva | Mesa | Bitácora: `source` | Bitácora: `user_id` |
|---|---|---|---|---|
| Crear microreserva | `active` | `available` → `reserved` | `reservation` | el comensal |
| Cancelar (comensal) | `cancelled` | `reserved` → `available` | `reservation` | el comensal |
| Vencer sin llegar | `expired` (no-show) | `reserved` → `available` | `system` | `null` |
| Check-in válido | `completed` | `reserved` → `occupied` | `reservation` | el `restaurant_admin` |
| Cambio manual (como hoy) | — | según el cambio | `manual` | el `restaurant_admin` |

- Todo cambio de reserva y mesa va en una sola transacción: o se guardan los dos o ninguno.
- **Bitácora (`table_logs`):**
  - `user_id` pasa a ser nullable.
  - Se agrega la columna `source` (`'manual'` | `'reservation'` | `'system'`). Los registros existentes quedan con `source = 'manual'`.
  - `GET /v1/table-logs` empieza a devolver `source` y puede traer el usuario en `null`. La web lo muestra como "Automático".
- La mesa vuelve a `available` solo si sigue en `reserved` por esa reserva. Nunca se pisa un estado que el restaurante cambió después.

### 12.4 Concurrencia (dos personas, una mesa)
- La creación bloquea las mesas candidatas dentro de la transacción (`SELECT … FOR UPDATE SKIP LOCKED`) y revalida su estado antes de confirmar.
- **Defensa final en la base, con índices únicos parciales:**
  - una reserva `active` por mesa;
  - una reserva `active` por comensal;
  - código único entre las reservas `active`.
- Si dos solicitudes compiten por la última mesa, una gana y la otra recibe 409 `NO_TABLE_AVAILABLE`.

### 12.5 Expiración
- La fuente de verdad es `expires_at` en PostgreSQL. No se usa un temporizador en memoria ni en Redis.
- Un proceso del backend corre cada 15 s y vence de una sola vez todas las reservas `active` cuyo `expires_at` ya pasó (`UPDATE … RETURNING`). Es idempotente: al arrancar el servicio, vence lo que haya quedado pendiente.
- Además, cualquier lectura u operación sobre una reserva activa que ya pasó su `expires_at` la vence en ese momento y la devuelve como `expired`, aunque el proceso no haya pasado todavía.
- La reserva vencida queda marcada como no-show (`expired_at` y `no_show = true`) para el Sprint 4 y la IA.

### 12.6 Check-in
- Lo hace el restaurante desde la web, escribiendo el código que le muestra el comensal.
- Un código de otro restaurante responde igual que uno inexistente: no se revela que existe.
- **Evento facturable:** cada check-in válido crea un registro en `check_ins` (restaurante, reserva, fecha y hora). Es único por reserva, así que nunca se cobra dos veces. El estado de cuenta se construye en el Sprint 4.
- **La web nunca muestra el código de una reserva en la lista;** si lo mostrara, el check-in no comprobaría nada. Muestra nombre del comensal, personas, mesa y tiempo restante.

| Situación | Respuesta | Qué ve el restaurante |
|---|---|---|
| Código válido | 200 | «Check-in confirmado · Mesa {tableIdentifier} · {partySize} personas · {dinerName}» |
| No existe, formato inválido o es de otro restaurante | 404 `RESERVATION_CODE_NOT_FOUND` | «No encontramos una reserva con ese código en tu restaurante.» |
| Vencida | 409 `RESERVATION_EXPIRED` | El `message` del backend, p. ej. «Esta reserva se venció a las 12:41. La mesa ya se liberó.» |
| Ya usada | 409 `RESERVATION_ALREADY_USED` | El `message` del backend, p. ej. «Este código ya se usó a las 12:35.» |
| Cancelada | 409 `RESERVATION_CANCELLED` | «El comensal canceló esta reserva.» |

- En el mensaje de check-in confirmado, un `dinerName` en `null` se muestra como «Comensal», igual que en la lista de reservas.
- **Errores:** se mantiene el formato actual `{ statusCode, message, error, errorCode }`, sin campos nuevos (§10 y CLAUDE.md del backend, §11 «API»).
- **Regla general:** cada cliente elige su texto según el `errorCode`.
- **Única excepción:** en `RESERVATION_EXPIRED` y `RESERVATION_ALREADY_USED`, el backend arma en `message` el texto final, con la hora de Bogotá en formato HH:mm de 24 h, y la web lo muestra tal cual.

### 12.7 Tiempo real
- Se amplía el WebSocket del Sprint 2: mismo gateway, mismo host y mismo handshake (token de Firebase).
- Ahora también acepta cuentas `restaurant_admin` con restaurante registrado. Si el admin no tiene restaurante, el rechazo es `RESTAURANT_REQUIRED`.
- **Salas:**
  - El comensal entra a `diners` (como hoy) y a `diner:{userId}`.
  - El restaurante entra solo a `restaurant:{restaurantId}`.
  - Cada uno recibe solo lo suyo.
- **Eventos nuevos:** `reservation.created`, `reservation.cancelled`, `reservation.expired`, `reservation.checked_in` y `table.status_changed`. `availability.changed` no cambia y sigue yendo solo a `diners`.
- Los eventos salen solo después de guardar en la base.
- **Respaldo:**
  - Al reconectar o volver a la pantalla, el cliente vuelve a consultar.
  - El panel de reservas de la web consulta además cada 30 s.
  - La pantalla de reserva activa de la app consulta cada 30 s.
- Redis sigue sin usarse para Socket.IO, porque Render corre una sola instancia. El adaptador de Redis pasa al Sprint 4, con la migración a Azure.

### 12.8 Contratos de la API
Todo va bajo `/v1`, con `Authorization: Bearer <token de Firebase>` y el formato de error actual.

| Método | Ruta | Rol | Recibe | Devuelve |
|---|---|---|---|---|
| POST | `/v1/reservations` | diner | `{ restaurantId, partySize }` | 201 `Reservation` · 409 `NO_TABLE_AVAILABLE` / `ACTIVE_RESERVATION_EXISTS` / `RESTAURANT_CLOSED` · 404 si el restaurante no existe o no es visible (igual que el detalle público) · 400 validación |
| GET | `/v1/reservations/active` | diner | — | 200 `{ reservation: Reservation \| null, serverTime }` |
| GET | `/v1/reservations/:id` | diner (solo la suya) | — | 200 `Reservation` en cualquier estado (para mostrar el final) · 404 `RESERVATION_NOT_FOUND` si no existe o es de otro comensal |
| POST | `/v1/reservations/:id/cancel` | diner (solo la suya) | — | 200 `Reservation` · 409 `RESERVATION_NOT_ACTIVE` · 404 `RESERVATION_NOT_FOUND` |
| GET | `/v1/restaurants/me/reservations` | restaurant_admin | query `status?` = `active` \| `cancelled` \| `expired` \| `completed` (por defecto `active`) | 200 `RestaurantReservation[]`, la más próxima a vencer primero |
| POST | `/v1/restaurants/me/check-ins` | restaurant_admin | `{ code }` | 200 `{ reservationId, tableIdentifier, partySize, dinerName, checkedInAt }` · errores de 12.6 |
| PATCH | `/v1/tables/:id/status` · `PATCH /v1/tables/:id` · `POST /v1/tables/:id/deactivate` | restaurant_admin | igual que hoy | nuevos 409 `TABLE_HAS_ACTIVE_RESERVATION` / `TABLE_NOT_AVAILABLE_TO_DEACTIVATE` (12.2) |
| GET · PATCH · POST | `/v1/restaurants/me` (GET y PATCH) · `/v1/restaurants` (POST) | restaurant_admin | igual que hoy | ahora incluyen `activeReservationsCount` (número). Las tres respuestas siguen siendo iguales; en el POST vale 0 |
| GET | `/v1/table-logs` | restaurant_admin | igual que hoy | ahora incluye `source`; el usuario puede venir en `null` |

- Un `restaurant_admin` que llama a las rutas de diner, o un diner que llama a las de `restaurant_admin`, recibe los errores de rol que ya existen (`DINER_ACCOUNT` / `RESTAURANT_ACCOUNT`).

**`Reservation`** (la ve el comensal):
`{ id, code, status, partySize, createdAt, expiresAt, serverTime, cancelledAt, expiredAt, checkedInAt, restaurant: { id, name, address, latitude, longitude }, table: { identifier, capacity } }`
- `code` solo viene cuando `status = active`; en los demás estados es `null`.
- `cancelledAt`, `expiredAt` y `checkedInAt` vienen en `null` cuando no aplican.

**`RestaurantReservation`** (la ve el restaurante, nunca trae el código):
`{ id, status, partySize, dinerName, tableId, tableIdentifier, createdAt, expiresAt, serverTime }`
- `dinerName` sale del `displayName` del comensal y puede ser `null`. En ese caso la web muestra "Comensal", en la lista y en el mensaje de check-in confirmado (12.6).

**WebSocket** (Socket.IO, mismo host):

| Evento | Sala | Datos |
|---|---|---|
| `reservation.created` | `restaurant:{restaurantId}` | `RestaurantReservation` |
| `reservation.cancelled` · `reservation.expired` · `reservation.checked_in` | `restaurant:{restaurantId}` y `diner:{userId}` | `{ reservationId, status, tableId, at }` |
| `table.status_changed` | `restaurant:{restaurantId}` | `{ tableId, previousStatus, status, source }`. Se emite por cada fila nueva que entra a la bitácora, con los mismos valores: también en los cambios manuales, al desactivar y al reactivar. `status` y `previousStatus` pueden traer `inactive`, igual que en la bitácora |
| `availability.changed` | `diners` | sin cambios |

### 12.9 `errorCode` nuevos

| `errorCode` | HTTP | Dónde | Texto del cliente |
|---|---|---|---|
| `NO_TABLE_AVAILABLE` | 409 | `POST /reservations` | «Alguien acaba de tomar la última mesa. Prueba con otro restaurante.» |
| `ACTIVE_RESERVATION_EXISTS` | 409 | `POST /reservations` | «Ya tienes una reserva activa» + botón *Ver mi reserva* |
| `RESTAURANT_CLOSED` | 409 | `POST /reservations` | «Este restaurante acaba de cerrar.» |
| `RESERVATION_NOT_FOUND` | 404 | `GET /reservations/:id`, `POST /reservations/:id/cancel` | La app vuelve a la búsqueda |
| `RESERVATION_NOT_ACTIVE` | 409 | `POST /reservations/:id/cancel` | La app consulta `GET /reservations/:id` y muestra el estado real |
| `RESERVATION_CODE_NOT_FOUND` | 404 | `POST /restaurants/me/check-ins` | «No encontramos una reserva con ese código en tu restaurante.» |
| `RESERVATION_EXPIRED` | 409 | `POST /restaurants/me/check-ins` | `message` del backend |
| `RESERVATION_ALREADY_USED` | 409 | `POST /restaurants/me/check-ins` | `message` del backend |
| `RESERVATION_CANCELLED` | 409 | `POST /restaurants/me/check-ins` | «El comensal canceló esta reserva.» |
| `TABLE_HAS_ACTIVE_RESERVATION` | 409 | mesas (12.2) | ver 12.2 |
| `TABLE_NOT_AVAILABLE_TO_DEACTIVATE` | 409 | `POST /tables/:id/deactivate` | ver 12.2 |

Los 404 y 409 existentes de mesas siguen sin `errorCode`; no se cambian en este sprint.

### 12.10 Fuera de alcance del Sprint 3
- Que el restaurante cancele una reserva.
- Notificaciones push.
- Estado de cuenta y comisiones (Sprint 4).
- Límite de peticiones y de conexiones WebSocket (Sprint 4, seguridad).
- Adaptador de Redis para Socket.IO (Sprint 4, Azure).
- Extender el tiempo de una reserva.

### 12.11 Cuándo está listo cada cosa (backend en `develop`, desplegado en Render)

| Día | Qué queda listo |
|---|---|
| 1 | Este contrato. Mientras tanto, el front trabaja con datos de ejemplo que tengan exactamente estas formas |
| 2 | `POST /reservations`, `GET /reservations/active`, `GET /reservations/:id` y las reglas de mesas con reserva activa (12.2) |
| 3 | Cancelación, expiración automática, `GET /restaurants/me/reservations` y check-in (se puede probar en Swagger) |
| 4 | WebSocket con salas y eventos de reserva. Hasta entonces, consultar cada 30 s |
| 5 | Todo integrado en Render + Neon |
