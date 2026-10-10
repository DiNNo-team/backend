# AVISOS · DiNNo · backend

> Cambios que afectan al resto del equipo (la versión escrita de la sección 7 del CLAUDE.md). **Si eres un agente de IA, lee este archivo antes de empezar cualquier tarea en este repo.**

Es temporal por diseño: cuando un aviso se vuelve regla permanente, se muda al CLAUDE.md y se borra de aquí.
Aquí no van reglas definitivas, secretos, uuid ni cadenas de conexión.

## Acciones pendientes de todos

- **Nuevo: en local la API ahora escucha solo en `127.0.0.1`.** Desde tu equipo todo sigue igual (`http://localhost:3000`). Si necesitas probar desde el celular u otro equipo, dilo en el grupo antes de abrirlo: con el usuario de desarrollo la API no pide credenciales y la base es la de producción, así que quedaría expuesta a toda la red. En Render nada cambia.
- **Agrega a tu `.env`:** `DEV_USER_ENABLED=true` y `DEV_USER_ID=<uuid>`. **Sin eso, toda ruta protegida responde `401`.** Los uuid están en el chat del equipo.
- **Los ids de la base son UUID (`string`), no enteros.**
- **Usuario actual:** `@UseGuards(CurrentUserGuard)` y `@CurrentUser() user: CurrentUserData`, importados solo desde `src/modules/identity-access/index.ts`, nunca desde carpetas internas.
  - `restaurantId` puede ser `null`: usuario que aún no registró su restaurante.
  - `restaurantId` sale siempre de ahí, nunca del body, query ni parámetros de ruta.
- **Corre `npm ci` después de cada pull o merge de `develop`**, antes de cualquier otro comando: si alguien agregó una dependencia, `build`, `test` y `start:dev` fallan sin eso.
- **Corre `npm run typecheck` antes de dar una tarea por terminada**, junto con `npm run lint`, `npm run test` y `npm run build`. Es nuevo del Día 3. `lint` no revisa tipos y `build` no compila las pruebas, así que hasta ahora un error de tipos en un archivo de pruebas podía quedarse sin que nadie lo viera. `typecheck` revisa todo el proyecto, pruebas incluidas.
- **Validación global (`ValidationPipe` en `src/app.setup.ts`), aplica a TODOS los endpoints, no solo a mesas:**
  - **Un campo que no esté en el DTO devuelve `400`** (`forbidNonWhitelisted`), también dentro de objetos anidados. Si un front manda un campo de más, la petición se cae: el body tiene que traer exactamente lo que dice Swagger.
  - **Todo decorador lleva `message` en español diciendo cómo corregir.** Si se te olvida, sale el mensaje por defecto de class-validator, en inglés.
  - No hay conversión implícita: en un body, `"4"` no es un número. Un `@Param('x') x: number` sí se convierte, pero las propiedades numéricas de un DTO de query necesitan `@Type(() => Number)`.
  - Un `:id` de ruta no se valida solo: usa `ParseUUIDPipe` con un mensaje propio. Si no, un id mal formado llega a Postgres y responde `500`.
- **Forma de los errores de toda la API:** `{ statusCode, message, error }`. En los `400` de validación `message` es una **lista** (un mensaje por problema); en los demás errores es un **texto**. El DTO para Swagger es `src/common/dto/error-response.dto.ts`: impórtalo, no lo dupliques.
  - Algunos errores traen además **`errorCode`**, solo los que el front tiene que tratar distinto según el motivo; los que el front solo muestra no lo llevan (regla en el CLAUDE.md, sección 10, "API"). Hoy existen `RESTAURANT_REQUIRED` y `EMAIL_NOT_VERIFIED`.
  - **Nuevo: los errores que da Nest antes de llegar a nuestro código ya tienen la misma forma y el mismo idioma.** JSON mal formado: `400` con "El cuerpo de la solicitud no es un JSON válido."; body demasiado grande: `413` con "La solicitud es demasiado grande."; ruta inexistente: `404` con "Ruta no encontrada.". Los tres traen `statusCode`, `message` (texto) y `error`. Lo hace el filtro global (`unhandled-exception.filter.ts`); tus `400`, `403`, `404` y `409` siguen saliendo sin cambios.
  - **Decisión tomada: cómo responde la API cuando un usuario no puede acceder a algo.** Hay tres situaciones distintas, y cada una tiene su respuesta:
    - **Usuario sin restaurante:** responde `403` con `errorCode: "RESTAURANT_REQUIRED"` (`requireRestaurant`, en `restaurant-operations/shared/restaurant-required.ts`). Ya está en las rutas de mesas y de restaurante, y la web ramifica por ese código para llevar al usuario al registro del restaurante, así que no debe cambiar.
    - **Recurso de otro restaurante:** responde `404`, con el mismo mensaje que si el recurso no existiera. Así la API no revela que existe algo de otro restaurante. Ya se aplica en las mesas.
    - **Rol insuficiente:** responde `403` sin `errorCode`, con el texto que fija el manual en 14.2: "No tienes acceso a esta sección." No lleva `errorCode` porque aquí el front solo muestra el mensaje; como el de "sin restaurante" sí trae su `errorCode`, el front distingue los dos `403` sin leer el texto. Ya está implementado (`@Roles`, PR #30 de Jacobo) en todas las rutas de `restaurant-operations`: mesas, `GET` y `PATCH /v1/restaurants/me`, `POST /v1/restaurants`, `GET` y `PATCH /v1/restaurants/me/status` y `GET /v1/table-logs` (ver "Control de acceso por rol" más abajo).
- **Código compartido entre módulos:** va en `src/common/`, solo si de verdad lo usan varios módulos y no es de ningún dominio. Nada de lógica de negocio (regla en el CLAUDE.md, sección 10).
- **Los mensajes de error que puede ver el usuario siguen la sección 14 del manual de identidad v1.1:**
  - Tuteo, frases cortas y sin culpar, qué pasó + qué hacer.
  - Sin códigos técnicos, emojis ni signos de exclamación, y con mayúscula inicial solamente.
  - Las palabras son las del glosario (14.1). Si el manual ya fija un texto en 14.2, se usa ese tal cual. Por ejemplo, el `401` dice "Tu sesión terminó. Inicia sesión de nuevo."
  - Los mensajes que solo salen cuando alguien llama la API a mano (campo no permitido, cuerpo que no es JSON) se quedan técnicos, porque la interfaz nunca los dispara.
- **Errores no controlados → `500` en español, ya resuelto para toda la API:** si algo falla sin una excepción HTTP (se cae Neon, un bug), la respuesta es `{ statusCode: 500, message: "No pudimos completar la acción. Intenta de nuevo en un momento.", error: "Internal Server Error" }`. El error real queda completo en el log del servidor (Render) y nunca llega al cliente. Lo hace un filtro global (`src/common/filters/unhandled-exception.filter.ts`). **No montes tu propio manejo de errores genéricos** ni envuelvas tu código en `try/catch` solo para devolver un 500: lanza las excepciones HTTP de Nest para los errores que esperas, y deja que lo inesperado llegue al filtro. Tus `400`, `401`, `403`, `404` y `409` salen sin cambios.
- **`GET /v1/health` devuelve también el commit desplegado, además de `status`:** `{ "status": "ok", "commit": "..." }`. En Render trae el SHA del commit que está corriendo; en local viene en `null`, porque la variable (`RENDER_GIT_COMMIT`) la define Render. Sirve para saber qué versión está en producción, que es la primera pregunta cuando algo falla en el ambiente desplegado. El CI lo usa para comprobar que Render desplegó el commit del push.
- **Para que el proyecto siga compilando cuando cambies el esquema de `restaurant-operations`.** Las pruebas reemplazan la base por objetos de prueba, y cada cambio de esquema obliga a tocarlos en el mismo PR:
  - **Columna nueva en una entidad** (por ejemplo, en `Restaurant`): agrégala a los objetos de prueba que declaran ese tipo completo. Para `Restaurant` hoy es uno, `stored` en `restaurants/restaurant-edit.service.spec.ts`; si falta, `npm run typecheck` falla. Una columna NULL va con `null`.
  - **Entidad nueva en el `TypeOrmModule.forFeature([...])` del módulo:** agrega `.overrideProvider(getRepositoryToken(TuEntidad)).useValue({})` en cada e2e que monta `RestaurantOperationsModule` (hoy `test/tables.e2e-spec.ts`, `test/tables-edit.e2e-spec.ts`, `test/restaurant-edit.e2e-spec.ts`, `test/restaurant-status.e2e-spec.ts`, `test/table-status-log-wiring.e2e-spec.ts` y `test/restaurant-registration.e2e-spec.ts`). Si falta, `npm run test:e2e` falla con "Nest can't resolve dependencies of the TuEntidadRepository".
  - **La migración se aplica en Neon antes de fusionar el PR, nunca después.** `develop` se despliega solo a Render y nadie corre las migraciones al desplegar: si el código llega primero, el backend pide columnas que todavía no existen y esas consultas responden `500`. En el orden contrario no pasa nada, siempre que las columnas nuevas acepten NULL o tengan valor por defecto. Lo mismo en local: todos usamos la misma base, así que una rama con columnas que Neon todavía no tiene falla en esas consultas hasta que se aplique su migración.
- **E2e con el usuario de desarrollo apagado (`DEV_USER_ENABLED: 'false'`, por ejemplo para probar el `401`):** agrega `FIREBASE_PROJECT_ID: 'firebase-project-example'` al `load` de tu `ConfigModule.forRoot`, como `test/tables-edit.e2e-spec.ts`. Desde el login con Firebase, con el usuario de desarrollo apagado se usa el resolver de Firebase, que hace `getOrThrow('FIREBASE_PROJECT_ID')` al arrancar: sin esa clave el módulo no inicia y la prueba falla en el CI (que no tiene `.env`), aunque en local pase con tu `.env`. Es un valor de ejemplo: una petición sin token responde `401` antes de llamar a Firebase, así que no hay red ni credenciales.
- **Las cinco migraciones de `develop` ya están aplicadas en Neon** (la última, `1791342586330-AddRestaurantIsOpen`, el 2026-10-08): puedes hacer pull de `develop` sin riesgo.
- **Control de acceso por rol:** toda ruta nueva de restaurante lleva `@Roles(UserRole.RESTAURANT_ADMIN)` (importado de `identity-access/index.ts`) encima de `@UseGuards(CurrentUserGuard)`, en ese orden. Rol insuficiente responde `403` con "No tienes acceso a esta sección." y sin `errorCode`. Afecta a las rutas nuevas de Sergio (abrir y cerrar restaurante y `GET /v1/table-logs`) y de Santiago (registro y consulta del restaurante).
  - **Jacobo:** las tres rutas de Sergio ya lo llevan, con tu aprobación: `GET` y `PATCH /v1/restaurants/me/status` y `GET /v1/table-logs` (PR #31). Mismo orden de decoradores y mismo `403` en Swagger que mesas; sus e2e prueban el rol inválido.

## Por persona

### Elizabeth
- **Tus pendientes:**
  - **Seed:** guardar los `firebase_uid` de `onboarding@example.com` y `demo@example.com`.
  - Probar el login con un token real de Firebase contra Render.
  - Revisar las variables de Render: `FIREBASE_PROJECT_ID` definida; `DEV_USER_ENABLED`, `DEV_USER_ID` y `FIREBASE_AUTH_EMULATOR_HOST` sin definir (CLAUDE.md, sección 10). **Antes de fusionar esta rama a `develop`:** desde ahora, con `FIREBASE_AUTH_EMULATOR_HOST` definida o `DEV_USER_ENABLED=true`, la app no arranca en Render.
  - Configurar en GitHub la regla de `develop` que exija el job `checks` del CI antes de fusionar.
  - Aplicar en Neon la migración de cada rama antes de fusionar su PR (ver "Reglas nuevas de este sprint").
  - Revisar los PR del backend.
- **Los horarios no van en `restaurants`, van en otra tabla (`restaurant_schedules`, una fila por día abierto).** La edición no los puede copiar sola. Además, si un campo de horarios entra en `RestaurantFieldsDto` sin una propiedad con el mismo nombre en `Restaurant`, `npm run typecheck` falla en `restaurant-edit.service.ts` (el `Pick` de `RestaurantChanges`).
- **Carrera conocida en el identificador de mesa:** el índice `UQ_tables_restaurant_id_identifier` compara `lower(trim(identifier))`, así que no cubre que "4" y "04" lleguen a la vez en dos peticiones simultáneas. El chequeo de repetidos de la aplicación (`assertIdentifierAvailable`, en `tables.service.ts`) lo cubre salvo en esa carrera. Es un riesgo bajo y aceptado (hay un dueño por restaurante). Solución futura posible: un índice sobre la clave normalizada.

### Jacobo
- **Ya en `develop`:** el login con Firebase (PR #23: un usuario nuevo se crea con rol `restaurant_admin` y `restaurantId` en `null`), `assignRestaurantIfNone` (PR #24) y el control de acceso por rol (PR #30: `@Roles` y `UserRole`), exportados desde `identity-access/index.ts`. En el backend te queda lo de la web, abajo.
- **Decisión (Jacobo):** el rol de los usuarios de restaurante es `restaurant_admin`, el mismo del seed y del resolver. El control de acceso lo usa en `@Roles(UserRole.RESTAURANT_ADMIN)`.
- **Te toca en la web:** la pantalla del restaurante en `/restaurante`, con la vista de consulta y la de edición. La edición se integra con `PATCH /v1/restaurants/me` (ya existe, detalle abajo). **La vista de consulta usa `GET /v1/restaurants/me`** (Santiago, ver el punto de abajo).
- **El registro del restaurante (Santiago, PBI 3) usa tu `UsersService.assignRestaurantIfNone`** dentro de su transacción, después de crear el restaurante y sus horarios. Si devuelve `false`, responde `409` y se revierte todo. Si cambias la firma o el comportamiento de ese método, avísale a Santiago.
- **Para tu pantalla del restaurante (PBI 4):** `GET /v1/restaurants/me` ya existe (tag `restaurants` en `/docs`). Responde `200` con `{ id, name, category, address, schedules }`; `schedules` trae solo los días que abre, de lunes a domingo: `{ dayOfWeek: 1..7 (1 = lunes), isOpen24h, opensAt: "HH:MM" | null, closesAt: "HH:MM" | null }`. Un cierre menor que la apertura es del día siguiente. `category` y `address` pueden ser `null` en restaurantes viejos (el del seed). Sin restaurante: `403` con `errorCode: "RESTAURANT_REQUIRED"`. El `PATCH` responde exactamente lo mismo, `schedules` incluido.
- **Editar los datos del restaurante (PBI 4): `PATCH /v1/restaurants/me`.** Ya está disponible y documentado en Swagger (`/docs`, tag `restaurants`). La ruta dice `me` porque siempre se edita el restaurante del usuario de la sesión: no hay forma de pedir otro, y el backend no acepta un id de restaurante en la petición. En el body van solo los datos que cambian, de entre `name`, `category`, `address` y `schedules` (mismas reglas que el registro; los espacios de los extremos se recortan), por ejemplo `{ "name": "La Esquina de Ana" }`. Los campos son opcionales, pero hay que mandar al menos uno; los que no mandes no cambian. Si sale bien, responde 200 con el restaurante actualizado, igual que `GET /v1/restaurants/me`: `{ "id": "uuid", "name": "La Esquina de Ana", "category": "colombian", "address": "Calle 72 # 10-34, Bogotá", "schedules": [...] }`.
  - **Qué hacer en la pantalla con cada error.** Todos traen en `message` un texto en español listo para mostrar.
    - **400:** los datos no son válidos (por ejemplo, un nombre vacío o de más de 120 caracteres, una categoría fuera de la lista o una dirección vacía), el body viene vacío ("No hay cambios para guardar…") o trae un campo que no existe. Aquí `message` es una lista: muestra cada texto. Para no llegar al body vacío, puedes desactivar el botón de guardar mientras no haya cambios.
    - **403 con `errorCode: "RESTAURANT_REQUIRED"`:** el usuario todavía no registró su restaurante. Llévalo al registro del restaurante, igual que en las rutas de mesas.
    - **403 sin `errorCode`** ("No tienes acceso a esta sección."): el rol del usuario no permite la acción. Muestra el mensaje.
    - **401 y 500** funcionan igual que en el resto de la API.
  - **Los datos para mostrar en la pantalla los da `GET /v1/restaurants/me`** (ver el punto de arriba).
  - **Nuevo: `PATCH /v1/restaurants/me` ya edita los horarios.** Acepta `schedules` opcional, con la misma forma y las mismas reglas que el registro (un elemento por día abierto, sin repetir, `HH:MM`, sin horas si `isOpen24h` es `true`). **Es un reemplazo completo:** manda la lista entera de días abiertos, no solo el día que cambió; un día que no mandes queda cerrado. `schedules: []` y `null` dan `400` (el restaurante no puede quedar sin días). Si no mandas `schedules`, los horarios no cambian. Todo se guarda en una transacción.
  - **La respuesta del `PATCH` ahora es igual a la de `GET /v1/restaurants/me`**, `schedules` incluido (ordenado de lunes a domingo). Después de guardar ya no hace falta volver a pedir el `GET`: usa lo que devuelve el `PATCH`. La ruta y los campos que ya existían no cambiaron.

### Santiago y Sergio
- `restaurants` ya tiene `name`, `category`, `address` e `is_open`. Quien agregue una columna lo hace con su propia migración de `ALTER`. Nadie recrea la tabla.

### Santiago
- **Ya hecho en el backend:** registro y consulta del restaurante (PBI 3: `POST /v1/restaurants` y `GET /v1/restaurants/me`, con `@Roles(UserRole.RESTAURANT_ADMIN)` como el resto de rutas de restaurante). Para tu formulario:
  - **`POST /v1/restaurants`** recibe exactamente `{ "name", "category", "address", "schedules": [{ "dayOfWeek": 1, "isOpen24h": false, "opensAt": "09:00", "closesAt": "22:00" }] }`. Un elemento por día abierto (al menos uno, sin repetir); un día cerrado no se envía; con `isOpen24h: true` no se envían horas. Las horas van en `HH:MM` de 24 horas: el `TimeSelect` muestra "7:30 p. m.", pero envía `"19:30"`.
  - Responde `201` con `{ id, name, category, address, schedules }`, igual que `GET /v1/restaurants/me`.
  - `400`: `message` es una lista, y los errores de horario dicen el día ("El lunes: …").
  - `409`: el usuario ya tiene restaurante ("Ya registraste tu restaurante. Para cambiar sus datos, entra a Restaurante."). Llévalo a mesas.
  - `403` sin `errorCode` ("No tienes acceso a esta sección."): el rol del usuario no permite registrar. Muestra el mensaje.
- **Un usuario nuevo nace sin restaurante:** el login con Firebase crea su fila en `users` con `restaurantId` en `null`, así que las rutas de mesas y de restaurante le responden `403` con `errorCode: "RESTAURANT_REQUIRED"` hasta que tu registro le asigne uno.
- **`restaurants.is_open` ya existe** (Sergio, PBI 8): `boolean`, NOT NULL, `DEFAULT true`. **Decisión tomada:** un restaurante recién registrado nace Abierto, sin que tu registro haga nada. Tu registro no tiene que mandar `isOpen`, y `RestaurantResponseDto` no lo incluye: el estado tiene sus propios endpoints (`/v1/restaurants/me/status`).
- **Nuevo (Elizabeth): las reglas de horarios y `toScheduleRow` ahora son compartidas con la edición.** Los decoradores de validación de la lista `schedules` pasaron de `RegisterRestaurantDto` a `SchedulesField()`, en `restaurants/dto/restaurant-schedule.dto.ts`, que usan el registro y la edición. `toScheduleRow` pasó de `restaurant-registration.service.ts` a `restaurants/restaurant-schedule-rows.ts`. El registro se comporta igual y sus pruebas pasan sin cambios; si cambias una regla de horarios, cambia también en el `PATCH`.
- **Te falta en la web:** el formulario del registro del restaurante en `/onboarding`, con sus validaciones: "Tu restaurante" (nombre y categoría), "Ubicación" (dirección) y "Horarios" (con el `HoursEditor` del kit). Registro y edición validan igual, en la web y en el backend (`RestaurantFieldsDto`). Luego, su integración con `POST /v1/restaurants` y la prueba del recorrido con el usuario de onboarding (no con `demo@example.com`).

### Sergio
- **Ya en `develop`:** el estado abierto/cerrado (PBI 8: `GET` y `PATCH /v1/restaurants/me/status` y la columna `is_open`) y la bitácora (PBI 9: tabla `table_logs` y `DbTableStatusLog`, que ya registra cambiar el estado, desactivar y reactivar una mesa). Cómo funcionan y cómo se usan: `CLAUDE.md`, sección 10 ("Bitácora de mesas" y "Estado abierto/cerrado del restaurante").
- **Ya en `develop` y en `main` (web, PR #21):** el switch Abierto/Cerrado del topbar, el aviso de cerrado y el cambio de estado con "Deshacer" y confirmación con mesas reservadas. Pendiente en la web: la variante de estado del `Switch` del kit (Sebastián) y probar que el estado persiste en el ambiente desplegado, que necesita el login web.
- **Ya en `develop` (PR #31):** `GET /v1/table-logs` (contrato en el `CLAUDE.md`, "Bitácora de mesas") y `@Roles` en tus rutas de estado.
- **Te toca en la web (PBI 9, bitácora):**
  - Pantalla en `/bitacora`: tabla con fecha y hora, mesa, cambio (estado anterior → estado nuevo, con los mismos chips de mesas) y usuario; filtro por mesa; lo más reciente primero; estado vacío "Aún no hay cambios"; fecha con el formato "30 sept · 7:30 p. m.".
  - Usa `GET /v1/table-logs` (con `?tableId=` para el filtro por mesa).
  - Verifica que cada cambio de estado, desactivación y reactivación genera su registro. Pedir el estado que la mesa ya tiene no genera registro (`CLAUDE.md`, "Bitácora de mesas").

### Sebastián
- **Te toca en la web:** el kit visual del manual (`components/ui`), el AppShell (sidebar con Mesas, Restaurante y Bitácora; topbar con el espacio para el switch Abierto/Cerrado de Sergio) y las pantallas de mesas (crear, cambiar estado, editar y desactivar). Sergio usa del kit el switch, la alerta, el diálogo y el toast.
- **Endpoints que ya puedes consumir** (contrato en Swagger, `/docs`): los de mesas (`POST` y `GET /v1/tables`, `PATCH /v1/tables/:id/status`, `PATCH /v1/tables/:id`, `POST /v1/tables/:id/deactivate` y `POST /v1/tables/:id/reactivate`), `GET` y `PATCH /v1/restaurants/me` (detalle en la sección de Jacobo), `POST /v1/restaurants` (registro, detalle en la sección de Santiago), `GET` y `PATCH /v1/restaurants/me/status`, que reciben y devuelven `{ "isOpen": boolean }` (detalle en el `CLAUDE.md`, sección 10), y `GET /v1/table-logs` (Sergio, PR #31; contrato en el `CLAUDE.md`, "Bitácora de mesas").
- **Desactivar y reactivar ya escriben en la bitácora de verdad** (PBI 9, Sergio). No tienes que cambiar nada: `changeActive` ya llama a `TableStatusLog.record(...)` con el `manager` de su transacción. Lo nuevo es que, si el insert en `table_logs` falla, la petición responde `500` y la mesa no cambia, igual que el cambio de estado.
- **Decisión (Sebastián, 2026-10-06): el campo se llama "Identificador", no "Nombre".** Lo dice el manual en 12.4, y la regla de mostrar "Mesa 04" (14.1) supone un identificador corto. Los mensajes del backend dicen "identificador", igual que la web: "Escribe el identificador de la mesa.", "Usa máximo 10 caracteres en el identificador de la mesa." y "Ya tienes una Mesa 04. Usa otro identificador.". En el código y en la API el campo sigue siendo `identifier`.
- **El horario admite "Abierto 24 horas" (`is_open_24h`).** El HoursEditor del manual no tiene esa opción; hace falta agregarla al kit antes de que Santiago y Jacobo armen sus formularios (registro y edición del restaurante), porque los dos usan el `HoursEditor`.
- Estados de mesa en el backend: `available`, `reserved` y `occupied`. `is_active` va aparte: es una mesa desactivada, no un estado.
- **Una mesa inactiva conserva su estado:** la API puede devolver `status` `occupied` o `reserved` con `isActive: false`, porque desactivar no cambia el estado. En la pantalla, "Inactiva" tiene prioridad sobre el estado.
- **Desactivar una mesa Ocupada o Reservada:** hoy el backend lo permite. Es una decisión de producto pendiente de confirmar por el equipo; hasta entonces sigue permitido.
- **Login con Firebase (PR #23 de Jacobo, ya en `develop`).** Así responde la API:
  - Las rutas protegidas aceptan `Authorization: Bearer <ID token de Firebase>` (`getIdToken()`, que se renueva solo).
  - `401` con "Tu sesión terminó. Inicia sesión de nuevo.": sin token o token inválido/vencido. Llévalo al login.
  - `403` con `errorCode: "RESTAURANT_REQUIRED"`: la cuenta no tiene restaurante. Llévalo al registro del restaurante.
  - El correo debe estar verificado: al registrarse, llama a `sendEmailVerification`, muestra "Revisa tu correo y verifícalo para continuar" y refresca el token (`getIdToken(true)`) o inicia sesión de nuevo.
  - **Decisión (Sebastián y Jacobo, 2026-10-07):** el `401` del correo sin verificar lleva `errorCode: "EMAIL_NOT_VERIFIED"` y el mensaje "Verifica tu correo para continuar.". Los demás `401` siguen sin `errorCode`. La web ya lo distingue (`EMAIL_NOT_VERIFIED_EVENT` en `@/lib/api-client`).
- **Ya puedes cambiar los datos de ejemplo de mesas por la API real.** Contrato completo en Swagger (`/docs`, tag `tables`):
  - **`POST /v1/tables`** recibe exactamente `{ "identifier": "Mesa 4", "capacity": 4 }`. `identifier` es texto de 1 a 10 caracteres (el backend recorta los espacios de los extremos); `capacity` es un **número** entero de 1 a 20. El valor de un input HTML es texto: conviértelo con `Number(...)` antes de enviarlo, porque `"4"` se rechaza. Responde `201` con la mesa creada.
  - **`GET /v1/tables`** responde `200` con todas las mesas del restaurante, **activas e inactivas** (sepáralas con `isActive`), **ordenadas por fecha de creación, de la más antigua a la más nueva**. No vienen ordenadas por identificador, así que "Mesa 10" no queda antes de "Mesa 2". Sin mesas responde `[]`.
  - **Forma de cada mesa** (las dos rutas): `{ "id": "uuid", "identifier": "Mesa 4", "capacity": 4, "status": "available", "isActive": true }`. Sin `createdAt` ni `updatedAt`.
  - **Una mesa nueva siempre nace `available` y activa.** No mandes `status`, `isActive` ni `restaurantId`: cualquier campo de más devuelve `400` y la mesa no se crea. El restaurante sale de la sesión.
  - **Errores** (`message` en español, listo para mostrar):
    - `400`: datos inválidos o campos de más. `message` es una **lista**; muestra cada mensaje.
    - `409`: ya existe una mesa con ese identificador en el restaurante, sin importar mayúsculas ni espacios ("4", "04" y "Mesa 4" son la misma). `message` es un texto, por ejemplo "Ya tienes una Mesa 04. Usa otro identificador.".
    - `403` con `errorCode: "RESTAURANT_REQUIRED"`: el usuario todavía no registra su restaurante. Llévalo al registro del restaurante en vez de mostrar la pantalla de mesas vacía. **Ramifica por `errorCode === 'RESTAURANT_REQUIRED'`**, no por el código HTTP solo, la ruta ni el texto del mensaje: puede haber otros `403` (por ejemplo, por permisos), y esos se muestran como error. Lo puedes probar con el usuario de onboarding.
    - `401`: no hay sesión. Llévalo a iniciar sesión.
- **Error `500`:** si algo falla en el servidor, la API responde `500` con `message: "No pudimos completar la acción. Intenta de nuevo en un momento."` y sin `errorCode`; muéstralo tal cual. **Ese texto no está en el manual:** lo propuso Elizabeth siguiendo la sección 14. Confírmalo o propón otro; cambiarlo es un string.
- **Cambiar el estado de una mesa (PBI 6): `PATCH /v1/tables/:id/status`.** Ya está disponible y documentado en Swagger (`/docs`, tag `tables`). En la URL va el id de la mesa, y en el body solo el estado nuevo, por ejemplo `{ "status": "occupied" }`, con uno de estos tres valores: `available` (Disponible), `reserved` (Reservada) u `occupied` (Ocupada). No mandes nada más en el body: cualquier otro campo, como `isActive`, se rechaza con 400. Si sale bien, responde 200 con la mesa actualizada, con la misma forma que te da `GET /v1/tables`, así que puedes reemplazar la mesa en tu lista con lo que te devuelve.
  - **Tu "Deshacer" puede mandar el estado anterior sin miedo.** Si pides el estado que la mesa ya tiene, el backend no lo trata como error: responde 200 con la mesa tal cual.
  - **Qué hacer en la pantalla con cada error.** Todos traen en `message` un texto en español listo para mostrar.
    - **404:** la mesa ya no existe o no es de este restaurante, por ejemplo porque la lista que tienes en pantalla está desactualizada. Muestra el mensaje y recarga la lista de mesas.
    - **409:** la mesa está inactiva, y una mesa inactiva no cambia de estado. Muestra el mensaje. Si el control de estados solo aparece en mesas activas, no debería pasar.
    - **403 con `errorCode: "RESTAURANT_REQUIRED"`:** el usuario todavía no registró su restaurante. Llévalo al registro del restaurante, igual que en las demás rutas de mesas.
    - **400:** los datos no son válidos, porque el estado no es uno de los tres o el id está mal formado. Aquí `message` es una lista: muestra cada texto. Con la interfaz no debería pasar.
    - **401 y 500** funcionan igual que en el resto de la API.

## Reglas nuevas de este sprint

- **Migraciones:** solo Elizabeth las aplica en Neon (una sola base, compartida y de producción). Quien necesita una la crea con `npm run migration:create` y escribe el SQL a mano, o se la pide a Elizabeth. **No corran `migration:generate`:** con la base compartida genera una migración con las tablas de los demás. Una migración ya aplicada no se edita: el cambio va en una migración nueva. Se aplica antes de fusionar el PR (ver "Acciones pendientes de todos").
- `demo@example.com` está reservado para la demo del Día 7: nadie lo usa para probar. Para eso está `onboarding@example.com`, que se reinicia con el SQL de [`docs/database.md`](docs/database.md#reiniciar-los-datos-de-prueba).

## Deuda conocida (no son tareas)

Riesgos aceptados para el Sprint 1, a revisar más adelante:

- **Rol automático:** toda cuenta del proyecto Firebase con correo verificado entra como `restaurant_admin` y puede registrar un restaurante. Revisarlo antes de que la app móvil use login, si comparte el proyecto Firebase.
- **Sesiones revocadas:** `verifyIdToken` no usa `checkRevoked`, así que un token revocado sirve hasta que vence (máximo 1 hora). Activarlo exige credenciales de cuenta de servicio.
- **TLS con Neon:** la conexión no verifica el certificado del servidor (`rejectUnauthorized: false`).
- **Sin rate limiting:** ninguna ruta limita las peticiones por IP ni por usuario.
- **`npm audit`:** hay vulnerabilidades reportadas en dependencias; falta revisar y aplicar `npm audit fix`.
- **Cuenta bloqueada por otro UID:** cuando el correo ya está vinculado a otro UID de Firebase (por ejemplo, una cuenta borrada y vuelta a crear), la API responde el mismo `401` "Tu sesión terminó" y la web entra en un bucle de login. Un `errorCode` propio necesita acordarse con la web; mientras tanto, el soporte está en `docs/database.md`.
- **Firebase caído o lento:** no hay timeout propio; si Firebase no responde, la API contesta `401` en vez de `503`, y la web lo trata como sesión vencida.
- **`/v1/health` no revisa la base:** responde `ok` aunque Neon no conteste. Agregarlo con Neon gratuito (que se duerme) puede hacer que Render reinicie el servicio en bucle.
- **Consola de Firebase:** revisar que solo estén habilitados Email/Password y Google, y que la vinculación de cuentas por correo esté activa (una cuenta por correo).

## Historial

- **2026-10-09 · Arreglos de la revisión adversarial (Elizabeth).** Sin cambios de esquema, de la API ni dependencias nuevas.
  - **Local:** la API escucha solo en `127.0.0.1` fuera de Render (ver "Acciones pendientes de todos").
  - **Datos:** editar una mesa (identificador o capacidad) corre en una transacción con lock y escribe solo esas columnas; abrir o cerrar el restaurante escribe solo `isOpen`. Antes, un `save()` podía revertir en silencio un cambio de estado de mesa hecho al mismo tiempo, sin dejarlo en la bitácora.
  - **Validación:** el nombre, la dirección y el identificador miden su largo en caracteres Unicode, como Postgres, así que un texto con emojis o selectores de variante ya no termina en `500`. El identificador rechaza caracteres invisibles ("El identificador no puede incluir caracteres invisibles."). Los emojis con unión (por ejemplo, familias) también se rechazan en el identificador, porque llevan un carácter invisible.
  - **Login:** si el correo ya está vinculado a otro UID, el log del servidor lo registra sin datos personales; la respuesta no cambia. SQL de soporte en `docs/database.md`.
  - **Base:** espera máximo 10 s para conectarse a Neon, en vez de esperar sin límite.
  - **Pruebas:** e2e de `401` y `403` por rol en `PATCH /v1/restaurants/me`, de `403` por rol al editar una mesa, y de que el `404` de una mesa ajena consulta solo el restaurante de la sesión.

- **2026-10-09 · Endurecimiento e integración del backend (Elizabeth).** Sin cambios de esquema ni dependencias nuevas.
  - **Arranque:** en un ambiente desplegado (`RENDER` o `NODE_ENV=production`), la app no arranca si `FIREBASE_AUTH_EMULATOR_HOST` está definida o `DEV_USER_ENABLED` es `true`. El error nombra la variable, nunca su valor.
  - **Login:** si Firebase rechaza un token, el log del servidor registra solo el código del error (por ejemplo `auth/id-token-expired`), sin el token. La respuesta sigue siendo el mismo `401`.
  - **API:** `PATCH /v1/restaurants/me` acepta `schedules` y responde como `GET /v1/restaurants/me` (ver la sección de Jacobo). JSON mal formado, `413` y ruta inexistente responden en español y con `error` (ver "Acciones pendientes de todos").
  - **Otros:** el cliente de Redis se cierra al apagar la app, y el ejemplo de Swagger del identificador de mesa es `"04"`.
- **2026-10-09 · Limpieza tras la auditoría de `develop` (Elizabeth).** Sin cambios de esquema ni de la API.
  - **Código:** `TABLE_ID_INVALID` ("El id de la mesa no es un UUID válido.") pasó a `restaurant-operations/shared/table-id-invalid.ts`, y lo importan `tables.controller.ts` y `GET /v1/table-logs`; ya no se exporta desde el controlador de mesas. `redis.config.ts` registra el error de conexión con el `Logger` de Nest.
  - **Docs:** el README lista `FIREBASE_PROJECT_ID` entre las variables de Render y describe el login con Firebase; el `CLAUDE.md` marca el join de la bitácora a `users` como excepción conocida del Sprint 1.
  - **Avisos cumplidos que salen de la sección de Elizabeth:**
    - Registro del restaurante (Santiago): `PATCH /v1/restaurants/me` ya acepta y devuelve `category` y `address` (`category` solo de `RESTAURANT_CATEGORIES`; `address` obligatoria, recortada y de máximo 255 caracteres; `null` se rechaza). Santiago ajustó la prueba de Swagger de `test/restaurant-edit.e2e-spec.ts`, que ahora espera `get` y `patch` y los campos `name`, `category` y `address`.
    - Sergio exportó `TABLE_ID_INVALID` desde `tables/tables.controller.ts` para reutilizarlo en la bitácora; hoy vive en `shared/`.
- **2026-10-08 · Sergio · PBI 9 · Crear pantalla de bitácora (parte backend): `GET /v1/table-logs`.** Sin cambios de esquema.
  - **Qué quedó listo:**
    - `GET /v1/table-logs?tableId=<uuid opcional>` → `200` con `[{ id, tableId, tableIdentifier, previousStatus, newStatus, changedAt, userEmail }]`, del más reciente al más antiguo, máximo 200 filas, sin paginación. Contrato completo en el `CLAUDE.md` ("Bitácora de mesas") y en Swagger (tag `table-logs`).
    - Filtra siempre por el restaurante de la sesión con un join a `tables`. Un `tableId` de otro restaurante o que no existe responde `[]`. Cualquier otro parámetro de la consulta (por ejemplo `restaurantId`) da `400`.
    - `@Roles(UserRole.RESTAURANT_ADMIN)` en `GET /v1/table-logs` y en `GET` y `PATCH /v1/restaurants/me/status` (aprobado por Jacobo).
  - **Para quién / qué deben hacer:**
    - **Sebastián (web):** la pantalla `/bitacora` la hace Sergio; si necesitas los registros en otra pantalla, usa este endpoint.
    - **Elizabeth:** se exporta `TABLE_ID_INVALID` de `tables/tables.controller.ts` (ver tu sección).
    - **Todos:** toda e2e que monte `RestaurantOperationsModule` ya tenía `.overrideProvider(getRepositoryToken(TableLog)).useValue({})`; no hace falta nada nuevo.
  - **Rama / PR:** `feat/sprint1-consulta-bitacora` → `develop`.
  - **Pendiente o conocido:**
    - Las pruebas no ejecutan SQL real (no hay base en las pruebas): la unitaria fija la consulta y la e2e prueba el aislamiento con un repositorio simulado. Sergio la verifica a mano en local contra Neon, solo con `GET`.
    - Índices: `IDX_table_logs_table_id_changed_at` cubre el filtro por mesa; sin filtro, con el volumen del Sprint 1 no hace falta un índice nuevo.
- **2026-10-08 · Documentos al día con `develop` (Elizabeth, rama `chore/sprint1-pending-fixes`).** Sin cambios de esquema ni de la API. Las cinco migraciones constan como aplicadas en Neon (`AddRestaurantIsOpen` el 2026-10-08), el login con Firebase como fusionado y el valor por defecto de `is_open` como decidido (`true`); se borraron los avisos ya cumplidos (migraciones pendientes y contrato de la bitácora), y cada sección por persona quedó con lo que ya existe, lo que le falta y sus reglas. En `identity-access`, la detección del `23505` quedó en una sola función (`users/unique-violation.ts`), sin cambiar el comportamiento. Pruebas nuevas, entre ellas `test/table-status-log-wiring.e2e-spec.ts`, que comprueba que el módulo usa `DbTableStatusLog`.
- **2026-10-07 · PR del registro y la consulta del restaurante (Santiago, PBI 3).** Sin cambios de esquema.
  - **Rutas nuevas:** `POST /v1/restaurants` (registra el restaurante del usuario de la sesión con sus horarios; `409` si ya tiene uno) y `GET /v1/restaurants/me` (el restaurante con sus horarios; `403 RESTAURANT_REQUIRED` sin restaurante).
  - **Validaciones:** `category` y `address` entran en `RestaurantFieldsDto`, así que el `PATCH /v1/restaurants/me` de Elizabeth también los acepta y los devuelve. Los horarios van en `RegisterRestaurantDto` y `RestaurantScheduleDto`: al menos un día, sin repetir, horas `HH:MM`, distintas entre sí, y ninguna hora en un día de 24 horas.
  - **Asociación al usuario:** dentro de la misma transacción, con `UsersService.assignRestaurantIfNone` de Jacobo (PR #24). Si el usuario ya tiene restaurante, `409` y no se guarda nada.
  - **Control de acceso:** al traer el PR #30, las dos rutas llevan `@Roles(UserRole.RESTAURANT_ADMIN)`; el `401` documenta `EMAIL_NOT_VERIFIED`. La descripción de Swagger de `PATCH /v1/restaurants/me` quedó al día (nombre, categoría y dirección; los horarios todavía no).
- **2026-10-06 · Sergio · PBI 8 · Implementar estado operativo en backend.** Cambia el esquema.
  - **Qué quedó listo:**
    - la columna `restaurants.is_open` (`boolean`, NOT NULL, `DEFAULT true`; propiedad `isOpen` de `Restaurant`), con la migración `1791342586330-AddRestaurantIsOpen`;
    - `GET /v1/restaurants/me/status` → `200 { "isOpen": boolean }`;
    - `PATCH /v1/restaurants/me/status` con `{ "isOpen": boolean }` → `200 { "isOpen": boolean }`. El restaurante sale de la sesión; `401` sin sesión, `403 RESTAURANT_REQUIRED` sin restaurante y `400` si `isOpen` no es booleano o hay campos de más. Detalle en el `CLAUDE.md` (sección 10, "Estado abierto/cerrado del restaurante") y en Swagger;
    - el cambio es manual: no mira los horarios. El conteo de mesas reservadas para confirmar el cierre lo hace la web; el endpoint no lo devuelve.
  - **Para quién / qué deben hacer:**
    - **Todos:** quien cree un objeto `Restaurant` completo en una prueba tiene que agregar `isOpen` (ya está en `stored` de `restaurant-edit.service.spec.ts`).
  - **Rama / PR:** `feat/sprint1-estado-restaurante-backend` → `develop` (PR #26, fusionado). Los endpoints llevan `@ApiBearerAuth()` y el `401` documenta `EMAIL_NOT_VERIFIED`, como los demás controllers.
  - **Migración y decisiones:** `AddRestaurantIsOpen` se aplicó en Neon el 2026-10-08. El valor por defecto queda en `true`: un restaurante nuevo nace Abierto.
- **2026-10-06 · Sergio · PBI 9 · Crear estructura de bitácora en base de datos + Registrar cambios desde la lógica de mesas.** Cambia el esquema.
  - **Qué quedó listo:**
    - la tabla `table_logs` (entidad `TableLog`), con la migración `1791340136261-CreateTableLogs`;
    - `DbTableStatusLog`, la implementación real de `TableStatusLog`, que reemplaza a `NoopTableStatusLog` (borrado). Cambiar el estado, desactivar y reactivar una mesa ya guardan su registro en la misma transacción.
    - con el visto bueno de Elizabeth, el comentario de `tables/table-status-log.ts` ya apunta a `DbTableStatusLog` (solo el comentario).
    - `table_logs` queda sin `restaurant_id` (confirmado con Elizabeth): toda consulta filtra por el restaurante de la sesión con un join a `tables` (reglas en el `CLAUDE.md`).
  - **Para quién / qué deben hacer:**
    - **Elizabeth y Sebastián:** nada que cambiar. Sus servicios ya llaman a `TableStatusLog.record(change, manager)` dentro de su transacción, y ahora guarda de verdad.
    - **Todos:** si montan `RestaurantOperationsModule` en un e2e nuevo, agreguen `.overrideProvider(getRepositoryToken(TableLog)).useValue({})`.
  - **Rama / PR:** `feat/sprint1-bitacora-estructura` → `develop` (PR #25, fusionado). La migración `CreateTableLogs` ya está aplicada en Neon.
  - **Pendiente o conocido:**
    - la consulta de la bitácora para la pantalla (`GET /v1/table-logs`) llega en otro PR.
- **2026-10-06 · Limpieza de documentación y pruebas (Elizabeth, rama `chore/sprint1-docs-and-tests-cleanup`).** Solo documentación y pruebas, sin cambios de comportamiento ni de la API. Migraciones aplicadas al día en `docs/database.md` y en este archivo; los textos de la mesa dicen "identificador" en todo `AVISOS.md`; `CLAUDE.md` (sección 10), `README.md` y `AGENTS.md` al día con el código. Pruebas nuevas: 404 de `deactivate` y `reactivate`, `identifier: null` en `PATCH /v1/tables/:id` y `table-identifier.spec.ts`.
- **2026-10-06 · PR de editar, desactivar y reactivar mesas (Sebastián, PBI 7).**
  - **Rutas nuevas:** `PATCH /v1/tables/:id` (identificador y/o capacidad, al menos uno), `POST /v1/tables/:id/deactivate` y `POST /v1/tables/:id/reactivate` (vuelve como `available`).
  - **Bitácora:** desactivar y reactivar se registran en la misma transacción, con `inactive` como estado.
  - **Identificador:** reglas compartidas con crear (`table-identifier.ts`): repetidos normalizados ("4" = "04" = "Mesa 4"), máximo 10 caracteres y textos iguales a los de la web.
  - **Sin cambios de esquema.**
- **2026-10-06 · PR del modelo de usuarios (Jacobo, PBI 2).** Cambia el esquema; la migración `1791268910540-AddFirebaseUidToUsers` se aplicó en Neon el 2026-10-06. Agrega `users.firebase_uid` (`varchar(128)`, NULL, único: `UQ_users_firebase_uid`). `UsersService` queda registrado en `identity-access` y exportado (`findByFirebaseUid`, `findById` y `create`). Sin endpoints todavía: el login con Firebase llega en otro PR.
- **2026-10-05 · PR del modelo de datos del restaurante (Santiago, PBI 3).** Cambia el esquema; **la migración `AddRestaurantProfile` se aplicó en Neon el 2026-10-05**. Agrega a `restaurants` las columnas `category` (lista cerrada de categorías, constante `RESTAURANT_CATEGORIES`) y `address`, ambas NULL en la base, y crea `restaurant_schedules`: una fila por día abierto, con `is_open_24h` o con hora de apertura y cierre (un cierre menor que la apertura es del día siguiente). Detalle y reglas en [`docs/database.md`](docs/database.md). Sin endpoints todavía: el registro llega en otro PR.
- **Día 3 · 2026-10-05 · Tres PR de Elizabeth: cambiar el estado de una mesa (PBI 6), editar los datos del restaurante (PBI 4) y verificar el despliegue en el CI (PBI 10).** Ninguno cambia el esquema.
  - **Cambio de estado:** `PATCH /v1/tables/:id/status`, con el cambio de estado y el registro en la bitácora en una sola transacción. La bitácora se usa a través de la interfaz `TableStatusLog`, con una implementación de relleno hasta que llegue la de Sergio. Decorador `@TableIdParam()` para validar el `:id`. Script nuevo `npm run typecheck` y arreglo del único error de tipos que encontró (`dev-user.resolver.spec.ts`).
  - **Edición del restaurante:** `PATCH /v1/restaurants/me`, que hoy solo edita el nombre; categoría, dirección y horarios esperan las columnas de Santiago. `RestaurantFieldsDto` es el archivo único de las validaciones del restaurante que comparten el registro (Santiago) y la edición, y `RestaurantResponseDto` hace que la consulta y la edición respondan igual. El `GET` no está incluido porque es de Santiago. El `403` del usuario sin restaurante pasa a `restaurant-operations/shared/restaurant-required.ts` para todo el módulo, con el texto general "Primero registra tu restaurante."
  - **CI y despliegue:** el CI corre en cada PR hacia `develop` y en cada push a `develop`, con `npm ci`, lint, typecheck, pruebas unitarias, e2e y build. Después de un push a `develop`, espera hasta 15 minutos a que Render sirva ese mismo commit, y solo entonces marca el despliegue como exitoso en GitHub; si sigue la versión anterior, el job sale en rojo. Para eso `GET /v1/health` devuelve también el campo `commit`.
- **Día 2 · 2026-10-04 · PR de crear y listar mesas (Elizabeth, PBI 5).** `POST /v1/tables` y `GET /v1/tables`. Dependencias nuevas `class-validator` y `class-transformer`. `ValidationPipe` global en `src/app.setup.ts` (`whitelist`, `forbidNonWhitelisted`, `transform`, mensajes en español sin repetidos por campo). Filtro global de errores no controlados (`500` en español, detalle solo en el log). Carpeta `src/common/` con el filtro y con `ErrorResponseDto`, que incluye el campo opcional `errorCode` (opción nativa de Nest 12; hoy solo `RESTAURANT_REQUIRED`). Sin cambios de esquema.
- **Día 1 · 2026-10-04 · PR de la base del backend (Elizabeth).** Esquema inicial (`users`, `restaurants`, `tables`) con ids UUID, migraciones de TypeORM, `CurrentUser` con usuario de desarrollo (`DEV_USER_ENABLED`, `DEV_USER_ID`, cabecera `x-dev-user-id`), seed (`npm run seed`) y `docs/database.md`.
