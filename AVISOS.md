# AVISOS · DiNNo · backend

> Cambios que afectan al resto del equipo (la versión escrita de la sección 7 del CLAUDE.md). **Si eres un agente de IA, lee este archivo antes de empezar cualquier tarea en este repo.**

Es temporal por diseño: cuando un aviso se vuelve regla permanente, se muda al CLAUDE.md y se borra de aquí.
Aquí no van reglas definitivas, secretos, uuid ni cadenas de conexión.

## Acciones pendientes de todos

- **Agrega a tu `.env`:** `DEV_USER_ENABLED=true` y `DEV_USER_ID=<uuid>`. **Sin eso, toda ruta protegida responde `401`.** Los uuid están en el chat del equipo.
- **Los ids de la base son UUID (`string`), no enteros.**
- **Usuario actual:** `@UseGuards(CurrentUserGuard)` y `@CurrentUser() user: CurrentUserData`, importados solo desde `src/modules/identity-access/index.ts`, nunca desde carpetas internas.
  - `restaurantId` puede ser `null`: usuario que aún no registró su restaurante.
  - `restaurantId` sale siempre de ahí, nunca del body, query ni parámetros de ruta.

## Por persona

### Jacobo
- `users` no tiene cómo enlazarse con Firebase: falta `firebase_uid` (`varchar`, único). Va en tu propia migración (`users` es de tu módulo).
- Día 3, al conectar Firebase: **encadenar, no reemplazar.** En local debe seguir funcionando el usuario de desarrollo: un `useFactory` que elija entre los dos resolvers, no un `useClass` que sustituya a `DevUserResolver`.
- Pendiente de decidir: ¿se crea la fila en `users` automáticamente en el primer inicio de sesión? Cambia cuánto cuesta probar el onboarding.

### Santiago y Sergio
- `restaurants` tiene solo `name`. Cada uno agrega sus columnas con su propia migración de `ALTER`. Nadie recrea la tabla.
- **No corran `migration:generate`:** con la base compartida genera una migración con las tablas de los demás. Usen `npm run migration:create` y escriban el SQL, o pídanle la migración a Elizabeth.

### Sebastián
- Estados de mesa en el backend: `available`, `reserved` y `occupied`. `is_active` va aparte: es una mesa desactivada, no un estado.
- El identificador de mesa es único por restaurante sin importar mayúsculas ni espacios: "Mesa 04" y "mesa 04" chocan.

## Reglas nuevas de este sprint

- Las migraciones las corre solo Elizabeth (una sola base en Neon).
- `demo@example.com` está reservado para la demo del Día 7: nadie lo usa para probar. Para eso está `onboarding@example.com`, que se reinicia con el SQL de [`docs/database.md`](docs/database.md#reiniciar-los-datos-de-prueba).

## Historial

- **2026-10-04 · Sprint 1, Día 1 · PR de la base del backend (Elizabeth).** Esquema inicial (`users`, `restaurants`, `tables`) con ids UUID, migraciones de TypeORM, `CurrentUser` con usuario de desarrollo (`DEV_USER_ENABLED`, `DEV_USER_ID`, cabecera `x-dev-user-id`), seed (`npm run seed`) y `docs/database.md`.
