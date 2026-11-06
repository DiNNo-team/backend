# Base de datos · DiNNo backend

Esquema vigente de PostgreSQL (Neon). **Se actualiza en el mismo PR que cambia el esquema.**
Cómo crear y correr migraciones, y quién las corre: sección 11 del [CLAUDE.md](../CLAUDE.md), subsección "Migraciones".

Última migración aplicada en Neon: `1793840000003-AddTableLogSource` (2026-11-05). Todas las migraciones del repositorio están aplicadas en la base de desarrollo y en la de pruebas (verificado con `migration:run` y `migration:show`).

> Migraciones aplicadas en Neon, en orden: `CreateInitialTables`, `1791250327133-AddRestaurantProfile` (Santiago, PBI 3; agrega `category` y `address` a `restaurants` y crea `restaurant_schedules`; aplicada el 2026-10-05), `1791268910540-AddFirebaseUidToUsers` (agrega `users.firebase_uid`; aplicada el 2026-10-06), `1791340136261-CreateTableLogs` (Sergio, PBI 9; crea `table_logs`), `1791342586330-AddRestaurantIsOpen` (Sergio, PBI 8; agrega `restaurants.is_open`; aplicada el 2026-10-08) y `1792087341885-AddDinerRoleAndRestaurantLocation` (Sprint 2, Elizabeth; agrega `restaurants.latitude` y `restaurants.longitude`, `users.display_name` y los checks `CHK_restaurants_location_pair`, `CHK_restaurants_latitude`, `CHK_restaurants_longitude`, `CHK_users_role` y `CHK_users_email_normalized`; aplicada el 2026-10-15), `1793084146913-AddTablePlan` (plano de mesas, manual de identidad v2.0; agrega `tables.plan_x`, `plan_y` y `plan_shape`; aplicada el 2026-10-27) y las tres del Sprint 3, todas de Elizabeth y aplicadas el 2026-11-05: `1793840000001-CreateReservations` (crea `reservations`), `1793840000002-CreateCheckIns` (crea `check_ins`) y `1793840000003-AddTableLogSource` (agrega `table_logs.source` y deja `table_logs.user_id` nullable). Todo lo que se documenta abajo existe en Neon.

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
| `is_open` | `boolean` | NOT NULL, por defecto `true`. Estado Abierto/Cerrado del restaurante (PBI 8); ver "Decisiones" |
| `latitude` | `numeric(9,6)` | NULL. Entre -90 y 90 (`CHK_restaurants_latitude`). Sprint 2 |
| `longitude` | `numeric(9,6)` | NULL. Entre -180 y 180 (`CHK_restaurants_longitude`). Sprint 2 |

- `CHK_restaurants_location_pair`: las dos coordenadas o ninguna. Sin coordenadas, el restaurante no aparece en la búsqueda del comensal.
- La base solo exige rangos válidos en el planeta; **la restricción a Bogotá la pone la API** (contrato del Sprint 2, `CLAUDE.md` sección 10).
- `numeric` llega del driver `pg` como texto: la entidad lo convierte a `number | null` con `coordinateTransformer` (`restaurants/restaurant.entity.ts`).

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
| `email` | `varchar(255)` | NOT NULL, único (`UQ_users_email`). En minúsculas y sin espacios (`CHK_users_email_normalized`) |
| `display_name` | `varchar(60)` | NULL. Nombre para mostrar del comensal; NULL en cuentas de restaurante. Sprint 2 |
| `role` | `varchar(50)` | NOT NULL. `'restaurant_admin'` o `'diner'` (`CHK_users_role`; valores de `UserRole`). Cambiar la lista exige una migración escrita a mano que borre y vuelva a crear el check |
| `restaurant_id` | `uuid` | NULL = usuario que aún no registra su restaurante (onboarding), o comensal. FK → `restaurants.id` |

- Desde el Sprint 2 el backend no crea usuarios al iniciar sesión. Una fila de `users` existe solo si se habilitó a mano como restaurante ("Restaurantes habilitados") o si la app la creó como comensal con `POST /v1/diners/me`.

### `tables` · entidad `Table`

| Columna | Tipo | Reglas |
|---|---|---|
| `restaurant_id` | `uuid` | NOT NULL, FK → `restaurants.id` |
| `identifier` | `varchar(50)` | NOT NULL. Único por restaurante sin importar mayúsculas ni espacios (`UQ_tables_restaurant_id_identifier`). La API acepta máximo 10 caracteres y además trata "4", "04" y "Mesa 4" como la misma mesa (`tables/table-identifier.ts`) |
| `capacity` | `smallint` | NOT NULL, entre 1 y 20 (`CHK_tables_capacity`) |
| `status` | `varchar(20)` | NOT NULL, por defecto `'available'`; solo `'available'`, `'reserved'` u `'occupied'` (`CHK_tables_status`) |
| `is_active` | `boolean` | NOT NULL, por defecto `true` |
| `plan_x` | `smallint` | NULL. Columna de la esquina superior izquierda de la mesa en el plano, de 0 a 19 (`CHK_tables_plan_x`) |
| `plan_y` | `smallint` | NULL. Fila de esa esquina, de 0 a 29 (`CHK_tables_plan_y`). `plan_x` y `plan_y` van juntas o las dos en NULL (`CHK_tables_plan_pair`): NULL = la mesa no está en el plano |
| `plan_shape` | `varchar(10)` | NULL; solo `'square'`, `'round'` o `'rect'` (`CHK_tables_plan_shape`). NULL = rectangular según la capacidad |

Estados en la interfaz: `available` = Disponible, `reserved` = Reservada, `occupied` = Ocupada. `is_active = false` = Inactiva.

**Plano de mesas** (migración `1793084146913-AddTablePlan`, manual de identidad v2.0, 13.10):
- Es una grilla fija de 20 × 30 celdas: las posiciones son celdas, no píxeles, así que el plano es el mismo en cualquier pantalla. Las mesas existentes quedan sin ubicar (las tres columnas en NULL).
- El tamaño de cada mesa sale de su forma y su capacidad (`tables/table-plan.ts`, `tableFootprint`): cuadrada o redonda, 3 × 3; rectangular, 3 × 2 hasta 4 personas, 4 × 2 hasta 8 y 5 × 2 desde 9. La web usa la misma tabla (`features/tables/plan/plan-geometry.ts`); `table-plan.spec.ts` y `plan-geometry.test.ts` la fijan en los dos lados.
- Que ninguna mesa se salga de la grilla ni quede encima de otra lo valida `PUT /v1/tables/plan` (depende del tamaño, así que no es un check de la base).
- Editar la capacidad no mueve la mesa: si crece y queda encima de otra, la web la marca en el modo edición y no deja guardar hasta moverla.
- La posición no es estado: no se registra en la bitácora ni cambia la disponibilidad.

### `table_logs` · entidad `TableLog`

Bitácora de cambios de estado de las mesas: una fila por cambio. Solo se insertan filas, nunca se editan ni se borran.

| Columna | Tipo | Reglas |
|---|---|---|
| `table_id` | `uuid` | NOT NULL, FK → `tables.id` |
| `previous_status` | `varchar(20)` | NOT NULL; solo `'available'`, `'reserved'`, `'occupied'` o `'inactive'` (`CHK_table_logs_previous_status`) |
| `new_status` | `varchar(20)` | NOT NULL; mismos valores (`CHK_table_logs_new_status`) |
| `user_id` | `uuid` | NULL, FK → `users.id`. El usuario que hizo el cambio. Solo puede ser NULL cuando `source = 'system'` (`CHK_table_logs_user_required_unless_system`). Sprint 3 |
| `source` | `varchar(20)` | NOT NULL, por defecto `'manual'`; solo `'manual'`, `'reservation'` o `'system'` (`CHK_table_logs_source`). Sprint 3 |
| `changed_at` | `timestamptz` | NOT NULL. Fecha y hora del cambio |

- Índice `IDX_table_logs_table_id_changed_at` sobre `(table_id, changed_at)`: consulta por mesa, de lo más reciente a lo más antiguo.
- Los valores de los checks son `TABLE_LOG_STATUSES` (`tables/table-status-log.ts`): los tres de `tables.status` más `'inactive'`, que solo existe aquí. Desactivar registra `available` → `inactive` (desde el Sprint 3 solo se desactiva una mesa `available`); reactivar, `inactive` → `available`.
- **Sin `restaurant_id` (decisión confirmada con Elizabeth):** el restaurante sale de la mesa (`table_logs.table_id` → `tables.restaurant_id`), así que las consultas de la bitácora filtran con un join a `tables`.
- Las dos FK (`table_id` → `tables.id` y `user_id` → `users.id`) son `ON DELETE NO ACTION ON UPDATE NO ACTION`, la misma regla que todas las FK del esquema. Las mesas no se borran, se desactivan; y si alguna vez se intentara borrar una mesa o un usuario con registros, la base lo rechaza en vez de borrar la bitácora.
- `changed_at` no tiene `DEFAULT`: lo pone el servicio que cambia la mesa (`changedAt` del contrato `TableStatusChange`). `created_at` y `updated_at` sí los pone la base, como en las demás tablas.
- **`source` (Sprint 3, CLAUDE.md §12.3):** `manual` = el restaurante a mano; `reservation` = una microreserva (crear, cancelar o check-in), con el comensal o el `restaurant_admin` como usuario; `system` = automático (vencimiento de una reserva), sin usuario. Los valores son `TABLE_LOG_SOURCES` (`tables/table-status-log.ts`). Los registros anteriores al Sprint 3 quedan con `source = 'manual'` por el valor por defecto.
- **`user_id` nullable:** la FK a `users` se conserva (`NO ACTION`). La regla «solo `system` va sin usuario» la impone la base con `CHK_table_logs_user_required_unless_system`, no solo el código. `GET /v1/table-logs` devuelve `source` en cada fila; `userEmail` es `null` en las filas `system` y en los cambios de un comensal.
- El `down` de `AddTableLogSource` borra los registros con `user_id` NULL antes de volver a exigirlo (antes de esa migración no existían).
- La escribe solo `DbTableStatusLog` (`table-logs/table-logs.recorder.ts`), dentro de la transacción que cambia la mesa.

### `reservations` · entidad `Reservation` (Sprint 3)

Microreservas (CLAUDE.md §12.1 y §12.4). Código en `src/modules/reservations-checkin/`.

| Columna | Tipo | Reglas |
|---|---|---|
| `code` | `varchar(6)` | NOT NULL. 6 caracteres del alfabeto `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (`CHK_reservations_code`) |
| `status` | `varchar(20)` | NOT NULL; solo `'active'`, `'cancelled'`, `'expired'` o `'completed'` (`CHK_reservations_status`) |
| `party_size` | `smallint` | NOT NULL, entre 1 y 20 (`CHK_reservations_party_size`) |
| `diner_id` | `uuid` | NOT NULL, FK → `users.id` |
| `restaurant_id` | `uuid` | NOT NULL, FK → `restaurants.id` |
| `table_id` | `uuid` | NOT NULL, FK → `tables.id` |
| `expires_at` | `timestamptz` | NOT NULL. Fuente de verdad del vencimiento (§12.5) |
| `cancelled_at`, `expired_at`, `checked_in_at` | `timestamptz` | NULL; se llenan según el estado final |
| `no_show` | `boolean` | NOT NULL, por defecto `false`. `true` si venció sin que el comensal llegara |

- **Índices únicos parciales (`WHERE "status" = 'active'`), la defensa final contra la concurrencia:** `UQ_reservations_active_table` (una activa por mesa), `UQ_reservations_active_diner` (una por comensal) y `UQ_reservations_active_code` (código único entre las activas). Una reserva cancelada, vencida o cumplida no bloquea nada; el código puede repetirse después.
- Índices de apoyo: `IDX_reservations_restaurant_status_expires_at` sobre `(restaurant_id, status, expires_at)` (lista del restaurante y proceso de vencimiento) e `IDX_reservations_diner_id_created_at` sobre `(diner_id, created_at)`.
- Las tres FK son `ON DELETE NO ACTION`. Los valores de los checks son `RESERVATION_STATUSES` y `RESERVATION_CODE_ALPHABET` (`reservations/reservation.constants.ts`); como todo check, cambiarlos exige una migración escrita a mano.

**Flujo de creación (`POST /v1/reservations`):** en una sola transacción se bloquea la mesa elegida (`FOR UPDATE SKIP LOCKED`), se inserta la reserva (`status = 'active'`, `expires_at` = ahora + `RESERVATION_TTL_MINUTES`), la mesa pasa de `available` a `reserved` y se escribe una fila de `table_logs` (`source = 'reservation'`, `user_id` = el comensal). Una violación de `UQ_reservations_active_diner`, `UQ_reservations_active_table` o `UQ_reservations_active_code` aborta la transacción y la API la traduce a `ACTIVE_RESERVATION_EXISTS`, `NO_TABLE_AVAILABLE` o un reintento con otro código. Detalle en `CLAUDE.md` §11, "Reservas".

### `check_ins` · entidad `CheckIn` (Sprint 3)

El evento facturable (§12.6): un registro por check-in válido.

| Columna | Tipo | Reglas |
|---|---|---|
| `reservation_id` | `uuid` | NOT NULL, FK → `reservations.id`, **único** (`UQ_check_ins_reservation_id`): nunca se cobra dos veces |
| `restaurant_id` | `uuid` | NOT NULL, FK → `restaurants.id` |
| `checked_in_at` | `timestamptz` | NOT NULL. Fecha y hora del check-in |

Las FK no tienen cascada (`ON DELETE NO ACTION`): no se puede borrar un restaurante que tenga mesas o usuarios, ni una mesa o un usuario que tenga registros en la bitácora.

## Quién es dueño de qué

| Tabla | Dueño | Qué agrega (cada uno con su propia migración de `ALTER`) |
|---|---|---|
| `restaurants` | Elizabeth (mínimo: `name`) | Santiago: `category` y `address`. Sergio: `is_open` (estado abierto/cerrado) |
| `restaurant_schedules` | Santiago | Tabla nueva para los horarios del restaurante |
| `users` | Elizabeth (esquema base) | Jacobo: `firebase_uid` (ya aplicada) y lo que más necesite para enlazar con Firebase |
| `tables` | Elizabeth | Sebastián (editar y desactivar) trabaja sobre `identifier`, `capacity` e `is_active` |
| `table_logs` | Sergio | Tabla nueva para la bitácora de cambios de mesas (`CreateTableLogs`). Elizabeth, Sprint 3: `source` y `user_id` nullable (`AddTableLogSource`) |
| `reservations`, `check_ins` | Elizabeth | Sprint 3 (`CreateReservations`, `CreateCheckIns`) |

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
- **`category` y `address` son NULL en la base a propósito:** ya hay restaurantes creados solo con nombre, de antes del registro completo. El seed le fija a Casa 72 categoría, dirección, coordenadas y horarios en cada corrida (es la fuente de verdad de ese restaurante de prueba). Que sean obligatorios lo impone el endpoint de registro, no la base. No tienen valor por defecto.
- **Un día cerrado es un día sin fila** en `restaurant_schedules`; no hay columna de "cerrado".
- **`restaurants.is_open` es un interruptor manual**, independiente de `restaurant_schedules`: en el Sprint 1 no se calcula a partir de los horarios. Nace en `true` (decisión tomada: el restaurante recién registrado queda Abierto), y los restaurantes que ya existían quedaron en `true` al aplicar la migración.
- **"Abierto 24 horas" es explícito, con `is_open_24h = true`** y sin horas. Una apertura igual al cierre no es válida, para que "24 horas" no tenga dos formas de escribirse.
- **Un cierre menor que la apertura significa que cierra al día siguiente** (por ejemplo, abre a las 18:00 y cierra a las 02:00). Por eso no hay un check `closes_at > opens_at`.

## Restaurantes habilitados (Sprint 2)

Un correo es de restaurante solo si existe en `users` con `role = 'restaurant_admin'`. El backend ya no crea usuarios automáticamente. Para habilitar un correo:
`INSERT INTO users (email, role) VALUES ('correo@dominio.com', 'restaurant_admin');`
El correo va en minúsculas y sin espacios. En el primer inicio de sesión (Google o correo y clave con el correo verificado), el backend vincula su `firebase_uid`. Por ahora los correos reales habilitados son `dinnoteam2026@gmail.com` y `dinnoteam2026+casa72@gmail.com` (dueño de Casa 72, lo crea el seed; su correo llega a la misma bandeja). Los `restaurante-XX@dinno.test` del seed no son correos reales: nadie puede entrar con ellos.

## Reiniciar los datos de prueba

Cada registro exitoso de restaurante deja a `onboarding@example.com` con restaurante, y deja de servir para probar el onboarding. Para devolverlo a su estado sin restaurante:

```sql
UPDATE users SET restaurant_id = NULL WHERE email = 'onboarding@example.com';
```

- No borra nada. El restaurante que creó queda huérfano (ningún usuario apunta a él) y no pasa nada.
- **`demo@example.com` no se usa para esto:** está reservado para la demo del Día 7 y nadie lo toca.

## Cuenta bloqueada tras recrear el usuario en Firebase

Si alguien borra su cuenta de Firebase y la vuelve a crear con el mismo correo, Firebase le da un UID nuevo, pero su fila de `users` sigue vinculada al UID viejo. Desde entonces cada petición responde `401` "Tu sesión terminó. Inicia sesión de nuevo.", aunque el login en la web funcione, y el log del servidor muestra `Firebase account rejected: email already linked to another UID`.

Para desvincularla, de modo que el próximo login con el correo verificado la vuelva a vincular a su restaurante:

```sql
UPDATE users SET firebase_uid = NULL WHERE id = '<user-id>';
```

- **Solo lo ejecuta Elizabeth**, en Neon, que es la base de producción.
- **Antes, verifica quién es la persona** y que de verdad es la dueña de ese correo y de ese restaurante. Al quitar el UID, quien inicie sesión con ese correo verificado se queda con la cuenta y con su restaurante.
- Usa el `id` de la fila (uuid), nunca un `WHERE` por correo, para no tocar otra fila.

## Verificar que las entidades coinciden con la base

Sin escribir nada en la base ni crear archivos:

```bash
npm run migration:generate -- src/migrations/Check --check
```

Termina sin error si coinciden; si no, muestra el SQL de la diferencia y termina con error.
