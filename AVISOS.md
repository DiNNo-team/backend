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
- **Corre `npm install` después del pull del Día 2:** entraron `class-validator` y `class-transformer`. Sin eso, `build`, `test` y `start:dev` fallan.
- **Validación global (`ValidationPipe` en `src/app.setup.ts`), aplica a TODOS los endpoints, no solo a mesas:**
  - **Un campo que no esté en el DTO devuelve `400`** (`forbidNonWhitelisted`), también dentro de objetos anidados. Si un front manda un campo de más, la petición se cae: el body tiene que traer exactamente lo que dice Swagger.
  - **Todo decorador lleva `message` en español diciendo cómo corregir.** Si se te olvida, sale el mensaje por defecto de class-validator, en inglés.
  - No hay conversión implícita: en un body, `"4"` no es un número. Un `@Param('x') x: number` sí se convierte, pero las propiedades numéricas de un DTO de query necesitan `@Type(() => Number)`.
  - Un `:id` de ruta no se valida solo: usa `ParseUUIDPipe` con un mensaje propio. Si no, un id mal formado llega a Postgres y responde `500`.
- **Forma de los errores de toda la API:** `{ statusCode, message, error }`. En los `400` de validación `message` es una **lista** (un mensaje por problema); en los demás errores es un **texto**. El DTO para Swagger es `src/common/dto/error-response.dto.ts`: impórtalo, no lo dupliques.
  - Algunos errores traen además **`errorCode`**, solo los que el front tiene que tratar distinto según el motivo; los que el front solo muestra no lo llevan (regla en el CLAUDE.md, sección 10, "API"). Hoy existe uno: `RESTAURANT_REQUIRED`.
- **Código compartido entre módulos:** va en `src/common/`, solo si de verdad lo usan varios módulos y no es de ningún dominio. Nada de lógica de negocio (regla en el CLAUDE.md, sección 10).
- **Los mensajes de error que puede ver el usuario siguen la sección 14 del manual de identidad v1.1:**
  - Tuteo, frases cortas y sin culpar, qué pasó + qué hacer.
  - Sin códigos técnicos, emojis ni signos de exclamación, y con mayúscula inicial solamente.
  - Las palabras son las del glosario (14.1). Si el manual ya fija un texto en 14.2, se usa ese tal cual. Por ejemplo, el `401` dice "Tu sesión terminó. Inicia sesión de nuevo."
  - Los mensajes que solo salen cuando alguien llama la API a mano (campo no permitido, cuerpo que no es JSON) se quedan técnicos, porque la interfaz nunca los dispara.
- **Errores no controlados → `500` en español, ya resuelto para toda la API:** si algo falla sin una excepción HTTP (se cae Neon, un bug), la respuesta es `{ statusCode: 500, message: "No pudimos completar la acción. Intenta de nuevo en un momento.", error: "Internal Server Error" }`. El error real queda completo en el log del servidor (Render) y nunca llega al cliente. Lo hace un filtro global (`src/common/filters/unhandled-exception.filter.ts`). **No montes tu propio manejo de errores genéricos** ni envuelvas tu código en `try/catch` solo para devolver un 500: lanza las excepciones HTTP de Nest para los errores que esperas, y deja que lo inesperado llegue al filtro. Tus `400`, `401`, `403`, `404` y `409` salen sin cambios.

## Por persona

### Jacobo
- `users` no tiene cómo enlazarse con Firebase: falta `firebase_uid` (`varchar`, único). Va en tu propia migración (`users` es de tu módulo).
- Día 3, al conectar Firebase: **encadenar, no reemplazar.** En local debe seguir funcionando el usuario de desarrollo: un `useFactory` que elija entre los dos resolvers, no un `useClass` que sustituya a `DevUserResolver`.
- Pendiente de decidir: ¿se crea la fila en `users` automáticamente en el primer inicio de sesión? Cambia cuánto cuesta probar el onboarding.
- Lo global de validación te toca en cualquier endpoint de `identity-access` que reciba body: campos de más dan `400`, los mensajes van en español en cada decorador y en Swagger documentas los errores con el `ErrorResponseDto` de `src/common/dto/`.
- **Pendiente de acordar con Elizabeth y Sebastián: los `403` de tu control de acceso por rol.** Las rutas de mesas ya responden `403` con `errorCode: "RESTAURANT_REQUIRED"` cuando el usuario no tiene restaurante, y la web ramifica por ese `errorCode`. Propuesta, **todavía no decidida**:
  - Sin restaurante → `403` con `errorCode: "RESTAURANT_REQUIRED"` (ya está así).
  - Recurso de otro restaurante → `404`, para no revelar que existe.
  - Rol insuficiente → `403` sin `errorCode`. Si el front llega a necesitar distinguirlo, se le pone su propio `errorCode`, con la opción nativa de Nest (`new ForbiddenException(mensaje, { errorCode })`).
- **Texto del `403` por rol:** el manual fija en 14.2 el de "Sin permiso": **"No tienes acceso a esta sección."** Úsalo tal cual en tu `403` por rol. Es distinto del `403` de "sin restaurante" de las mesas, que tiene su propio texto y su `errorCode: "RESTAURANT_REQUIRED"`.
- **Swagger, cuando exista la autenticación real:** agrega `addBearerAuth()` al `DocumentBuilder` en `src/app.setup.ts` y marca las rutas protegidas con `@ApiBearerAuth()`. Así Swagger muestra el candado y se puede probar con un token desde `/docs`. Hoy no tiene sentido porque no hay tokens.

### Santiago y Sergio
- `restaurants` tiene solo `name`. Cada uno agrega sus columnas con su propia migración de `ALTER`. Nadie recrea la tabla.
- **No corran `migration:generate`:** con la base compartida genera una migración con las tablas de los demás. Usen `npm run migration:create` y escriban el SQL, o pídanle la migración a Elizabeth.

### Santiago
- **La librería de validación es `class-validator` con `class-transformer`**, con decoradores sobre el DTO.
- **Las validaciones del registro van en un solo DTO** (en `restaurants/dto/`), no repartidas en el controlador ni en el servicio. Elizabeth lo reutiliza el Día 3 en la edición del restaurante, con `PartialType` de `@nestjs/swagger`: si una regla no está en el DTO, la edición no la hereda.
- **Los mensajes los escribes tú en cada decorador**, en español y diciendo cómo corregir ("Escribe la hora en formato HH:MM, por ejemplo 09:30"), no "Campo inválido". Cada decorador lleva el suyo, o sale el mensaje por defecto en inglés.
- **Horarios de los siete días:** si son una lista de objetos, ponle `@ValidateNested({ each: true })` y `@Type(() => TuDtoDeDia)`, o el contenido de cada día no se valida. Si el lunes y el jueves fallan con el mismo texto, la respuesta trae **las dos entradas**. Se quitan los repetidos solo dentro de un mismo campo (varias reglas rotas sobre el mismo campo dan un mensaje). Si el usuario necesita saber qué día está mal, pon el día en el mensaje.

### Sergio
- Lo global de validación también te toca: el body de abrir/cerrar el restaurante solo puede traer lo que diga tu DTO (un campo de más da `400`), y en Swagger documentas los errores con el `ErrorResponseDto` de `src/common/dto/`. Un booleano en el body tiene que llegar como `true`/`false`, no como `"true"`.
- **Bitácora de mesas:** `TablesService.create` (Día 2) todavía no escribe nada en la bitácora. Si crear una mesa cuenta como cambio, acuerda con Elizabeth dónde se engancha, en vez de tocar `tables/` por tu cuenta.

### Sebastián
- Estados de mesa en el backend: `available`, `reserved` y `occupied`. `is_active` va aparte: es una mesa desactivada, no un estado.
- **De cara al usuario, el campo `identifier` se llama "nombre" (nombre de la mesa), nunca "identificador":** el glosario del manual no incluye esa palabra. El label del diálogo de crear mesa tiene que decir "Nombre", igual que los mensajes de error del backend ("Escribe un nombre para la mesa…", "Ya tienes una mesa con ese nombre…"). Si no, el usuario ve dos palabras para el mismo campo. En el código y en la API el campo sigue siendo `identifier`.
- El nombre de la mesa es único por restaurante sin importar mayúsculas ni espacios: "Mesa 04" y "mesa 04" chocan.
- **Ya puedes cambiar los datos de ejemplo por la API real.** Contrato completo en Swagger (`/docs`, tag `tables`):
  - **`POST /v1/tables`** recibe exactamente `{ "identifier": "Mesa 4", "capacity": 4 }`. `identifier` es texto de 1 a 50 caracteres (el backend recorta los espacios de los extremos); `capacity` es un **número** entero de 1 a 20. El valor de un input HTML es texto: conviértelo con `Number(...)` antes de enviarlo, porque `"4"` se rechaza. Responde `201` con la mesa creada.
  - **`GET /v1/tables`** responde `200` con todas las mesas del restaurante, **activas e inactivas** (sepáralas con `isActive`), **ordenadas por fecha de creación, de la más antigua a la más nueva**. No vienen ordenadas por nombre, así que "Mesa 10" no queda antes de "Mesa 2". Sin mesas responde `[]`.
  - **Forma de cada mesa** (las dos rutas): `{ "id": "uuid", "identifier": "Mesa 4", "capacity": 4, "status": "available", "isActive": true }`. Sin `createdAt` ni `updatedAt`.
  - **Una mesa nueva siempre nace `available` y activa.** No mandes `status`, `isActive` ni `restaurantId`: cualquier campo de más devuelve `400` y la mesa no se crea. El restaurante sale de la sesión.
  - **Errores** (`message` en español, listo para mostrar):
    - `400`: datos inválidos o campos de más. `message` es una **lista**; muestra cada mensaje.
    - `409`: ya existe una mesa con ese nombre en el restaurante. `message` es un texto.
    - `403` con `errorCode: "RESTAURANT_REQUIRED"`: el usuario todavía no registra su restaurante. Llévalo al registro del restaurante en vez de mostrar la pantalla de mesas vacía. **Ramifica por `errorCode === 'RESTAURANT_REQUIRED'`**, no por el código HTTP solo, la ruta ni el texto del mensaje: puede haber otros `403` (por ejemplo, por permisos), y esos se muestran como error. Lo puedes probar con el usuario de onboarding.
    - `401`: no hay sesión. Llévalo a iniciar sesión.
- **Error `500`:** si algo falla en el servidor, la API responde `500` con `message: "No pudimos completar la acción. Intenta de nuevo en un momento."` y sin `errorCode`; muéstralo tal cual. **Ese texto no está en el manual:** lo propuso Elizabeth siguiendo la sección 14. Confírmalo o propón otro; cambiarlo es un string.
- **Para tu parte de backend (editar y desactivar mesas):** busca la mesa por `id` **y** por el `restaurantId` de la sesión. Si no es de su restaurante, responde `404` como si no existiera. Valida el `:id` con `ParseUUIDPipe`. Reutiliza `TableResponseDto.fromEntity` para responder y la detección del nombre repetido (`23505`) que ya está en `tables.service.ts`: al editar el nombre puede chocar igual que al crear. Tus mensajes también dicen "nombre", no "identificador".

## Reglas nuevas de este sprint

- Las migraciones las corre solo Elizabeth (una sola base en Neon).
- `demo@example.com` está reservado para la demo del Día 7: nadie lo usa para probar. Para eso está `onboarding@example.com`, que se reinicia con el SQL de [`docs/database.md`](docs/database.md#reiniciar-los-datos-de-prueba).

## Historial

- **Día 2 · 2026-10-04 · PR de crear y listar mesas (Elizabeth, PBI 5).** `POST /v1/tables` y `GET /v1/tables`. Dependencias nuevas `class-validator` y `class-transformer`. `ValidationPipe` global en `src/app.setup.ts` (`whitelist`, `forbidNonWhitelisted`, `transform`, mensajes en español sin repetidos por campo). Filtro global de errores no controlados (`500` en español, detalle solo en el log). Carpeta `src/common/` con el filtro y con `ErrorResponseDto`, que incluye el campo opcional `errorCode` (opción nativa de Nest 12; hoy solo `RESTAURANT_REQUIRED`). Sin cambios de esquema.
- **Día 1 · 2026-10-04 · PR de la base del backend (Elizabeth).** Esquema inicial (`users`, `restaurants`, `tables`) con ids UUID, migraciones de TypeORM, `CurrentUser` con usuario de desarrollo (`DEV_USER_ENABLED`, `DEV_USER_ID`, cabecera `x-dev-user-id`), seed (`npm run seed`) y `docs/database.md`.
