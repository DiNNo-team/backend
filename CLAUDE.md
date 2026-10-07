# CLAUDE.md · DiNNo · backend

> Instrucciones para Claude Code y para el equipo. Las secciones 1 a 9 son **iguales en los tres repositorios** (backend, frontend, mobile); la sección 10 es propia de este repositorio.
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

**Sprint 1 (actual): “Restaurante operativo”.** Un restaurante puede iniciar sesión, registrar y editar sus datos, crear y administrar mesas, cambiar su estado, marcarse como abierto o cerrado y ver la bitácora, todo en el ambiente desplegado.

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
- **Autenticación:** se propone Firebase Authentication, **pendiente de confirmar** (lo define Jacobo). No instales ni configures un proveedor de autenticación hasta que el equipo lo confirme. El restaurante y el usuario actual se obtienen siempre de la sesión, nunca de lo que envía el cliente.
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

## 10. Este repositorio: backend (NestJS)

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
- Variables actuales (ver `.env.example`): `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `PORT` (solo local), `DEV_USER_ENABLED`, `DEV_USER_ID`, `RENDER`, `NODE_ENV` y `RENDER_GIT_COMMIT`. Las de autenticación se agregan en la tarea de Jacobo, cuando se confirme el proveedor.
  - **Obligatorias:** `DATABASE_URL` y `REDIS_URL`; si faltan, la app no arranca (`getOrThrow`). Las demás son opcionales.
  - `DEV_USER_ENABLED=true` activa el usuario de desarrollo y `DEV_USER_ID` es el uuid del usuario por defecto. Solo local: sin ellas, toda ruta protegida responde `401`.
  - `RENDER` (la define Render) y `NODE_ENV=production` apagan el usuario de desarrollo aunque `DEV_USER_ENABLED` sea `true`. No se definen a mano.
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

### Redis (Upstash)
Cliente `ioredis` en `src/config/redis.config.ts`, inyectable con el token `REDIS_CLIENT`. No se usa en el Sprint 1 salvo que una tarea lo pida.

### API
- Todas las rutas bajo **`/v1`** (definido en `app.setup.ts`). Health check: `GET /v1/health`.
- **Swagger en `/docs`** (fuera del prefijo `/v1`). Toda ruta nueva queda documentada con sus DTOs y respuestas: es el contrato con web y mobile.
- Rutas en inglés, sustantivos en plural y `kebab-case` (por ejemplo `/v1/restaurants/me`, `/v1/tables/:id/status`).
- **Toda entrada se valida en el backend**, aunque la web también valide, con `class-validator` y `class-transformer`: decoradores sobre el DTO, cada uno con su `message` en español que diga cómo corregir. El `ValidationPipe` es global (en `app.setup.ts`, con `whitelist`, `forbidNonWhitelisted` y `transform`): **cualquier campo que no esté en el DTO se rechaza con 400**, en todos los endpoints.
- Errores con las excepciones HTTP de Nest (`BadRequestException`, `NotFoundException`, `ForbiddenException`…) y un mensaje claro. Nunca se devuelve un error interno, una consulta SQL ni un stack trace.
- Forma de los errores: `{ statusCode, message, error }` y, a veces, `errorCode` (`src/common/dto/error-response.dto.ts`). **Lleva `errorCode` el error donde el front tiene que ramificar según el motivo; los demás no lo llevan.** Hoy solo `RESTAURANT_REQUIRED` (403 del usuario sin restaurante). Se usa la opción nativa de Nest 12 (`HttpExceptionOptions.errorCode`): `new ForbiddenException(mensaje, { errorCode: '...' })`. No se arma el cuerpo a mano ni se crea un campo propio.
- **Un error no controlado** (no es una excepción HTTP: se cae la base, un bug) responde `500` con la forma de Nest y el mensaje en español "No pudimos completar la acción. Intenta de nuevo en un momento.", sin `errorCode`. El detalle real (mensaje, stack) **solo va al log del servidor, nunca al cliente**. Lo hace el filtro global `src/common/filters/unhandled-exception.filter.ts`, registrado en `app.setup.ts`: nadie monta su propio manejo de errores genéricos, y las excepciones HTTP que lanzamos pasan sin cambios.
- No cambies la forma de una respuesta existente sin avisar (sección 7).

### Estado abierto/cerrado del restaurante (`restaurant-operations/restaurants/restaurant-status.*`, Sergio)
- **Columna:** `restaurants.is_open` (`boolean`, NOT NULL, por defecto `true`), propiedad `isOpen` de `Restaurant`. Migración `1791342586330-AddRestaurantIsOpen`.
- **`GET /v1/restaurants/me/status`:** no recibe nada. Responde `200` con `{ "isOpen": boolean }` (`RestaurantStatusResponseDto`).
- **`PATCH /v1/restaurants/me/status`:** recibe `{ "isOpen": boolean }` (`UpdateRestaurantStatusDto`; un texto `"true"`, `null`, un campo faltante o un campo de más dan `400`). Responde `200` con `{ "isOpen": boolean }`, el estado después del cambio. Enviar el estado que ya tiene responde `200` igual.
- Los dos: el restaurante sale siempre de la sesión (no hay id en la ruta ni en el body); `401` sin sesión y `403` con `errorCode: "RESTAURANT_REQUIRED"` si el usuario no tiene restaurante (`requireRestaurant`).
- **Es manual en el Sprint 1:** no depende de `restaurant_schedules`. La confirmación de cerrar con mesas reservadas (y el conteo de esas mesas) la hace la web con `GET /v1/tables`; el endpoint no la pide ni la devuelve.
- Es independiente de `GET`/`PATCH /v1/restaurants/me`: `RestaurantResponseDto` no incluye `isOpen`.

### Pruebas
- Vitest. Pruebas unitarias junto al código (`*.spec.ts`) y e2e en `test/`.
- Cada servicio nuevo con pruebas de casos felices y de error (por ejemplo: mesa de otro restaurante, datos inválidos, mesa inactiva).

### Despliegue
- **Render**, con despliegue automático en cada push a `develop`. URL: https://dinno-backend.onrender.com (health: `/v1/health`).
- `.github/workflows/ci-cd.yml` tiene dos jobs. `checks` corre en cada PR hacia `develop` y en cada push a `develop`: Node 24, `npm ci`, lint, typecheck, test, test:e2e y build. `verify-deployment` corre solo en cada push a `develop`, después de `checks`, y espera a que `/v1/health` devuelva el commit del push.
- `PORT` lo asigna Render; no lo fijes. Las variables se configuran en el panel de Render, nunca en el repositorio.
