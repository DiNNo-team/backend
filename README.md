# DiNNo — Backend

API de DiNNo, plataforma de ocupación en tiempo real y microreservas para restaurantes.
Monolito modular en **NestJS + TypeScript**, desplegado temporalmente en **Render** (plan free),
con **PostgreSQL en Neon** y **Redis/Valkey** para estado efímero y tiempo real.

## Requisitos

- **Node.js 24 LTS** (definido en `.nvmrc` y en `engines` de `package.json`). Con nvm: `nvm use`.
- **npm** (incluido con Node).
- Una base de datos **PostgreSQL** (Neon para el ambiente compartido, o una local).
- Un servidor **Redis/Valkey** (Docker en local, servicio administrado en el ambiente temporal).
- Opcional: **Docker Desktop** para levantar Redis/Valkey en local.

## Instalación

```bash
git clone https://github.com/DiNNo-team/backend.git
cd backend
nvm use            # opcional, usa Node 24
npm ci
cp .env.example .env
```

Luego edita `.env` con tus valores reales. **Nunca subas `.env` al repositorio** (ya está en `.gitignore`).

## Variables de entorno

| Variable | Obligatoria | Descripción | Ejemplo local |
|---|---|---|---|
| `PORT` | No (por defecto `3000`) | Puerto HTTP. En Render lo asigna la plataforma. | `3000` |
| `CORS_ORIGINS` | No (por defecto `http://localhost:5173`) | Orígenes permitidos, separados por comas y **sin `/` final**. | `http://localhost:5173` |
| `DATABASE_URL` | **Sí** | Cadena de conexión PostgreSQL. Si incluye `sslmode=require` se activa SSL (Neon). | `postgresql://usuario:password@host/db?sslmode=require` |
| `REDIS_URL` | **Sí** | URL de Redis/Valkey. | `redis://localhost:6379` |

> La aplicación **no arranca** si faltan `DATABASE_URL` o `REDIS_URL`, y espera a conectarse a
> PostgreSQL antes de empezar a responder peticiones.

## Servicios locales

**PostgreSQL:** usa la base de datos de desarrollo en Neon (pide la cadena de conexión al equipo)
o una instancia local de PostgreSQL. Copia la cadena en `DATABASE_URL`.

**Redis/Valkey con Docker:**

```bash
# Crear e iniciar el contenedor (solo la primera vez)
docker run -d --name dinno-valkey -p 6379:6379 valkey/valkey:8

# Iniciar / detener en adelante
docker start dinno-valkey
docker stop dinno-valkey
```

Con eso, en `.env`: `REDIS_URL=redis://localhost:6379`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run start:dev` | Arranca en modo desarrollo con recarga automática. |
| `npm run start` | Arranca sin recarga. |
| `npm run build` | Compila a `dist/`. |
| `npm run start:prod` | Ejecuta la versión compilada (`node dist/main`). |
| `npm run lint` | Revisa el código con oxlint. |
| `npm run format` | Formatea con Prettier. |
| `npm run test` | Pruebas unitarias (Vitest). |
| `npm run test:e2e` | Pruebas e2e de la capa HTTP (no requieren base de datos). |
| `npm run test:cov` | Pruebas unitarias con cobertura. |

## Cómo verificar que funciona

Con el servidor en ejecución (`npm run start:dev`):

```bash
curl http://localhost:3000/v1/health
# {"status":"ok"}
```

- **Swagger / OpenAPI:** http://localhost:3000/docs (JSON en http://localhost:3000/docs-json).
  Es el contrato de la API entre backend, web y móvil.
- En la consola deben aparecer los mensajes `PostgreSQL conectado` y `Redis conectado`.

## Convenciones de la API

- Todas las rutas usan el prefijo versionado **`/v1`** (por ejemplo `GET /v1/health`).
- La documentación se publica en `/docs` (fuera del prefijo).
- URL base que consumen los clientes: `http://localhost:3000/v1` en local y
  `https://<servicio>.onrender.com/v1` en el ambiente temporal. Los clientes guardan solo el
  origen (`VITE_API_URL`, `EXPO_PUBLIC_API_URL`) y agregan `/v1` en sus llamadas.

## Estructura

```
src/
├── main.ts              # Arranque: puerto, configuración HTTP
├── app.setup.ts         # Prefijo /v1, CORS y Swagger (compartido con las pruebas e2e)
├── app.module.ts        # Configuración, PostgreSQL (TypeORM), Redis y módulos
├── app.controller.ts    # GET /v1/health
├── config/              # Configuración de infraestructura (Redis)
└── modules/             # Módulos del monolito modular (sin lógica de negocio aún)
    ├── identity-access/
    ├── restaurant-operations/
    ├── reservations-checkin/
    ├── search-availability/
    └── notifications/
```

## Despliegue en Render (ambiente temporal)

1. Crear un **Web Service** conectado a este repositorio (rama que el equipo defina para despliegue).
2. **Runtime:** Node. Render toma la versión de Node de `engines` / `.nvmrc`.
3. **Build Command:** `npm ci && npm run build`
4. **Start Command:** `npm run start:prod`
5. **Health Check Path:** `/v1/health`
6. **Variables de entorno:** `DATABASE_URL`, `REDIS_URL` y `CORS_ORIGINS`. No definas `PORT`.

> En el plan free, el servicio se suspende tras ~15 minutos sin tráfico; la primera petición
> después de eso puede tardar alrededor de un minuto.
