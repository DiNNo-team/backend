# DiNNo — Backend

API del backend de **DiNNo**, una plataforma de microreservas de mesas en restaurantes con
disponibilidad en tiempo real. Está construido como un **monolito modular** con NestJS +
TypeScript: un único servicio desplegable, pero con los dominios del negocio separados en
módulos independientes bajo `src/modules/`.

## 1. Requisitos

- **Node.js 24.x** — versión fijada en [`.nvmrc`](.nvmrc) y en `engines.node` de
  [`package.json`](package.json). Con nvm: `nvm use`.
- **npm** (incluido con Node).
- Acceso a una base de datos **PostgreSQL en [Neon](https://neon.tech)** y a una instancia de
  **Redis en [Upstash](https://upstash.com)** — o las credenciales compartidas del equipo para
  el ambiente de desarrollo.

## 2. Instalación

```bash
git clone https://github.com/DiNNo-team/backend.git
cd backend
npm install
```

> **Importante: corre `npm install` antes que cualquier otro comando** (`start:dev`, `test`,
> `lint`, etc.), incluso si acabas de hacer `git pull` sobre un `node_modules` que ya tenías.
> Cada vez que `package.json` gana una dependencia nueva (por ejemplo, cuando se agregó
> `@nestjs/swagger`) hay que reinstalar — si no, los comandos fallan con errores como
> `Cannot find package '@nestjs/swagger'` porque el paquete está declarado pero no está en
> `node_modules`. Ya nos pasó una vez y rompió los tests en local.

Luego copia la plantilla de variables de entorno y complétala con tus credenciales reales:

```bash
cp .env.example .env
```

Edita `.env` con los valores reales (ver siguiente sección). **Nunca subas `.env` al
repositorio** — ya está en `.gitignore`.

> ⚠️ **Sin `DEV_USER_ENABLED=true` en tu `.env`, toda ruta protegida responde `401`.**
> Mientras llega la autenticación real (PBI 2), el usuario actual lo da el *usuario de
> desarrollo*. Ver [sección 10](#10-usuario-de-desarrollo).

## 3. Variables de entorno

Todas están documentadas con placeholders en [`.env.example`](.env.example):

| Variable | Obligatoria | Qué es | De dónde sale | Ejemplo (formato) |
|---|---|---|---|---|
| `PORT` | No (por defecto `3000`) | Puerto HTTP en el que escucha el servidor. | En Render lo asigna la plataforma automáticamente — **no la definas ahí**. | `3000` |
| `CORS_ORIGINS` | No (por defecto `http://localhost:5173`) | Lista de orígenes permitidos para peticiones cross-origin, separados por comas y **sin `/` final**. | La defines tú: el o los orígenes del frontend/mobile que van a consumir la API. | `http://localhost:5173,https://frontend-rose-gamma-96.vercel.app` |
| `DATABASE_URL` | **Sí** | Cadena de conexión de PostgreSQL. | Panel de **Neon** → tu proyecto → "Connection string". | `postgresql://usuario:password@host/nombre_db?sslmode=require` |
| `REDIS_URL` | **Sí** | Cadena de conexión de Redis. | Panel de **Upstash** → tu base de datos → "Connect" (usar la URL `rediss://...` con TLS). | `redis://default:password@host:puerto` |
| `DEV_USER_ENABLED` | No (por defecto apagado) | Activa el usuario de desarrollo. **Solo local:** se apaga solo en Render aunque esté en `true`. | La defines tú en tu `.env`. **No la definas en Render.** | `true` |
| `DEV_USER_ID` | Si `DEV_USER_ENABLED=true` | UUID (tabla `users`) del usuario de desarrollo por defecto. | Lo imprime `npm run seed`. | `3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f` |

La app usa `ConfigService.getOrThrow()` para leer `DATABASE_URL` y `REDIS_URL`: si falta
cualquiera de las dos, **no arranca**.

## 4. Arquitectura

- **Monolito modular.** El código de negocio vive bajo `src/modules/`, uno por dominio,
  registrado en [`src/app.module.ts`](src/app.module.ts). Hoy existen 5 módulos.
  `restaurant-operations` ya tiene controladores y servicios (mesas y edición del restaurante);
  `identity-access` ya tiene el usuario actual (guard, resolver y `UsersService`); los otros
  tres siguen vacíos:
  - `identity-access`
  - `restaurant-operations`
  - `reservations-checkin`
  - `search-availability`
  - `notifications`
- **PostgreSQL (Neon) vía TypeORM.** Configurado con `TypeOrmModule.forRootAsync()` en
  `app.module.ts`, usando `DATABASE_URL`. Si la cadena incluye `sslmode=require` (como la de
  Neon), se activa SSL automáticamente. `synchronize` está en `false` a propósito: los cambios
  de esquema van por migraciones, no por auto-sync.
- **Redis (Upstash) vía ioredis.** Cliente creado en
  [`src/config/redis.config.ts`](src/config/redis.config.ts) y expuesto en el contenedor de
  Nest bajo el token `REDIS_CLIENT`, para inyectarlo en cualquier módulo que lo necesite.
- **CORS por variable de entorno.** `app.setup.ts` lee `CORS_ORIGINS`, hace `split(',')` y usa
  el resultado como lista blanca de orígenes en `app.enableCors()`. Por ahora `credentials`
  queda en `false` (no hay auth por cookies/sesión). **Para agregar un nuevo origen** (por
  ejemplo cuando cambie la URL de despliegue del frontend en Vercel), edita la variable
  `CORS_ORIGINS` en el dashboard de Render — no hace falta tocar código.
- **Prefijo `/v1`.** Todas las rutas de la API están bajo `/v1` (`GET /v1/health`, etc.),
  definido como `API_PREFIX` en `app.setup.ts`.
- **Swagger en `/docs`.** La documentación OpenAPI se sirve en `/docs` (JSON en `/docs-json`),
  **fuera** del prefijo `/v1` — `SwaggerModule.setup()` se monta directo sobre el adaptador HTTP
  y no hereda el prefijo global.
- **Health check en `/v1/health`.** Responde `{"status":"ok","commit":"<sha>"}`; `commit` es el
  SHA que despliega Render (`RENDER_GIT_COMMIT`) y en local es `null`. Render lo usa para el
  *Health Check* del Web Service y el CI, para comprobar qué commit está sirviendo.

```
src/
├── main.ts              # Arranque: puerto, configuración HTTP
├── app.setup.ts         # Prefijo /v1, CORS y Swagger (compartido con las pruebas e2e)
├── app.module.ts         # Configuración, PostgreSQL (TypeORM), Redis y módulos
├── app.controller.ts    # GET /v1/health
├── config/               # Configuración de infraestructura (Redis)
└── modules/              # Módulos del monolito modular
    ├── identity-access/
    ├── restaurant-operations/
    ├── reservations-checkin/
    ├── search-availability/
    └── notifications/
```

## 5. Comandos

| Comando | Qué hace |
|---|---|
| `npm run start` | Arranca la app sin recarga automática. |
| `npm run start:dev` | Arranca en modo desarrollo, con recarga al cambiar archivos. |
| `npm run start:debug` | Igual que `start:dev`, con el inspector de Node activo. |
| `npm run build` | Compila el proyecto a `dist/` (`nest build`). |
| `npm run start:prod` | Ejecuta la build ya compilada (`node dist/main`). |
| `npm run lint` | Revisa `src/` y `test/` con oxlint. |
| `npm run typecheck` | Revisa los tipos de todo el proyecto, pruebas incluidas (`tsc --noEmit`). |
| `npm run format` | Formatea `src/` y `test/` con Prettier. |
| `npm run test` | Pruebas unitarias (Vitest). |
| `npm run test:watch` | Pruebas unitarias en modo watch. |
| `npm run test:cov` | Pruebas unitarias con reporte de cobertura. |
| `npm run test:e2e` | Pruebas e2e de la capa HTTP (prefijo, CORS, Swagger) — no requieren PostgreSQL ni Redis. |
| `npm run seed` | Crea los datos de prueba (ver [sección 9](#9-base-de-datos-migraciones-y-datos-de-prueba)). |
| `npm run migration:create -- src/migrations/<Nombre>` | Crea una migración vacía para escribir el SQL a mano. |
| `npm run migration:generate -- src/migrations/<Nombre>` | Genera una migración comparando las entidades con la base. **Solo Elizabeth.** |
| `npm run migration:run` | Aplica las migraciones pendientes. **Solo Elizabeth.** |
| `npm run migration:revert` | Deshace la última migración. **Solo Elizabeth.** |

> `npm run deploy` también existe en `package.json` (viene de `@nestjs/mau`, la plataforma
> propia de NestJS), pero **no es lo que usamos para desplegar**: el despliegue real es vía
> Render, descrito abajo.

## 6. Cómo verificar que funciona

Con las variables de entorno ya cargadas en `.env`:

```bash
npm run start:dev
```

En la consola deberían aparecer, entre los logs de Nest, estas dos líneas confirmando las
conexiones:

```
Redis conectado
PostgreSQL conectado
```

Y con el servidor arriba:

```bash
curl http://localhost:3000/v1/health
# {"status":"ok","commit":null}
```

También puedes abrir `http://localhost:3000/docs` para ver el contrato de la API en Swagger UI.

## 7. Despliegue

- Desplegado en **Render** como *Web Service*.
- **Auto-deploy activado**: cada push a la rama `develop` dispara un nuevo despliegue.
- **URL de producción:** https://dinno-backend.onrender.com
- **Variables de entorno** (`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`) se configuran
  directamente en el dashboard de Render — **no viven en el repositorio**. `PORT` no se define
  ahí: Render lo asigna en tiempo de ejecución.
- **Health Check Path:** `/v1/health`.
- Además del despliegue en sí (gestionado por Render), el workflow de GitHub Actions en
  [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) tiene dos jobs:
  - `checks` corre en cada PR hacia `develop` y en cada push a `develop`, con Node 24:
    `npm ci`, lint, typecheck, pruebas unitarias, pruebas e2e y build.
  - `verify-deployment` corre solo en cada push a `develop`, si `checks` pasa: espera hasta
    15 minutos a que `/v1/health` devuelva el commit del push y registra el resultado en la
    pestaña **Deployments** de GitHub (con la Deployments API y el `GITHUB_TOKEN` automático de
    Actions — no despliega nada por sí mismo, Render ya lo hizo).

## 8. Integración con frontend y mobile

- El **frontend** (React + Vite, desplegado en Vercel) y el **mobile** (Expo) consumen esta API
  a través de las variables `VITE_API_URL` y `EXPO_PUBLIC_API_URL` respectivamente, apuntando a
  `https://dinno-backend.onrender.com/v1` en producción (o `http://localhost:3000/v1` en local).
- Si cambia la URL de despliegue del frontend o del mobile (por ejemplo, un nuevo dominio de
  Vercel), hay que **actualizar `CORS_ORIGINS` en el dashboard de Render** agregando el nuevo
  origen a la lista separada por comas — de lo contrario el navegador bloqueará las peticiones
  por CORS aunque el backend esté funcionando bien.

## 9. Base de datos: migraciones y datos de prueba

- El esquema vigente, sus reglas y las decisiones están en [`docs/database.md`](docs/database.md).
- **Las migraciones las corre solo Elizabeth**: en el Sprint 1 compartimos una sola base en
  Neon. El porqué y cómo crear la tuya está en el [CLAUDE.md](CLAUDE.md) (sección 10,
  "Migraciones").
- **Datos de prueba:** `npm run seed` compila y crea, si no existen:
  - un usuario **sin restaurante** (para probar el onboarding);
  - `demo@example.com`, también sin restaurante, **reservado para la demo del Día 7: no lo uses
    para probar**;
  - un usuario con el restaurante **Casa 72** y 8 mesas (Disponibles, Reservadas, Ocupadas y una
    Inactiva).

  Se puede correr varias veces: no duplica nada. Al final imprime los ids de los tres usuarios
  para usarlos en `DEV_USER_ID`. Como la base es compartida, normalmente ya están creados:
  pide los ids en el grupo antes de correrlo. No es una migración, así que nunca llega a Render.

  Después de probar un registro, el usuario de onboarding queda con restaurante. Para
  devolverlo a su estado inicial, ver [Reiniciar los datos de prueba](docs/database.md#reiniciar-los-datos-de-prueba).

## 10. Usuario de desarrollo

Hasta que la autenticación real esté lista (PBI 2), el usuario actual de cada petición lo
resuelve un usuario de desarrollo que se lee **de la base** en cada petición.

- `DEV_USER_ENABLED=true` lo activa. **Sin esto, toda ruta protegida responde `401`.**
- `DEV_USER_ID` es el UUID del usuario por defecto.
- La cabecera `x-dev-user-id` cambia de usuario en una petición, sin reiniciar el servidor. Recibe
  un UUID; si tiene mal formato, la respuesta es `401`:

  ```bash
  curl http://localhost:3000/v1/<ruta> -H "x-dev-user-id: 3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f"
  ```

- En Render no funciona aunque la variable esté en `true`. Al arrancar en local con el usuario
  de desarrollo activo, Nest deja un aviso en la consola.
- En el código: `@UseGuards(CurrentUserGuard)` y `@CurrentUser() user: CurrentUserData`,
  importados desde `src/modules/identity-access/index.ts`. El `restaurantId` sale siempre de
  `user`, nunca del body, query ni parámetros de ruta.
