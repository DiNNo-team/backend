# Base de datos · DiNNo backend

Esquema vigente de PostgreSQL (Neon). **Se actualiza en el mismo PR que cambia el esquema.**
Cómo crear y correr migraciones, y quién las corre: sección 10 del [CLAUDE.md](../CLAUDE.md), subsección "Migraciones".

Última migración aplicada: `1791092320241-CreateInitialTables`.

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
| `identifier` | `varchar(50)` | NOT NULL. Único por restaurante sin importar mayúsculas ni espacios (`UQ_tables_restaurant_id_identifier`) |
| `capacity` | `smallint` | NOT NULL, entre 1 y 20 (`CHK_tables_capacity`) |
| `status` | `varchar(20)` | NOT NULL, por defecto `'available'`; solo `'available'`, `'reserved'` u `'occupied'` (`CHK_tables_status`) |
| `is_active` | `boolean` | NOT NULL, por defecto `true` |

Estados en la interfaz: `available` = Disponible, `reserved` = Reservada, `occupied` = Ocupada. `is_active = false` = Inactiva.

Las FK no tienen cascada (`ON DELETE NO ACTION`): no se puede borrar un restaurante que tenga mesas o usuarios.

## Quién es dueño de qué

| Tabla | Dueño | Qué agrega (cada uno con su propia migración de `ALTER`) |
|---|---|---|
| `restaurants` | Elizabeth (mínimo: `name`) | Santiago: categoría, dirección y horarios. Sergio: estado abierto/cerrado |
| `users` | Elizabeth (esquema base) | Jacobo: lo que necesite para enlazar con Firebase |
| `tables` | Elizabeth | Sebastián (editar y desactivar) trabaja sobre `identifier`, `capacity` e `is_active` |
| `table_logs` (aún no existe) | Sergio | Tabla nueva para la bitácora de cambios de mesas |

Nadie recrea una tabla ni toca columnas de otra persona.

## Decisiones

- **Ids `uuid`, no enteros secuenciales:** los ids van en las URLs (`/v1/tables/:id`) y con enteros un restaurante puede adivinar los de otro sumando uno. Es una capa extra, no el control de acceso: lo que protege los datos es que toda consulta filtre por el restaurante del usuario de la sesión. Se generan con `gen_random_uuid()`, nativa desde Postgres 13 (`uuidExtension: 'pgcrypto'` con `installExtensions: false`: no se instala ninguna extensión).
- **`status` como `varchar` con check, no `enum` de Postgres:** cambiar un valor es editar un check, no una migración de `ALTER TYPE`.
- **`is_active` separado de `status`:** Inactiva es una mesa desactivada, no un estado del control (CLAUDE.md, sección 8).
- **Índice único sobre `lower(trim(identifier))` escrito a mano:** "Mesa 04", "mesa 04" y "Mesa 04 " son la misma mesa; `@Index` no acepta expresiones, así que vive en la migración y la entidad lo declara con `synchronize: false` (no quitarlo).
- **Restricciones únicas, checks e índices con nombre explícito; PK y FK con el nombre generado:** el backend identifica qué restricción falló (error `23505`) por su nombre.

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
