# CLAUDE.md · DiNNo · backend

> Instrucciones para Claude Code y para el equipo. Las secciones 1 a 9 son **iguales en los tres repositorios** (backend, frontend, mobile); la sección 10 es propia de este repositorio.
> Si una regla cambia, se cambia en los tres repos en el mismo PR o en PRs del mismo día, y se avisa al equipo.

## 1. Contexto del proyecto

**DiNNo**: plataforma de microreservas de mesas en restaurantes con disponibilidad inmediata. Promesa: *“Dile no a la espera.”*

| Repositorio (org `DiNNo-team`) | Qué es | Stack | Despliegue |
|---|---|---|---|
| `backend` | API (monolito modular) | NestJS 12 + TypeORM + PostgreSQL (Neon) + Redis (Upstash) | Render |
| `frontend` | Dashboard web del restaurante | React 19 + Vite 8 + Tailwind CSS v4 | Vercel |
| `mobile` | App del comensal | Expo SDK 57 + Expo Router + NativeWind v4 (Tailwind v3) | Expo / EAS |

**Equipo y responsables:**

| Persona | Rol en el Sprint 1 |
|---|---|
| Elizabeth | Backend base, backend de mesas y de la edición del restaurante, integración y demo. Revisa los PR de backend |
| Sebastián | Kit visual (`components/ui`), pantallas de mesas. Revisa los PR de web y mobile |
| Santiago | Registro del restaurante (onboarding) |
| Jacobo | Autenticación con Firebase y control de acceso; pantalla del restaurante |
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
- No escribas secretos, contraseñas, tokens, llaves de Firebase ni cadenas de conexión en el código, los logs, los comentarios ni los mensajes de commit.
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
- **Autenticación:** Firebase Authentication (correo y contraseña; Google opcional). No hay registro público en el Sprint 1: las cuentas se crean en Firebase. El restaurante y el usuario actual se obtienen siempre de la sesión, nunca de lo que envía el cliente.
- **Estados de mesa:** Disponible, Reservada y Ocupada. *Inactiva* es una mesa desactivada, no un estado del control. “Pocas mesas” es disponibilidad del restaurante para el comensal, no un estado de mesa.
- **Estado del restaurante:** Abierto o Cerrado.
- **Diseño:** el manual de identidad v1.1 manda sobre cualquier otra preferencia. Un solo kit de componentes; nadie crea estilos propios.
- **API:** prefijo `/v1`, contrato documentado en Swagger (`/docs`).
- **Base de datos:** cambios de esquema solo con migraciones; nunca `synchronize`.
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

### Versiones (revisa antes de usar una API)
NestJS **12**, TypeORM **1.x**, TypeScript **6**, Node **24**, Vitest **4**. Lee `package.json` y consulta https://docs.nestjs.com y https://typeorm.io para la versión instalada; no confíes en APIs de versiones anteriores.

### Comandos
```bash
npm install          # siempre primero, y después de cada pull
npm run start:dev    # servidor en modo desarrollo (http://localhost:3000)
npm run build        # compila a dist/
npm run lint         # oxlint sobre src/ y test/
npm run format       # prettier (comillas simples, trailing commas)
npm run test         # pruebas unitarias (Vitest)
npm run test:e2e     # pruebas e2e de la capa HTTP (no requieren base de datos)
npm run test:cov     # cobertura
```
**Antes de dar una tarea por terminada:** `npm run lint`, `npm run test` y `npm run build` sin errores.

### Arquitectura: monolito modular
- El código de negocio vive en `src/modules/<dominio>/`, un módulo por dominio, registrado en `src/app.module.ts`.
- Cada módulo es dueño de sus controladores, servicios, entidades y DTOs. **Entre módulos solo se usan los providers que el otro módulo exporta**; nunca se importa desde las carpetas internas de otro módulo.
- La configuración global (ConfigModule, TypeORM, Redis) vive en `src/app.module.ts` y `src/config/`. La configuración HTTP (prefijo, CORS, Swagger) vive en `src/app.setup.ts`.

**Dónde va cada cosa del Sprint 1:**

| Funcionalidad | Módulo | Subcarpeta sugerida | Dueño |
|---|---|---|---|
| Usuarios, Firebase, control de acceso por rol | `identity-access` | `users/`, `auth/` | Jacobo |
| Datos del restaurante (registro y edición) | `restaurant-operations` | `restaurants/` | Santiago (registro), Elizabeth (edición) |
| Estado abierto/cerrado del restaurante | `restaurant-operations` | `restaurants/` (su propio archivo de servicio o controlador) | Sergio |
| Mesas (crear, consultar, cambiar estado) | `restaurant-operations` | `tables/` | Elizabeth |
| Editar y desactivar mesas | `restaurant-operations` | `tables/` | Sebastián |
| Bitácora de cambios de mesas | `restaurant-operations` | `table-logs/` | Sergio |

Los módulos `reservations-checkin`, `search-availability` y `notifications` existen pero no se tocan en el Sprint 1.

### Configuración y variables de entorno
- **Nunca leas `process.env` en el código de una funcionalidad:** usa `ConfigService` (`getOrThrow` para lo obligatorio).
- Variables actuales (ver `.env.example`): `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `PORT` (solo local). Las de Firebase se agregan en la tarea de Jacobo.
- `CORS_ORIGINS`: lista separada por comas, sin `/` final. **Nunca la abras a `*`.** Si un origen nuevo necesita acceso, se agrega en Render.

### Base de datos (PostgreSQL en Neon, TypeORM)
- `synchronize: false` y `autoLoadEntities: true`. **Todo cambio de esquema va por migraciones de TypeORM.** Si todavía no existe la configuración de migraciones, no la improvises: es parte de la tarea base de Elizabeth; pregúntale.
- **Nunca corras migraciones contra Neon sin confirmación.**
- Convenciones: entidad en PascalCase singular (`Restaurant`); tabla y columnas en `snake_case`; la tabla en plural. Toda tabla con `id`, `created_at` y `updated_at`.
- **El esquema vigente se documenta en `docs/database.md`.** Si cambias una tabla, actualízalo en el mismo PR y avisa al equipo.
- Cada consulta de datos de un restaurante filtra por el restaurante del usuario de la sesión.

### Redis (Upstash)
Cliente `ioredis` en `src/config/redis.config.ts`, inyectable con el token `REDIS_CLIENT`. No se usa en el Sprint 1 salvo que una tarea lo pida.

### API
- Todas las rutas bajo **`/v1`** (definido en `app.setup.ts`). Health check: `GET /v1/health`.
- **Swagger en `/docs`** (fuera del prefijo `/v1`). Toda ruta nueva queda documentada con sus DTOs y respuestas: es el contrato con web y mobile.
- Rutas en inglés, sustantivos en plural y `kebab-case` (por ejemplo `/v1/restaurants/me`, `/v1/tables/:id/status`).
- **Toda entrada se valida en el backend**, aunque la web también valide. Si el proyecto todavía no tiene una librería de validación, pregunta a Elizabeth antes de instalar una.
- Errores con las excepciones HTTP de Nest (`BadRequestException`, `NotFoundException`, `ForbiddenException`…) y un mensaje claro. Nunca se devuelve un error interno, una consulta SQL ni un stack trace.
- No cambies la forma de una respuesta existente sin avisar (sección 7).

### Pruebas
- Vitest. Pruebas unitarias junto al código (`*.spec.ts`) y e2e en `test/`.
- Cada servicio nuevo con pruebas de casos felices y de error (por ejemplo: mesa de otro restaurante, datos inválidos, mesa inactiva).

### Despliegue
- **Render**, con despliegue automático en cada push a `develop`. URL: https://dinno-backend.onrender.com (health: `/v1/health`).
- `.github/workflows/ci-cd.yml` corre build y pruebas en cada push a `develop`.
- `PORT` lo asigna Render; no lo fijes. Las variables se configuran en el panel de Render, nunca en el repositorio.
