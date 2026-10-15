# CLAUDE.md · DiNNo · backend

> Instrucciones para Claude Code y para el equipo. Las secciones 1 a 10 son **iguales en los tres repositorios** (backend, frontend, mobile); la sección 11 es propia de este repositorio.
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

**Sprint 2 (actual): Búsqueda y disponibilidad para el comensal (15–21 oct). Sprint 1 cerrado: Restaurante operativo.** Un restaurante puede iniciar sesión, registrar y editar sus datos, crear y administrar mesas, cambiar su estado, marcarse como abierto o cerrado y ver la bitácora, todo en el ambiente desplegado.

---

## 2. Antes de empezar cualquier tarea

1. **Pregunta qué PBI o tarea de Azure DevOps se está trabajando**, si la persona no lo dijo. No trabajes sin saber el alcance.
2. **Si no tienes en el contexto el manual de identidad v1.1 ni el plan del Sprint 1, pídelos** antes de tocar algo visual o algo que dependa de otra persona. No inventes colores, componentes, textos ni flujos.
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
- **Diseño:** el manual de identidad v1.1 manda sobre cualquier otra preferencia. Un solo kit de componentes; nadie crea estilos propios.
- **API:** prefijo `/v1`, contrato documentado en Swagger (`/docs`).
- **Base de datos:** cambios de esquema solo con migraciones; nunca `synchronize`.
- **Identificador de mesa:** corto ("04", "T1") y se muestra "Mesa 04"; "4", "04" y "Mesa 4" son la misma mesa; máximo 10 caracteres; en la interfaz se llama "Identificador" (manual 12.4).
- **Bitácora de mesas:** cambiar el estado, desactivar (`<estado>` → `inactive`) y reactivar (`inactive` → `available`) se registran; editar el identificador o la capacidad no.
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
- **Lista de restaurantes habilitados** = filas de `users` con rol `restaurant_admin`. Para habilitar un correo se inserta una fila (ver `docs/database.md` del backend). No hay registro público de restaurantes. Por ahora el único correo real habilitado es `dinnoteam2026@gmail.com`.
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

- **Endpoints de restaurante:** todos los del Sprint 1 (`/v1/restaurants`, `/v1/restaurants/me*`, `/v1/tables*`, `/v1/table-logs`) y `/v1/geocode`.
- **Endpoints de comensal:** `/v1/search/*` y `/v1/restaurants/:id/public`.
- **Ambos roles:** `GET /v1/me`.
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
| GET | `/geocode` | restaurant_admin | `address` (3–255 caracteres) | 200 `{ latitude, longitude, formattedAddress }` · 404 `ADDRESS_NOT_FOUND` · 503 `GEOCODING_UNAVAILABLE` |
| POST | `/restaurants` | restaurant_admin | agrega `latitude?`, `longitude?` | la respuesta agrega `latitude`, `longitude` (number \| null) |
| PATCH | `/restaurants/me` | restaurant_admin | agrega `latitude?`, `longitude?` | igual que arriba |
| GET | `/restaurants/me` | restaurant_admin | — | agrega `latitude`, `longitude` (number \| null) |

**Reglas de los campos:**
- `latitude` y `longitude` son `number` en JSON, con hasta 6 decimales. Se envían **los dos o ninguno** (si llega solo uno → 400). Deben estar dentro de Bogotá: latitud entre 4.45 y 4.85, longitud entre -74.25 y -73.95 (fuera → 400). En el backend las coordenadas son opcionales para no romper la web actual; la obligatoriedad al registrar la impone el formulario web.
- Búsqueda: `lat`/`lng` y `zone` son excluyentes (los dos o ninguno → 400). `lat`/`lng` pueden estar fuera de Bogotá (simplemente no habrá resultados). Una `zone` desconocida, una `category` inválida, un `radiusKm` fuera de la lista o un `partySize` fuera de rango → 400 con un mensaje en español.
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
- Socket.IO en el mismo host del backend (ruta por defecto `/socket.io`). Conexión: `io(BASE_URL, { auth: { token: <token de Firebase> } })`. Solo se aceptan comensales; si no, la conexión se rechaza con `connect_error`, cuyo `message` es un código: `UNAUTHORIZED` (token ausente, inválido o vencido; solo existe en el WebSocket, en HTTP es el 401 sin `errorCode`), `PROFILE_REQUIRED` o `RESTAURANT_ACCOUNT`.
- Evento del servidor `availability.changed`: `{ restaurantId, availability, isOpenNow, isSearchable }`. Se envía a todos los comensales conectados.
  - `isSearchable` = cumple las reglas para aparecer en la búsqueda (sin filtros). Si es `false` → la app lo quita de la lista y del mapa (el detalle muestra `closed` si `isOpenNow` es `false`). Si es `true` y el restaurante no estaba en la lista → la app vuelve a consultar la búsqueda.
- Se emite cuando: cambia el estado de una mesa, se crea, desactiva o reactiva una mesa, se abre o cierra el restaurante, o se edita su horario o ubicación. Solo después de que la operación queda guardada.
- Respaldo en la app: vuelve a consultar al regresar al primer plano, al reconectarse y cada 60 s en resultados y detalle.

### Cuándo está listo cada contrato en `develop`
| Qué | Día |
|---|---|
| Roles, `GET /me`, `POST /diners/me`, coordenadas en la base | Jue 15 (noche) |
| Búsqueda, zonas, disponibilidad, filtros, detalle público, `GET /geocode`, coordenadas en POST/PATCH | Vie 16 |
| WebSocket `availability.changed` | Sáb 17 |
| Mientras tanto | usar datos de ejemplo con la forma exacta de este contrato |

---

## 11. Este repositorio: backend (NestJS)

**Antes de empezar cualquier tarea, lee [`AVISOS.md`](AVISOS.md):** cambios recientes que afectan al equipo y acciones pendientes.

### Versiones (revisa antes de usar una API)
NestJS **12**, TypeORM **1.x**, TypeScript **6**, Node **24**, Vitest **4**. Lee `package.json` y consulta https://docs.nestjs.com y https://typeorm.io para la versión instalada; no confíes en APIs de versiones anteriores.

### Comandos
```bash
npm install          # siempre primero, y después de cada pull
npm run start:dev    # servidor en modo desarrollo (http://localhost:3000)
npm run build        # compila a dist/
npm run lint         # oxlint sobre src/ y test/ (no revisa tipos)
npm run typecheck    # tsc --noEmit con el tsconfig.json raíz: revisa tipos también en pruebas y test/, que el build excluye
npm run format       # prettier (comillas simples, trailing commas)
npm run test         # pruebas unitarias (Vitest)
npm run test:e2e     # pruebas e2e de la capa HTTP (no requieren base de datos)
npm run test:cov     # cobertura
```
**Antes de dar una tarea por terminada:** `npm run lint`, `npm run typecheck`, `npm run test` y `npm run build` sin errores.

### Arquitectura: monolito modular
- El código de negocio vive en `src/modules/<dominio>/`, un módulo por dominio, registrado en `src/app.module.ts`.
- Cada módulo es dueño de sus controladores, servicios, entidades y DTOs. **Entre módulos solo se usan los providers que el otro módulo exporta**; nunca se importa desde las carpetas internas de otro módulo.
- **API pública de cada módulo:** su `index.ts`. Hoy la tienen `identity-access`, `search-availability` y `restaurant-operations`. La de `restaurant-operations` (`restaurant-operations/index.ts`) exporta `RestaurantOperationsModule`, `RESTAURANT_CATEGORIES` y `RestaurantCategory`; las categorías siguen viviendo en `restaurants/restaurant.entity.ts`. Lo que otro módulo necesite de `restaurant-operations` se agrega a ese `index.ts`, nunca se importa de sus carpetas.
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

Los módulos `reservations-checkin`, `search-availability` y `notifications` existen pero no se tocan en el Sprint 1.

### Configuración y variables de entorno
- **Nunca leas `process.env` en el código de una funcionalidad:** usa `ConfigService` (`getOrThrow` para lo obligatorio).
- Variables actuales (ver `.env.example`): `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `PORT` (solo local), `DEV_USER_ENABLED`, `DEV_USER_ID`, `RENDER`, `NODE_ENV`, `RENDER_GIT_COMMIT` y `FIREBASE_PROJECT_ID`.
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
- `src/data-source.ts` es solo para el CLI y el seed, y es el **único** archivo que lee `process.env` directo, porque vive fuera de la inyección de dependencias de Nest. Es una excepción consciente a la regla de "Configuración y variables de entorno".

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

### Bitácora de mesas (`restaurant-operations/table-logs/`, Sergio)
- **Contrato:** la clase abstracta `TableStatusLog` (`tables/table-status-log.ts`), con un método `record(change, manager)`. `change` es `TableStatusChange`: `tableId`, `previousStatus`, `newStatus` (`TableLogStatus`: `available`, `reserved`, `occupied` o `inactive`), `userId` y `changedAt`. El contrato vive en `tables/` y `table-logs/` lo implementa, así que `tables/` nunca importa de `table-logs/`.
- **Implementación real:** `DbTableStatusLog` (`table-logs/table-logs.recorder.ts`), registrada en `restaurant-operations.module.ts` como `{ provide: TableStatusLog, useClass: DbTableStatusLog }`. Inserta una fila en `table_logs` (entidad `TableLog`, `table-logs/table-log.entity.ts`).
- **Cómo usarla desde otro servicio de mesas:** inyecta `TableStatusLog` (nunca `DbTableStatusLog` ni el repositorio de `TableLog`) y llama a `record(...)` **dentro de la misma transacción** que cambia la mesa, pasándole el `manager` de esa transacción. No atrapes su error: si el insert falla, la transacción se revierte y la mesa queda como estaba. Ejemplo completo: `updateStatus` y `changeActive` en `tables.service.ts`.
- **Qué se registra:** cambiar el estado (`<anterior>` → `<nuevo>`), desactivar (`<estado real>` → `inactive`) y reactivar (`inactive` → `available`). **Qué no:** crear una mesa, editar identificador o capacidad, y pedir el estado que la mesa ya tiene (responde 200 sin escribir nada).
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
- Forma de los errores: `{ statusCode, message, error }` y, a veces, `errorCode` (`src/common/dto/error-response.dto.ts`). **Lleva `errorCode` el error donde el front tiene que ramificar según el motivo; los demás no lo llevan.** Hoy existen `EMAIL_NOT_VERIFIED` (401 del correo sin verificar), `RESTAURANT_REQUIRED` (403 del usuario sin restaurante) los cuatro códigos de cuenta del Sprint 2 (`ACCOUNT_NOT_ENABLED`, `PROFILE_REQUIRED`, `DINER_ACCOUNT`, `RESTAURANT_ACCOUNT`; tabla en la sección 10, textos en `identity-access/roles/account-errors.ts`) y `RESTAURANT_NOT_FOUND` (404 del detalle público, `search-availability/public-restaurant/restaurant-not-found.ts`). Se usa la opción nativa de Nest 12 (`HttpExceptionOptions.errorCode`): `new ForbiddenException(mensaje, { errorCode: '...' })`. No se arma el cuerpo a mano ni se crea un campo propio.
- **Un error no controlado** (no es una excepción HTTP: se cae la base, un bug) responde `500` con la forma de Nest y el mensaje en español "No pudimos completar la acción. Intenta de nuevo en un momento.", sin `errorCode`. El detalle real (mensaje, stack) **solo va al log del servidor, nunca al cliente**. Lo hace el filtro global `src/common/filters/unhandled-exception.filter.ts`, registrado en `app.setup.ts`: nadie monta su propio manejo de errores genéricos, y las excepciones HTTP que lanzamos pasan sin cambios.
- No cambies la forma de una respuesta existente sin avisar (sección 7).

### Estado abierto/cerrado del restaurante (`restaurant-operations/restaurants/restaurant-status.*`, Sergio)
- **Columna:** `restaurants.is_open` (`boolean`, NOT NULL, por defecto `true`), propiedad `isOpen` de `Restaurant`. Migración `1791342586330-AddRestaurantIsOpen`.
- **`GET /v1/restaurants/me/status`:** no recibe nada. Responde `200` con `{ "isOpen": boolean }` (`RestaurantStatusResponseDto`).
- **`PATCH /v1/restaurants/me/status`:** recibe `{ "isOpen": boolean }` (`UpdateRestaurantStatusDto`; un texto `"true"`, `null`, un campo faltante o un campo de más dan `400`). Responde `200` con `{ "isOpen": boolean }`, el estado después del cambio. Enviar el estado que ya tiene responde `200` igual.
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
  - En `lat`, `lng` y `partySize` solo valen números escritos en decimal (`toNumberOrNaN`, en `search-availability/location/location-fields.ts`): vacío, hexadecimal (`0x10`), exponentes (`1e1`), `Infinity` o `+5` dan `400`, nunca `0` ni otro número.
- **Validación:** `dto/search-restaurants-query.dto.ts`. La regla del origen (`lat`/`lng` juntas **o** `zone`, nunca las dos) es `searchOriginProblem` y va como decorador sobre `zone`, que a propósito no lleva `@IsOptional`.
- **Flujo** (`RestaurantSearchService.search`): centro (ubicación o centro de la zona) → `RestaurantCandidatesReader.findWithin(boundingBox(...), { category })`, una sola consulta de solo lectura con el prefiltro por rectángulo → `haversineKm` exacta, fuera los que pasan el radio, orden por distancia y desempate por `id` → **una** llamada a `AvailabilityService.getForRestaurants(ids, { partySize })` → solo `isSearchable` → máximo 50. `distanceKm` se redondea a 2 decimales al final; el filtro usa la distancia exacta.
- **Geometría** (`geo.ts`, pura): `haversineKm` (radio 6371,0088 km) y `boundingBox`, que siempre contiene el círculo. Los km por grado salen del mismo radio (~111,195 km): con 111,32 km el rectángulo se queda corto y pierde el borde del círculo.
- **Pruebas:** unitarias de `geo`, `zones`, el DTO, el lector y el servicio; `test/search.e2e-spec.ts` monta el módulo con una base simulada que aplica `Between` e `In`.

### Detalle público (`search-availability/public-restaurant/`, Elizabeth)
- **Ruta:** `GET /v1/restaurants/:id/public` (`PublicRestaurantController`, `@Roles(UserRole.DINER)` + `CurrentUserGuard`), con `lat` y `lng` opcionales (juntas o ninguna). Convive con las rutas de `restaurant-operations` bajo `/restaurants` porque ninguna de ellas termina en `/:id/public`; `test/public-restaurant.e2e-spec.ts` monta los dos módulos y lo prueba.
- **Ubicación del comensal:** `lat` y `lng` usan los mismos campos que la búsqueda (`LatitudeField`, `LongitudeField` y `LocationPair` en `search-availability/location/location-fields.ts`), con los mismos mensajes.
- **Flujo** (`PublicRestaurantService.getById`): en paralelo, `PublicRestaurantReader.findProfile(id)` (solo lectura con `find` por nombre de entidad: datos, coordenadas y horarios en `HH:MM`, de lunes a domingo, igual que `GET /restaurants/me`) y `AvailabilityService.getForRestaurant(id)`. No recalcula nada: `isOpenNow` y `availability` (que aquí **sí** puede ser `closed`) salen tal cual. `distanceKm` (`haversineKm` + `roundKm`) solo si llegan `lat` y `lng`; si no, la propiedad no aparece.
- **404 `RESTAURANT_NOT_FOUND`** ("Este restaurante ya no está disponible."), en un solo lugar (`restaurant-not-found.ts`), en tres casos: el `:id` no es un UUID válido (lo revisa `ParseUUIDPipe` antes de consultar; no es 400 porque la app solo maneja el 404), el restaurante no existe, o no tiene coordenadas.

### Pruebas
- Vitest. Pruebas unitarias junto al código (`*.spec.ts`) y e2e en `test/`.
- Cada servicio nuevo con pruebas de casos felices y de error (por ejemplo: mesa de otro restaurante, datos inválidos, mesa inactiva).

### Despliegue
- **Render**, con despliegue automático en cada push a `develop`. URL: https://dinno-backend.onrender.com (health: `/v1/health`).
- `.github/workflows/ci-cd.yml` tiene dos jobs. `checks` corre en cada PR hacia `develop` y en cada push a `develop`: Node 24, `npm ci`, lint, typecheck, test, test:e2e y build. `verify-deployment` corre solo en cada push a `develop`, después de `checks`, y espera a que `/v1/health` devuelva el commit del push.
- `PORT` lo asigna Render; no lo fijes. Las variables se configuran en el panel de Render, nunca en el repositorio.

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
