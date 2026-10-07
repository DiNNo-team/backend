# Base de datos · DiNNo backend

Esquema vigente de PostgreSQL (Neon). **Se actualiza en el mismo PR que cambia el esquema.**
Cómo crear y correr migraciones, y quién las corre: sección 10 del [CLAUDE.md](../CLAUDE.md), subsección "Migraciones".

Última migración aplicada: `1791268910540-AddFirebaseUidToUsers` (2026-10-06).

> Las tres migraciones están aplicadas en Neon: `CreateInitialTables`, `1791250327133-AddRestaurantProfile` (Santiago, PBI 3; agrega `category` y `address` a `restaurants` y crea `restaurant_schedules`; aplicada el 2026-10-05) y `1791268910540-AddFirebaseUidToUsers` (agrega `users.firebase_uid`; aplicada el 2026-10-06). Lo que se documenta abajo existe en Neon.

> **Pendiente de aplicar en Neon:** `1791342586330-AddRestaurantIsOpen` (Sergio, PBI 8; agrega `restaurants.is_open`). La aplica Elizabeth antes de fusionar el PR `feat/sprint1-estado-restaurante-backend`. Hasta entonces, `is_open` está documentada abajo pero no existe en Neon.

## Tablas

Todas las tablas tienen `id`, `created_at` y `updated_at`:

| Columna | Tipo | Reglas |
|---|---|---|
| `id` | `uuid` | PK, por defecto `gen_random_uuid()` |
| `created_at` | `timestamptz` | NOT NULL, por defecto `now()` |
| `updated_at` | `timestamptz` | NOT NULL, por defecto `now()`; TypeORM lo actualiza al guardar |

### `restaurants` · entidad `Restaurant`

| Columna | Tipo | Reglas |
|---|---|---|
| `name` | `varchar(120)` | NOT NULL |
| `category` | `varchar(50)` | NULL. Solo uno de los valores de la lista de categorías (`CHK_restaurants_category`); ver "Decisiones" |
| `address` | `varchar(255)` | NULL |
| `is_open` | `boolean` | NOT NULL, por defecto `true`. Estado Abierto/Cerrado del restaurante (PBI 8); ver "Decisiones". **Migración pendiente de aplicar** |

### `restaurant_schedules` · entidad `RestaurantSchedule`

Horario de atención: una fila por cada día que el restaurante **abre**. Un día cerrado no tiene fila.

| Columna | Tipo | Reglas |
|---|---|---|
| `restaurant_id` | `uuid` | NOT NULL, FK → `restaurants.id` |
| `day_of_week` | `smallint` | NOT NULL, de 1 a 7: 1 = lunes … 7 = domingo (`CHK_restaurant_schedules_day_of_week`) |
| `is_open_24h` | `boolean` | NOT NULL, por defecto `false` |
| `opens_at` | `time` | NULL. Hora de apertura, sin zona horaria |
| `closes_at` | `time` | NULL. Hora de cierre, sin zona horaria |

- Un solo horario por día y restaurante (`UQ_restaurant_schedules_restaurant_id_day_of_week`, sobre `(restaurant_id, day_of_week)`). Como empieza por `restaurant_id`, también sirve de índice para buscar los horarios de un restaurante.
- `CHK_restaurant_schedules_hours`: o `is_open_24h = true` sin horas, o `is_open_24h = false` con las dos horas y distintas entre sí.
- La numeración de días es la de ISO 8601, la misma que da Postgres con `EXTRACT(ISODOW FROM ...)`.

### `users` · entidad `User`

| Columna | Tipo | Reglas |
|---|---|---|
| `firebase_uid` | `varchar(128)` | NULL, único (`UQ_users_firebase_uid`); NULL para usuarios de prueba sin UID |
| `email` | `varchar(255)` | NOT NULL, único (`UQ_users_email`) |
| `role` | `varchar(50)` | NOT NULL. Sin check: los valores los define Jacobo (PBI 2) |
| `restaurant_id` | `uuid` | NULL = usuario que aún no registra su restaurante (onboarding). FK → `restaurants.id` |

### `tables` · entidad `Table`

| Columna | Tipo | Reglas |
|---|---|---|
| `restaurant_id` | `uuid` | NOT NULL, FK → `restaurants.id` |
| `identifier` | `varchar(50)` | NOT NULL. Único por restaurante sin importar mayúsculas ni espacios (`UQ_tables_restaurant_id_identifier`). La API acepta máximo 10 caracteres y además trata "4", "04" y "Mesa 4" como la misma mesa (`tables/table-identifier.ts`) |
| `capacity` | `smallint` | NOT NULL, entre 1 y 20 (`CHK_tables_capacity`) |
| `status` | `varchar(20)` | NOT NULL, por defecto `'available'`; solo `'available'`, `'reserved'` u `'occupied'` (`CHK_tables_status`) |
| `is_active` | `boolean` | NOT NULL, por defecto `true` |

Estados en la interfaz: `available` = Disponible, `reserved` = Reservada, `occupied` = Ocupada. `is_active = false` = Inactiva.

Las FK no tienen cascada (`ON DELETE NO ACTION`): no se puede borrar un restaurante que tenga mesas o usuarios.

## Quién es dueño de qué

| Tabla | Dueño | Qué agrega (cada uno con su propia migración de `ALTER`) |
|---|---|---|
| `restaurants` | Elizabeth (mínimo: `name`) | Santiago: `category` y `address`. Sergio: `is_open` (estado abierto/cerrado) |
| `restaurant_schedules` | Santiago | Tabla nueva para los horarios del restaurante |
| `users` | Elizabeth (esquema base) | Jacobo: `firebase_uid` (ya aplicada) y lo que más necesite para enlazar con Firebase |
| `tables` | Elizabeth | Sebastián (editar y desactivar) trabaja sobre `identifier`, `capacity` e `is_active` |
| `table_logs` (aún no existe) | Sergio | Tabla nueva para la bitácora de cambios de mesas |

Nadie recrea una tabla ni toca columnas de otra persona.

## Decisiones

- **Ids `uuid`, no enteros secuenciales:** los ids van en las URLs (`/v1/tables/:id`) y con enteros un restaurante puede adivinar los de otro sumando uno. Es una capa extra, no el control de acceso: lo que protege los datos es que toda consulta filtre por el restaurante del usuario de la sesión. Se generan con `gen_random_uuid()`, nativa desde Postgres 13 (`uuidExtension: 'pgcrypto'` con `installExtensions: false`: no se instala ninguna extensión).
- **`status` como `varchar` con check, no `enum` de Postgres:** cambiar un valor es editar un check, no una migración de `ALTER TYPE`.
- **`is_active` separado de `status`:** Inactiva es una mesa desactivada, no un estado del control (CLAUDE.md, sección 8).
- **Índice único sobre `lower(trim(identifier))` escrito a mano:** "Mesa 04", "mesa 04" y "Mesa 04 " son la misma mesa; `@Index` no acepta expresiones, así que vive en la migración y la entidad lo declara con `synchronize: false` (no quitarlo).
- **Restricciones únicas, checks e índices con nombre explícito; PK y FK con el nombre generado:** el backend identifica qué restricción falló (error `23505`) por su nombre.
- **Categorías del restaurante** (`category`, constante `RESTAURANT_CATEGORIES` en `restaurant.entity.ts`). El valor en inglés va en la base y en la API; el texto en español, en la interfaz:

  | Valor | Texto |
  |---|---|
  | `colombian` | Colombiana |
  | `italian` | Italiana |
  | `mexican` | Mexicana |
  | `asian` | Asiática |
  | `grill` | Parrilla |
  | `fast_food` | Comida rápida |
  | `healthy` | Saludable |
  | `seafood` | Mariscos |
  | `cafe` | Cafetería |
  | `other` | Otra |

  Como `status` en `tables`, es `varchar` con check y no `enum` de Postgres. **Para agregar o quitar una categoría hace falta una migración escrita a mano** que borre y vuelva a crear `CHK_restaurants_category`: TypeORM compara los checks solo por su nombre, así que `migration:generate` no detecta que cambió la lista.
- **`category` y `address` son NULL en la base a propósito:** ya hay restaurantes creados solo con nombre (el del seed, y `src/seed.ts` sigue creándolos así). Que sean obligatorios lo impone el endpoint de registro, no la base. No tienen valor por defecto.
- **Un día cerrado es un día sin fila** en `restaurant_schedules`; no hay columna de "cerrado".
- **`restaurants.is_open` es un interruptor manual**, independiente de `restaurant_schedules`: en el Sprint 1 no se calcula a partir de los horarios. Nace en `true` (el restaurante recién registrado queda abierto), y los restaurantes que ya existen quedan en `true` al aplicar la migración. El valor por defecto está pendiente de confirmar con Santiago (registro): si cambia a `false`, es otra migración.
- **"Abierto 24 horas" es explícito, con `is_open_24h = true`** y sin horas. Una apertura igual al cierre no es válida, para que "24 horas" no tenga dos formas de escribirse.
- **Un cierre menor que la apertura significa que cierra al día siguiente** (por ejemplo, abre a las 18:00 y cierra a las 02:00). Por eso no hay un check `closes_at > opens_at`.

## Reiniciar los datos de prueba

Cada registro exitoso de restaurante deja a `onboarding@example.com` con restaurante, y deja de servir para probar el onboarding. Para devolverlo a su estado sin restaurante:

```sql
UPDATE users SET restaurant_id = NULL WHERE email = 'onboarding@example.com';
```

- No borra nada. El restaurante que creó queda huérfano (ningún usuario apunta a él) y no pasa nada.
- **`demo@example.com` no se usa para esto:** está reservado para la demo del Día 7 y nadie lo toca.

## Verificar que las entidades coinciden con la base

Sin escribir nada en la base ni crear archivos:

```bash
npm run migration:generate -- src/migrations/Check --check
```

Termina sin error si coinciden; si no, muestra el SQL de la diferencia y termina con error.
