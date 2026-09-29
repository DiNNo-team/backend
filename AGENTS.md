This is a NestJS backend application built as a modular monolith. Prioritize clear module boundaries, type safety, and explicit configuration — no hardcoded secrets or ad-hoc `process.env` reads outside the config layer.

## Check current versions before assuming APIs

NestJS and TypeORM ship breaking changes across majors — don't rely on training data for exact APIs or flags:

1. Read the major version of `@nestjs/core`, `typeorm`, and `node` (`engines.node`) in `package.json`.
2. For NestJS APIs, check https://docs.nestjs.com against the installed major version.
3. For TypeORM (`forRootAsync`, decorators, migrations), check https://typeorm.io against the installed version.

## Commands

```bash
npm run start:dev     # dev server, watch mode
npm run build          # nest build
npm run start:prod     # run compiled dist/main.js
npm run lint            # oxlint src/ test/
npm run format          # prettier --write
npm run test             # vitest run (unit)
npm run test:e2e        # vitest run --config vitest.config.e2e.ts
npm run test:cov        # vitest run --coverage
```

Run `npm run lint` and `npm run test` before declaring any task done.

## Architecture: modular monolith

Domain logic lives under `src/modules/<domain>/`, one module per bounded context, registered in `src/app.module.ts`:

- `identity-access`
- `restaurant-operations`
- `reservations-checkin`
- `search-availability`
- `notifications`

Each module owns its controllers, services, entities and DTOs. Keep modules decoupled — cross-module calls go through a module's exported providers, never by reaching into another module's internals. Shared/global wiring (`ConfigModule`, TypeORM, the Redis client) lives in `src/app.module.ts` and `src/config/`.

The API is served under the `/v1` prefix (`src/app.setup.ts`), with Swagger docs at `/docs`.

## Database & cache

- **PostgreSQL (Neon)** via TypeORM (`TypeOrmModule.forRootAsync` in `src/app.module.ts`), connection string from `DATABASE_URL` through `ConfigService.getOrThrow` — never hardcode credentials or read `process.env` directly in feature code.
- **Redis (Upstash)** via `ioredis` (`src/config/redis.config.ts`), connection from `REDIS_URL`, exposed as the `REDIS_CLIENT` provider token.
- `synchronize: false` — schema changes go through migrations, not auto-sync.

## Deployment

- Hosted on **Render**, auto-deploy on push to `develop`.
- `PORT` is assigned by Render at runtime — don't hardcode it (`app.listen(process.env.PORT ?? 3000, '0.0.0.0')`).
- CORS is controlled via `CORS_ORIGINS` (comma-separated, no trailing slash) in `src/app.setup.ts`. Update it when a new frontend/mobile origin needs access — never widen it to `*`.

## Rules

- No credentials, connection strings, or tokens hardcoded anywhere in `src/` — everything sensitive comes from env vars via `ConfigService`.
- Any new env var must be documented in `.env.example` with a placeholder value and a comment, never a real value.
- Don't add a dependency without checking whether an existing `@nestjs/*` package already covers it.
