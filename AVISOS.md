# AVISOS · DiNNo · backend

> Cambios que afectan al resto del equipo (la versión escrita de la sección 7 del CLAUDE.md). **Si eres un agente de IA, lee este archivo antes de empezar cualquier tarea en este repo.**

Es temporal por diseño: cuando un aviso se vuelve regla permanente, se muda al CLAUDE.md y se borra de aquí.
Aquí no van reglas definitivas, secretos, uuid ni cadenas de conexión.

## Acciones pendientes de todos



- **Nuevo (2026-10-25): Google Cloud (Maps) ya está configurado.** Detalle en «Equipo de Google Cloud». Dos reglas para todos:
  - **Nadie entra a la consola de Google Cloud con la cuenta del equipo** salvo Santiago. Los inicios de sesión desde muchos equipos y redes dispararon el bloqueo antifraude de Google; las llaves se piden a Santiago por privado.
  - **Nadie pulsa «Actualizar» en el banner de la prueba gratuita:** pasa la cuenta a pago completo y Google podría cobrar a la tarjeta de un integrante.
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
  - Algunos errores traen además **`errorCode`**, solo los que el front tiene que tratar distinto según el motivo; los que el front solo muestra no lo llevan (regla en el CLAUDE.md, sección 11, "API"). Hoy existen `RESTAURANT_REQUIRED`, `EMAIL_NOT_VERIFIED` y, desde el Sprint 2, `ACCOUNT_NOT_ENABLED`, `PROFILE_REQUIRED`, `DINER_ACCOUNT`, `RESTAURANT_ACCOUNT` `RESTAURANT_NOT_FOUND` (404 del detalle público), `ADDRESS_NOT_FOUND` (404) y `GEOCODING_UNAVAILABLE` (503) de `GET /v1/geocode`.
  - **Nuevo: los errores que da Nest antes de llegar a nuestro código ya tienen la misma forma y el mismo idioma.** JSON mal formado: `400` con "El cuerpo de la solicitud no es un JSON válido."; body demasiado grande: `413` con "La solicitud es demasiado grande."; ruta inexistente: `404` con "Ruta no encontrada.". Los tres traen `statusCode`, `message` (texto) y `error`. Lo hace el filtro global (`unhandled-exception.filter.ts`); tus `400`, `403`, `404` y `409` siguen saliendo sin cambios.
  - **Decisión tomada: cómo responde la API cuando un usuario no puede acceder a algo.** Hay tres situaciones distintas, y cada una tiene su respuesta:
    - **Usuario sin restaurante:** responde `403` con `errorCode: "RESTAURANT_REQUIRED"` (`requireRestaurant`, en `restaurant-operations/shared/restaurant-required.ts`). Ya está en las rutas de mesas y de restaurante, y la web ramifica por ese código para llevar al usuario al registro del restaurante, así que no debe cambiar.
    - **Recurso de otro restaurante:** responde `404`, con el mismo mensaje que si el recurso no existiera. Así la API no revela que existe algo de otro restaurante. Ya se aplica en las mesas.
    - **Cuenta que no es de restaurante:** responde `403` `DINER_ACCOUNT` (comensal) o `ACCOUNT_NOT_ENABLED` (sin perfil), con los textos del contrato (`CLAUDE.md`, sección 10). El front ramifica por `errorCode`, igual que con "sin restaurante". (cambió el 2026-10-15, ver Historial) Ya está implementado (`@Roles`, PR #30 de Jacobo) en todas las rutas de `restaurant-operations`: mesas, `GET` y `PATCH /v1/restaurants/me`, `POST /v1/restaurants`, `GET` y `PATCH /v1/restaurants/me/status` y `GET /v1/table-logs` (ver "Control de acceso por rol" más abajo).
- **Código compartido entre módulos:** va en `src/common/`, solo si de verdad lo usan varios módulos y no es de ningún dominio. Nada de lógica de negocio (regla en el CLAUDE.md, sección 11).
- **Los mensajes de error que puede ver el usuario siguen la sección 14 del manual de identidad v1.1:**
  - Tuteo, frases cortas y sin culpar, qué pasó + qué hacer.
  - Sin códigos técnicos, emojis ni signos de exclamación, y con mayúscula inicial solamente.
  - Las palabras son las del glosario (14.1). Si el manual ya fija un texto en 14.2, se usa ese tal cual. Por ejemplo, el `401` dice "Tu sesión terminó. Inicia sesión de nuevo."
  - Los mensajes que solo salen cuando alguien llama la API a mano (campo no permitido, cuerpo que no es JSON) se quedan técnicos, porque la interfaz nunca los dispara.
- **Errores no controlados → `500` en español, ya resuelto para toda la API:** si algo falla sin una excepción HTTP (se cae Neon, un bug), la respuesta es `{ statusCode: 500, message: "No pudimos completar la acción. Intenta de nuevo en un momento.", error: "Internal Server Error" }`. El error real queda completo en el log del servidor (Render) y nunca llega al cliente. Lo hace un filtro global (`src/common/filters/unhandled-exception.filter.ts`). **No montes tu propio manejo de errores genéricos** ni envuelvas tu código en `try/catch` solo para devolver un 500: lanza las excepciones HTTP de Nest para los errores que esperas, y deja que lo inesperado llegue al filtro. Tus `400`, `401`, `403`, `404` y `409` salen sin cambios.
- **`GET /v1/health` devuelve también el commit desplegado, además de `status`:** `{ "status": "ok", "commit": "..." }`. En Render trae el SHA del commit que está corriendo; en local viene en `null`, porque la variable (`RENDER_GIT_COMMIT`) la define Render. Sirve para saber qué versión está en producción, que es la primera pregunta cuando algo falla en el ambiente desplegado. El CI lo usa para comprobar que Render desplegó el commit del push.
- **Para que el proyecto siga compilando cuando cambies el esquema de `restaurant-operations`.** Las pruebas reemplazan la base por objetos de prueba, y cada cambio de esquema obliga a tocarlos en el mismo PR:
  - **Columna nueva en una entidad** (por ejemplo, en `Restaurant`): agrégala a los objetos de prueba que declaran ese tipo completo. Para `Restaurant` hoy es uno, `stored` en `restaurants/restaurant-edit.service.spec.ts`; si falta, `npm run typecheck` falla. Una columna NULL va con `null`.
  - **Nuevo: toda e2e que monte `RestaurantOperationsModule` importa `EventEmitterModule.forRoot()`** (de `@nestjs/event-emitter`), porque los servicios de mesas, estado y edición del restaurante ahora inyectan `EventEmitter2`. Si falta, `npm run test:e2e` falla con "Nest can't resolve dependencies of the TablesService (…, ?)". Las 11 e2e que lo montan ya lo tienen.
  - **Entidad nueva en el `TypeOrmModule.forFeature([...])` del módulo:** agrega `.overrideProvider(getRepositoryToken(TuEntidad)).useValue({})` en cada e2e que monta `RestaurantOperationsModule` (hoy `test/tables.e2e-spec.ts`, `test/tables-edit.e2e-spec.ts`, `test/restaurant-edit.e2e-spec.ts`, `test/restaurant-status.e2e-spec.ts`, `test/table-status-log-wiring.e2e-spec.ts`, `test/restaurant-registration.e2e-spec.ts`, `test/table-logs.e2e-spec.ts`, `test/accounts.e2e-spec.ts` y `test/public-restaurant.e2e-spec.ts`). Si falta, `npm run test:e2e` falla con "Nest can't resolve dependencies of the TuEntidadRepository".
  - **Nuevo: `test/support/` tiene piezas compartidas para las e2e de las rutas del comensal** (hoy las usan `test/search.e2e-spec.ts` y `test/public-restaurant.e2e-spec.ts`). No son pruebas: Vitest solo corre los `*.e2e-spec.ts`.
    - `fake-database.ts`: `FakeDatabaseModule.with({ Restaurant: fakeRepository(filas), ... })` reemplaza el `DataSource` global, sin PostgreSQL, para los lectores de `search-availability` que usan `DataSource.getRepository('<Entidad>')`. `fakeRepository` tiene `find` y `findOne` (los dos `vi.fn`, para comprobar si se consultó la base), aplica `Between`, `In` e igualdad como lo haría Postgres (NULL nunca coincide) y devuelve solo las columnas del `select`. Si un lector pide una entidad que no se simuló, falla con un error claro.
    - `test-accounts.ts`: las tres cuentas por token (`diner`, `owner`, `noProfile` sin fila en `users`), `testUsers(idDelRestauranteDelDueño)`, `usersRepository(users)` y `fakeFirebaseAuth`. Se usan con `.overrideProvider(FIREBASE_AUTH).useValue(() => fakeFirebaseAuth)` y `.overrideProvider(getRepositoryToken(User)).useValue(usersRepository(testUsers(...)))`.
    - `test/accounts.e2e-spec.ts`, `test/availability-wiring.e2e-spec.ts` y `test/table-logs.e2e-spec.ts` no los usan porque sus simulacros son distintos (más cuentas y un repositorio de usuarios que guarda, una base sin filtros, un query builder). Úsalos en una e2e nueva solo si te sirven tal cual.
  - **La migración se aplica en Neon antes de fusionar el PR, nunca después.** `develop` se despliega solo a Render y nadie corre las migraciones al desplegar: si el código llega primero, el backend pide columnas que todavía no existen y esas consultas responden `500`. En el orden contrario no pasa nada, siempre que las columnas nuevas acepten NULL o tengan valor por defecto. Lo mismo en local: todos usamos la misma base, así que una rama con columnas que Neon todavía no tiene falla en esas consultas hasta que se aplique su migración.
- **E2e con el usuario de desarrollo apagado (`DEV_USER_ENABLED: 'false'`, por ejemplo para probar el `401`):** agrega `FIREBASE_PROJECT_ID: 'firebase-project-example'` al `load` de tu `ConfigModule.forRoot`, como `test/tables-edit.e2e-spec.ts`. Desde el login con Firebase, con el usuario de desarrollo apagado se usa el resolver de Firebase, que hace `getOrThrow('FIREBASE_PROJECT_ID')` al arrancar: sin esa clave el módulo no inicia y la prueba falla en el CI (que no tiene `.env`), aunque en local pase con tu `.env`. Es un valor de ejemplo: una petición sin token responde `401` antes de llamar a Firebase, así que no hay red ni credenciales.
- **Las seis migraciones de `develop` ya están aplicadas en Neon** (la última, `1792087341885-AddDinerRoleAndRestaurantLocation`, el 2026-10-15; el seed ya escribió `latitude` y `longitude`): puedes hacer pull de `develop` sin riesgo.
- **Control de acceso por rol:** toda ruta nueva de restaurante lleva `@Roles(UserRole.RESTAURANT_ADMIN)` (importado de `identity-access/index.ts`) encima de `@UseGuards(CurrentUserGuard)`, en ese orden. Una cuenta que no es de restaurante responde `403` `DINER_ACCOUNT` (comensal) o `ACCOUNT_NOT_ENABLED` (sin perfil) (cambió el 2026-10-15, ver Historial). Afecta a las rutas nuevas de Sergio (abrir y cerrar restaurante y `GET /v1/table-logs`) y de Santiago (registro y consulta del restaurante).
  - **Jacobo:** las tres rutas de Sergio ya lo llevan, con tu aprobación: `GET` y `PATCH /v1/restaurants/me/status` y `GET /v1/table-logs` (PR #31). Mismo orden de decoradores y mismo `403` en Swagger que mesas; sus e2e prueban que un comensal recibe `DINER_ACCOUNT`.

## Por persona

### Todos (Sprint 2)
**Todos:** solo Elizabeth corre migraciones y seed contra Neon.

### Elizabeth
- **Tus pendientes:**
  - ~~**Recibir y configurar `GOOGLE_GEOCODING_API_KEY`** en Render y en tu `.env`, y comprobar `GET /v1/geocode` en Render.~~ **Hecho** el 2026-10-26: `200` en local y en Render (ver «Historial»). Falta avisar en el grupo y confirmarle a Santiago para que borre el mensaje.
  - **Seed:** guardar los `firebase_uid` de `onboarding@example.com` y `demo@example.com`.
  - ~~Probar el inicio de sesión con un token real de Firebase contra Render.~~ **Hecho** el 2026-10-26 con las tres cuentas: Casa16, Casa 72 y el comensal (ver «Historial»).
  - ~~Revisar las variables de Render: `FIREBASE_PROJECT_ID` definida; `DEV_USER_ENABLED`, `DEV_USER_ID` y `FIREBASE_AUTH_EMULATOR_HOST` sin definir (CLAUDE.md, sección 11). **Antes de fusionar esta rama a `develop`:** desde ahora, con `FIREBASE_AUTH_EMULATOR_HOST` definida o `DEV_USER_ENABLED=true`, la app no arranca en Render.~~ **Hecho** (confirmado por Elizabeth el 2026-10-15).
  - ~~Configurar en GitHub la regla de `develop` que exija el job `checks` del CI antes de fusionar.~~ **Hecho** (confirmado por Elizabeth el 2026-10-15).
  - Aplicar en Neon la migración de cada rama antes de fusionar su PR (ver "Reglas nuevas de este sprint").
  - Revisar los PR del backend.
  - ~~**Seed (Santiago):** integrar `src/seed-data/restaurants.json` (`feature/s2-seed-restaurantes`) a `seed.ts`.~~ **Hecho** el 2026-10-24 (`feat/sprint2-cierre-backend`, ver «Historial»).
  - ~~**Correr el seed en Neon** después de fusionar `feat/sprint2-cierre-backend`.~~ **Hecho:** en Neon están los 15 restaurantes con sus dueños y Casa 72 tiene como dueño `dinnoteam2026+casa72@gmail.com` (comprobado el 2026-10-26). Su cuenta de Firebase quedó creada y verificada el 2026-10-26, y el primer inicio de sesión vinculó su `firebase_uid`.
- **Los horarios no van en `restaurants`, van en otra tabla (`restaurant_schedules`, una fila por día abierto).** La edición no los puede copiar sola. Además, si un campo de horarios entra en `RestaurantFieldsDto` sin una propiedad con el mismo nombre en `Restaurant`, `npm run typecheck` falla en `restaurant-edit.service.ts` (el `Pick` de `RestaurantChanges`).
- **Carrera conocida en el identificador de mesa:** el índice `UQ_tables_restaurant_id_identifier` compara `lower(trim(identifier))`, así que no cubre que "4" y "04" lleguen a la vez en dos peticiones simultáneas. El chequeo de repetidos de la aplicación (`assertIdentifierAvailable`, en `tables.service.ts`) lo cubre salvo en esa carrera. Es un riesgo bajo y aceptado (hay un dueño por restaurante). Solución futura posible: un índice sobre la clave normalizada.

### Jacobo
- **Ya en `develop`:** el login con Firebase (PR #23; desde el Sprint 2 el login ya no crea usuarios: una cuenta sin fila en `users` recibe `ACCOUNT_NOT_ENABLED` en la web, ver la entrada del 2026-10-15 en "Historial"), `assignRestaurantIfNone` (PR #24) y el control de acceso por rol (PR #30: `@Roles` y `UserRole`), exportados desde `identity-access/index.ts`. En el backend te queda lo de la web, abajo.
- **Decisión (Jacobo):** el rol de los usuarios de restaurante es `restaurant_admin`, el mismo del seed y del resolver. El control de acceso lo usa en `@Roles(UserRole.RESTAURANT_ADMIN)`.
- **Te toca en la web:** la pantalla del restaurante en `/restaurante`, con la vista de consulta y la de edición. La edición se integra con `PATCH /v1/restaurants/me` (ya existe, detalle abajo). **La vista de consulta usa `GET /v1/restaurants/me`** (Santiago, ver el punto de abajo).
- **El registro del restaurante (Santiago, PBI 3) usa tu `UsersService.assignRestaurantIfNone`** dentro de su transacción, después de crear el restaurante y sus horarios. Si devuelve `false`, responde `409` y se revierte todo. Si cambias la firma o el comportamiento de ese método, avísale a Santiago.
- **Para tu pantalla del restaurante (PBI 4):** `GET /v1/restaurants/me` ya existe (tag `restaurants` en `/docs`). Responde `200` con `{ id, name, category, address, latitude, longitude, schedules }` (`latitude` y `longitude` desde el Sprint 2, `number | null`; detalle en la sección de Santiago); `schedules` trae solo los días que abre, de lunes a domingo: `{ dayOfWeek: 1..7 (1 = lunes), isOpen24h, opensAt: "HH:MM" | null, closesAt: "HH:MM" | null }`. Un cierre menor que la apertura es del día siguiente. `category` y `address` pueden ser `null` en restaurantes viejos (el del seed). Sin restaurante: `403` con `errorCode: "RESTAURANT_REQUIRED"`. El `PATCH` responde exactamente lo mismo, `schedules` incluido.
- **Editar los datos del restaurante (PBI 4): `PATCH /v1/restaurants/me`.** Ya está disponible y documentado en Swagger (`/docs`, tag `restaurants`). La ruta dice `me` porque siempre se edita el restaurante del usuario de la sesión: no hay forma de pedir otro, y el backend no acepta un id de restaurante en la petición. En el body van solo los datos que cambian, de entre `name`, `category`, `address`, `latitude` + `longitude` (juntas, desde el Sprint 2) y `schedules` (mismas reglas que el registro; los espacios de los extremos se recortan), por ejemplo `{ "name": "La Esquina de Ana" }`. Los campos son opcionales, pero hay que mandar al menos uno; los que no mandes no cambian. Si sale bien, responde 200 con el restaurante actualizado, igual que `GET /v1/restaurants/me`: `{ "id": "uuid", "name": "La Esquina de Ana", "category": "colombian", "address": "Calle 72 # 10-34, Bogotá", "schedules": [...] }`.
  - **Qué hacer en la pantalla con cada error.** Todos traen en `message` un texto en español listo para mostrar.
    - **400:** los datos no son válidos (por ejemplo, un nombre vacío o de más de 120 caracteres, una categoría fuera de la lista o una dirección vacía), el body viene vacío ("No hay cambios para guardar…") o trae un campo que no existe. Aquí `message` es una lista: muestra cada texto. Para no llegar al body vacío, puedes desactivar el botón de guardar mientras no haya cambios.
    - **403 con `errorCode: "RESTAURANT_REQUIRED"`:** el usuario todavía no registró su restaurante. Llévalo al registro del restaurante, igual que en las rutas de mesas.
    - **403 con `errorCode: "DINER_ACCOUNT"` o `"ACCOUNT_NOT_ENABLED"`:** la cuenta no es de restaurante (comensal o sin perfil). Muestra el texto del contrato con *Cerrar sesión* (`CLAUDE.md`, sección 10).
    - **401 y 500** funcionan igual que en el resto de la API.
  - **Los datos para mostrar en la pantalla los da `GET /v1/restaurants/me`** (ver el punto de arriba).
  - **Nuevo: `PATCH /v1/restaurants/me` ya edita los horarios.** Acepta `schedules` opcional, con la misma forma y las mismas reglas que el registro (un elemento por día abierto, sin repetir, `HH:MM`, sin horas si `isOpen24h` es `true`). **Es un reemplazo completo:** manda la lista entera de días abiertos, no solo el día que cambió; un día que no mandes queda cerrado. `schedules: []` y `null` dan `400` (el restaurante no puede quedar sin días). Si no mandas `schedules`, los horarios no cambian. Todo se guarda en una transacción.
  - **La respuesta del `PATCH` ahora es igual a la de `GET /v1/restaurants/me`**, `schedules` incluido (ordenado de lunes a domingo). Después de guardar ya no hace falta volver a pedir el `GET`: usa lo que devuelve el `PATCH`. La ruta y los campos que ya existían no cambiaron.

### Santiago y Sergio
- `restaurants` ya tiene `name`, `category`, `address` e `is_open`. Quien agregue una columna lo hace con su propia migración de `ALTER`. Nadie recrea la tabla.

### Equipo de Google Cloud (Jacobo, Santiago y Sergio)
- **Nuevo (2026-10-25, Santiago): Google Cloud (Maps) configurado.**
  - **Proyecto:** `dinno-maps`, separado del proyecto de Firebase (`dinno`).
  - **Facturación:** cuenta en **prueba gratuita** de `Sebastián`, que es su administrador. Vence alrededor del **23 de enero de 2027**; después, los mapas dejan de funcionar hasta que se decida otra cosa. La cuenta del equipo (`dinnoteam2026@gmail.com`) solo puede vincular proyectos: para ver costos y crear el presupuesto necesita los roles *Visualizador de cuentas de facturación* y *Billing Account Costs Manager* (pendiente de `<integrante>`).
  - **APIs habilitadas en `dinno-maps` (solo estas):** Maps SDK for Android, Geocoding API y Maps JavaScript API. **Cambio respecto al reparto (sección 7):** se agregó Maps JavaScript API porque el mapa del formulario web es de Google y no Leaflet, ya que la política de Geocoding API exige mostrar sus resultados sobre un mapa de Google.
  - **Llaves** (entregadas por privado; nunca en el repo, el grupo, un PR, capturas ni logs):
    - `dinno-backend`: solo Geocoding API, sin restricción de aplicación (Render no tiene IP fija) → Elizabeth, en `GOOGLE_GEOCODING_API_KEY`.
    - `dinno-android`: solo Maps SDK for Android, restringida a la app `com.dinno.app` y su SHA-1 → Sebastián.
    - `dinno-web`: solo Maps JavaScript API, restringida al dominio de Vercel y a `http://localhost:5173` → web (formulario del restaurante).
  - **Topes diarios:** la consola no permite editarlos en este proyecto (las cuotas diarias de Geocoding aparecen como no ajustables). La protección queda en las restricciones de las llaves, la prueba gratuita (no cobra a la tarjeta mientras nadie pulse «Actualizar») y la alerta de presupuesto.
  - **Revisión de consumo:** cada lunes, en *Facturación → Informes* (Santiago).
  - **Pendientes:**
    - Presupuesto con alertas al 50 %, 90 % y 100 %, sobre todos los proyectos de la cuenta (`<integrante>`, o la cuenta del equipo cuando tenga los roles).
    - El proyecto de Firebase (`dinno`) quedó con APIs de Maps habilitadas y vinculado a la misma cuenta de facturación (Firebase pasó al plan Blaze). Hay que deshabilitar sus APIs de Maps desde *Google Maps Platform → APIs y servicios* (filtro «Enabled»; ninguna es de Firebase) y desvincular su facturación para que vuelva al plan gratuito. Se hace cuando el equipo lo confirme.
    - Agregar a `dinno-android` el SHA-1 de cada computador que compile la app (Sebastián se lo pasa a Santiago; el SHA-1 no es secreto).
    - **Nuevo (2026-10-26, Elizabeth): revisar el proyecto de Firebase.**
      - Confirmar en la consola que el proyecto que usan la web, la app y el backend, con id **`dinno-8f55c`** (sale en `VITE_FIREBASE_PROJECT_ID`), está activo y no aparece como pendiente de eliminación. Si se elimina, nadie podría iniciar sesión en la web ni en la app.
      - Revisar el paso del proyecto «dinno» al plan Blaze (punto de arriba): confirmar si «dinno» es ese mismo `dinno-8f55c` y si debe volver al plan gratuito. Decidirlo con el equipo antes de tocarlo.

- ~~**La llave del backend (`GOOGLE_GEOCODING_API_KEY`, Google Geocoding API) se entrega a Elizabeth por canal privado.**~~ **Hecho:** desde el 2026-10-26 está configurada en Render y en el `.env` de Elizabeth, y `GET /v1/geocode` responde con coordenadas reales.

### Santiago
- **Nuevo (2026-10-24, ): tus 15 restaurantes ya están en el seed** (`feat/sprint2-cierre-backend`). Cambios en tus archivos:
  - `restaurants.json`: el lunes de McDonald's Parque 93 cierra a las `00:00` en vez de `23:59`. Con el cierre excluyente, `23:59` dejaba cerrado el último minuto del lunes; `00:00` es cerrar a medianoche, sin nada para el día siguiente, y enlaza con el martes de 24 horas. Ninguna otra hora cambió.
  - `restaurants.spec.ts`: `RESTAURANT_CATEGORIES` y el tipo `Availability` se importan desde los `index.ts` de sus módulos; lo que esos `index.ts` no exportan se sigue importando de las carpetas internas, igual que `seed.ts`. Se quitaron los dos comentarios de las coordenadas «copiadas a mano». La prueba comprueba lo mismo de antes.
  - **Los demás horarios siguen «por verificar»** con fuentes públicas (ver «Pendientes para el Sprint 3»).
  - **Hora fija de la prueba:** `restaurants.spec.ts` supone la demo entre semana de 9:00 a 11:00 (`DEMO_WINDOW`). Si la demo cambia de día u hora, cambia `DEMO_WINDOW` y revisa que los datos sigan mostrando los tres niveles y un restaurante fuera de horario.
  - El seed restablece en cada corrida lo que dice el archivo, estado de las mesas incluido: si cambias el archivo, el cambio llega a Neon la próxima vez que  corra el seed.
- **Nuevo (Sprint 2): ubicación del restaurante para el formulario de registro y de edición.** Contrato en `CLAUDE.md` (sección 10) y en Swagger (tags `geocode` y `restaurants`).
  - **`GET /v1/geocode?address=<texto>`** → `200 { latitude, longitude, formattedAddress }`, con 6 decimales y siempre dentro de Bogotá. **No exige restaurante registrado:** úsalo en `/onboarding` antes del `POST`. `address` va recortada, de 3 a 255 caracteres; si no cumple, `400` (`message` es una lista).
  - **`404 ADDRESS_NOT_FOUND`** y **`503 GEOCODING_UNAVAILABLE`**: **en los dos casos** muestra el mapa centrado en Bogotá para que el usuario mueva el pin. Ramifica por `errorCode`. **Cambio del 2026-10-26:** el `message` del backend ahora es neutro («No encontramos esa dirección en Bogotá.» y «No pudimos ubicar la dirección en este momento.»), porque el comensal también usa la ruta. La web muestra su propio texto por `errorCode`, por ejemplo para el 404: «No encontramos esa dirección en Bogotá. Mueve el pin al lugar correcto.». Desde el 2026-10-26 la llave de Google está configurada: `503` solo sale si Google no responde.
  - **`POST /v1/restaurants` y `PATCH /v1/restaurants/me`** aceptan `latitude` y `longitude` (números): **las dos o ninguna**, dentro de Bogotá (latitud 4.45 a 4.85, longitud -74.25 a -73.95), se aceptan con más decimales y **se guardan redondeadas a 6**. **No se pueden borrar:** `null` da `400`. En el `PATCH`, enviar solo las coordenadas es una edición válida. La obligatoriedad al registrar la impone tu formulario: el backend las deja opcionales para no romper la web actual.
  - **Las respuestas** de `POST /v1/restaurants`, `GET` y `PATCH /v1/restaurants/me` traen `latitude` y `longitude` (`number | null`). **El aviso «Completa tu ubicación» se basa en `latitude === null` en `GET /v1/restaurants/me`.**

**Santiago:** formato del archivo de los 15 restaurantes reales. ~~Entrégalo el **viernes 16** como `src/seed-data/restaurants.json` en una rama `feature/s2-seed-restaurantes`, con PR para Elizabeth.~~ **Entregado** el 2026-10-22 en `feature/s2-seed-restaurantes` (ver «Historial»). **No ejecutes el seed en Neon.** Cada elemento:
```json
{
  "name": "Nombre real",
  "category": "colombian",
  "address": "Cra. 11 #72-30, Bogotá",
  "latitude": 4.657123,
  "longitude": -74.056789,
  "isOpen": true,
  "ownerEmail": "restaurante-01@dinno.test",
  "schedules": [
    { "dayOfWeek": 1, "isOpen24h": false, "opensAt": "12:00", "closesAt": "22:00" },
    { "dayOfWeek": 5, "isOpen24h": false, "opensAt": "18:00", "closesAt": "02:00" },
    { "dayOfWeek": 6, "isOpen24h": true }
  ],
  "tables": [
    { "identifier": "01", "capacity": 2, "status": "available", "isActive": true }
  ]
}
```
- `category`: uno de los 10 valores del contrato. `dayOfWeek`: 1 = lunes … 7 = domingo. Los días cerrados no se incluyen. Un cierre después de medianoche se escribe con `closesAt` menor que `opensAt`.
- Coordenadas con 6 decimales, copiadas a mano de Google Maps y dentro de Bogotá (lat 4.45–4.85, lng −74.25 a −73.95).
- `tables`: entre 4 y 12 mesas; `identifier` corto (máx. 10 caracteres, sin repetir en el mismo restaurante); `capacity` de 1 a 20; `status` entre `available`, `reserved` y `occupied`.
- `ownerEmail`: por ahora todos con `restaurante-XX@dinno.test` (de 01 a 15). Los correos reales del equipo se asignan después.
- Lo que deben cubrir los datos (sección 9 del reparto): al menos 6 categorías, los tres niveles del indicador, 2 restaurantes con `isOpen: false`, 1 fuera de horario a la hora de la demo, 1 que cierre al día siguiente y 1 de 24 horas.
- Casa 72 es el restaurante de prueba del equipo (nombre ficticio, en la Calle 72 con Carrera 9) y ya está en el seed. Tus 15 restaurantes reales son adicionales: no incluyas Casa 72.

- **Ya hecho en el backend:** registro y consulta del restaurante (PBI 3: `POST /v1/restaurants` y `GET /v1/restaurants/me`, con `@Roles(UserRole.RESTAURANT_ADMIN)` como el resto de rutas de restaurante). Para tu formulario:
  - **`POST /v1/restaurants`** recibe exactamente `{ "name", "category", "address", "schedules": [{ "dayOfWeek": 1, "isOpen24h": false, "opensAt": "09:00", "closesAt": "22:00" }] }`. Un elemento por día abierto (al menos uno, sin repetir); un día cerrado no se envía; con `isOpen24h: true` no se envían horas. Las horas van en `HH:MM` de 24 horas: el `TimeSelect` muestra "7:30 p. m.", pero envía `"19:30"`.
  - Responde `201` con `{ id, name, category, address, latitude, longitude, schedules }`, igual que `GET /v1/restaurants/me`. Desde el Sprint 2 también acepta `latitude` y `longitude` (ver "Nuevo (Sprint 2): ubicación del restaurante", arriba).
  - `400`: `message` es una lista, y los errores de horario dicen el día ("El lunes: …").
  - `409`: el usuario ya tiene restaurante ("Ya registraste tu restaurante. Para cambiar sus datos, entra a Restaurante."). Llévalo a mesas.
  - `403` con `errorCode: "DINER_ACCOUNT"` o `"ACCOUNT_NOT_ENABLED"`: la cuenta no es de restaurante (comensal o sin perfil). Muestra el texto del contrato con *Cerrar sesión* (`CLAUDE.md`, sección 10).
- **Un restaurante habilitado nace sin restaurante:** su fila de `users` tiene `restaurantId` en `null`, así que las rutas de mesas y de restaurante le responden `403` con `errorCode: "RESTAURANT_REQUIRED"` hasta que tu registro le asigne uno. Desde el Sprint 2 el login ya no crea la fila: una cuenta no habilitada recibe `403 ACCOUNT_NOT_ENABLED` (ver la entrada del 2026-10-15 en "Historial").
- **`restaurants.is_open` ya existe** (Sergio, PBI 8): `boolean`, NOT NULL, `DEFAULT true`. **Decisión tomada:** un restaurante recién registrado nace Abierto, sin que tu registro haga nada. Tu registro no tiene que mandar `isOpen`, y `RestaurantResponseDto` no lo incluye: el estado tiene sus propios endpoints (`/v1/restaurants/me/status`).
- **Nuevo (Elizabeth): las reglas de horarios y `toScheduleRow` ahora son compartidas con la edición.** Los decoradores de validación de la lista `schedules` pasaron de `RegisterRestaurantDto` a `SchedulesField()`, en `restaurants/dto/restaurant-schedule.dto.ts`, que usan el registro y la edición. `toScheduleRow` pasó de `restaurant-registration.service.ts` a `restaurants/restaurant-schedule-rows.ts`. El registro se comporta igual y sus pruebas pasan sin cambios; si cambias una regla de horarios, cambia también en el `PATCH`.
- **Te falta en la web:** el formulario del registro del restaurante en `/onboarding`, con sus validaciones: "Tu restaurante" (nombre y categoría), "Ubicación" (dirección) y "Horarios" (con el `HoursEditor` del kit). Registro y edición validan igual, en la web y en el backend (`RestaurantFieldsDto`). Luego, su integración con `POST /v1/restaurants` y la prueba del recorrido con el usuario de onboarding (no con `demo@example.com`).

### Sergio
- **Nuevo (2026-10-24, Elizabeth): cuenta de Casa 72 para la web y 15 restaurantes en Render.**
  - Casa 72 tiene como dueño `dinnoteam2026+casa72@gmail.com` (antes `casa72@example.com`, que no recibía correo). Su cuenta de Firebase ya existe y está verificada (2026-10-26): las credenciales están en Discord (#usuarios-restaurante), y con ellas entras a la web como Casa 72. En local, el `DEV_USER_ID` de Casa 72 no cambia.
  - Después de que Elizabeth corra el seed en Neon, la búsqueda en Render muestra los 15 restaurantes reales además de Casa 72. Sus dueños (`restaurante-XX@dinno.test`) no son correos reales: nadie entra a la web como ellos.
  - Correr el seed no emite `availability.changed`: la app los ve en su siguiente consulta (cada 60 s o al volver a la pantalla).
- **Nuevo (QA de disponibilidad, Santiago):** cuando Elizabeth corra el seed con los 15 restaurantes reales, el caso límite del 30 % está en Piazza Italia Calle 93: 3 de 10 mesas libres = Pocas mesas. Se ve después de las 12:00 (abre a mediodía).
- **Nuevo (QA de tiempo real): script para ver llegar `availability.changed`.** Con la API en local (`npm run start:dev`, usuario de desarrollo activo), en otra terminal:
  - `node scripts/listen-availability.mjs --dev-user-id <uuid del comensal>` (el de `comensal@example.com`, que imprime el seed). Debe decir "Conectado … como comensal".
  - Cambia el estado de una mesa, desactívala o reactívala, crea una, abre o cierra el restaurante, o edita su horario o ubicación desde la web o Swagger: cada cambio imprime una línea con la hora y `{ restaurantId, availability, isOpenNow, isSearchable }`. Repetir el mismo estado de una mesa o del restaurante no imprime nada, y editar el identificador o la capacidad de una mesa tampoco.
  - Contra Render: `DINNO_TOKEN=<token de Firebase de un comensal> node scripts/listen-availability.mjs --url https://dinno-backend.onrender.com`. Un `connect_error: <código>` dice por qué se rechazó (README, sección 6).
- **Ya en `develop`:** el estado abierto/cerrado (PBI 8: `GET` y `PATCH /v1/restaurants/me/status` y la columna `is_open`) y la bitácora (PBI 9: tabla `table_logs` y `DbTableStatusLog`, que ya registra cambiar el estado, desactivar y reactivar una mesa). Cómo funcionan y cómo se usan: `CLAUDE.md`, sección 11 ("Bitácora de mesas" y "Estado abierto/cerrado del restaurante").
- **Ya en `develop` y en `main` (web, PR #21):** el switch Abierto/Cerrado del topbar, el aviso de cerrado y el cambio de estado con "Deshacer" y confirmación con mesas reservadas. Pendiente en la web: la variante de estado del `Switch` del kit (Sebastián) y probar que el estado persiste en el ambiente desplegado, que necesita el login web.
- **Ya en `develop` (PR #31):** `GET /v1/table-logs` (contrato en el `CLAUDE.md`, "Bitácora de mesas") y `@Roles` en tus rutas de estado.
- **Te toca en la web (PBI 9, bitácora):**
  - Pantalla en `/bitacora`: tabla con fecha y hora, mesa, cambio (estado anterior → estado nuevo, con los mismos chips de mesas) y usuario; filtro por mesa; lo más reciente primero; estado vacío "Aún no hay cambios"; fecha con el formato "30 sept · 7:30 p. m.".
  - Usa `GET /v1/table-logs` (con `?tableId=` para el filtro por mesa).
  - Verifica que cada cambio de estado, desactivación y reactivación genera su registro. Pedir el estado que la mesa ya tiene no genera registro (`CLAUDE.md`, "Bitácora de mesas").

### Sebastián  
- **Nuevo (2026-10-25, Santiago): llave de Google Maps para la app.** Santiago te la pasa por privado (`dinno-android`). Solo funciona con Maps SDK for Android y la app `com.dinno.app`. Va como variable de entorno en la configuración de Expo, fuera del repo. Pásale a Santiago el SHA-1 de cada computador que compile la app (`gradlew signingReport`, variante `debug`), para agregarlo a la restricción de la llave; sin eso el mapa no carga en ese computador. Anótalo también en el `AVISOS.md` de mobile.
- **Nuevo (2026-10-24, Elizabeth): hallazgos #3 y #6 de tu revisión de mobile.**
  - **#3 «En Render solo aparece Casa 72»:** **resuelto.** El seed ya corrió en Neon, y la búsqueda en Render muestra también los restaurantes reales, con los tres niveles de disponibilidad (comprobado el 2026-10-26).
  - **#6 «qué cuenta entra a la web como Casa 72»:** resuelto. Es `dinnoteam2026+casa72@gmail.com`; la cuenta de Firebase ya existe y está verificada (2026-10-26), con las credenciales en Discord. `dinnoteam2026@gmail.com` es el dueño de Casa16, no de Casa 72.
  - Los dueños de los 15 restaurantes (`restaurante-XX@dinno.test`) no son correos reales: los restaurantes salen en la app, pero nadie entra a la web como ellos.
- **Nuevo (app, Sprint 2): tiempo real listo en el backend (`availability.changed`).** Contrato en `CLAUDE.md`, sección 10, "Tiempo real".
  - **URL:** la misma del backend **sin** `/v1` (`https://dinno-backend.onrender.com`, o `http://localhost:3000` en local); ruta por defecto `/socket.io`.
  - **`auth` como función**, para que cada reconexión lleve un token vigente: `io(BASE_URL, { auth: async (cb) => cb({ token: await user.getIdToken() }) })`. Un token que vence no corta un socket abierto; la siguiente reconexión pide uno nuevo.
  - **Sala y payload:** todo comensal aceptado entra a la sala `diners` (no tienes que hacer nada) y recibe `availability.changed` con `{ restaurantId, availability, isOpenNow, isSearchable }`. `availability` es `available`, `few`, `none` o `closed`. Nunca trae conteos de mesas.
  - **Rechazos:** `connect_error` con `error.message` = `UNAUTHORIZED` (token ausente, inválido o vencido: renueva el token y reconecta, o lleva al login), `EMAIL_NOT_VERIFIED`, `PROFILE_REQUIRED` (llama a `POST /v1/diners/me` y reconecta) o `RESTAURANT_ACCOUNT`. Si el handshake falla por algo distinto a la sesión (por ejemplo la base caída) llega `SERVER_ERROR`. **Socket.IO no reintenta solo una conexión rechazada por el servidor:** con `SERVER_ERROR`, reintenta tú con espera creciente (por ejemplo 5 s, 15 s, 30 s) llamando a `socket.connect()`, y mientras tanto sigue la consulta cada 60 s. Con los demás códigos no reintentes.
  - **`isSearchable`:** si es `false`, quita el restaurante de la lista y del mapa (en el detalle, muestra `closed` si `isOpenNow` es `false`). Si es `true` y el restaurante no estaba en la lista, vuelve a consultar la búsqueda. Si ya estaba, actualiza su indicador con `availability`. Sin filtros: un `true` no garantiza que cumpla tu filtro de categoría o personas; por eso se vuelve a consultar.
  - **Respaldo:** sigue consultando al volver al primer plano, al reconectar y cada 60 s.
  - **Para probar:** `node scripts/listen-availability.mjs` (README, sección 6) muestra los mismos eventos que recibirá la app.
- **Nuevo (app, Sprint 2): ya puedes cambiar los datos de ejemplo de la búsqueda por la API real.** Con el token de Firebase de un comensal:
  - `GET /v1/search/zones` → `[{ id, name, latitude, longitude }]`, ordenadas por nombre. Ids: `calle-72`, `cedritos`, `centro`, `chapinero`, `chico`, `colina`, `galerias`, `kennedy`, `la-candelaria`, `modelia`, `niza`, `normandia`, `parque-93`, `quinta-camacho`, `salitre`, `suba`, `teusaquillo`, `usaquen`, `zona-g`, `zona-t`.
  - `GET /v1/search/restaurants?lat=..&lng=..` **o** `?zone=<id>`, con `radiusKm` opcional (1, 2, 5 o 10; por defecto 2) → `[{ id, name, category, address, latitude, longitude, distanceKm, availability }]`, del más cercano al más lejano, máximo 50. `availability` es `available`, `few` o `none` (nunca `closed`). `category` y `address` pueden ser `null` en restaurantes viejos.
  - **Filtros opcionales, combinables entre sí y con ubicación, zona y radio:** `category` (una por búsqueda: `colombian`, `italian`, `mexican`, `asian`, `grill`, `fast_food`, `healthy`, `seafood`, `cafe` u `other`; en minúsculas, tal cual) y `partySize` (número entero de personas, de 1 a 20: solo aparecen los restaurantes con una mesa libre y activa para todo el grupo). Por ejemplo, `?zone=chapinero&category=italian&partySize=4`. Sin filtros, la respuesta no cambia.
  - `400` (`message` es una lista): los dos modos a la vez, ninguno, solo `lat` o solo `lng`, zona desconocida, `radiusKm` fuera de la lista, `category` fuera de la lista, `partySize` vacío, decimal o fuera de 1 a 20, o un parámetro que no existe. `403` `PROFILE_REQUIRED` (llama a `POST /v1/diners/me` y reintenta) o `RESTAURANT_ACCOUNT`.
  - **Nuevo: detalle público, `GET /v1/restaurants/:id/public`** (con el `id` de la búsqueda), con `lat` y `lng` opcionales (juntas o ninguna, mismas reglas que la búsqueda) → `{ id, name, category, address, latitude, longitude, schedules, isOpenNow, availability, distanceKm? }`.
    - `availability` puede ser `closed` **solo aquí** (y en tiempo real): el detalle responde aunque el restaurante esté cerrado, con `isOpenNow: false`. En la búsqueda nunca llega `closed`.
    - `distanceKm` aparece **solo si envías `lat` y `lng`**; si no, la propiedad no viene (no es `null`).
    - `schedules` tiene el mismo formato que `GET /v1/restaurants/me`: días abiertos de lunes a domingo, `HH:MM`, y un `closesAt` menor que `opensAt` cierra al día siguiente.
    - **Todo 404 (`errorCode: RESTAURANT_NOT_FOUND`) se muestra igual:** «Este restaurante ya no está disponible», con la opción de volver. Pasa si el id no es válido, si el restaurante ya no existe o si no tiene ubicación.
    - `400` (`message` es una lista): solo `lat` o solo `lng`, una coordenada que no es un número decimal en rango, o un parámetro que no existe. `403` `PROFILE_REQUIRED` o `RESTAURANT_ACCOUNT`, como en la búsqueda.
- **Te toca en la web:** el kit visual del manual (`components/ui`), el AppShell (sidebar con Mesas, Restaurante y Bitácora; topbar con el espacio para el switch Abierto/Cerrado de Sergio) y las pantallas de mesas (crear, cambiar estado, editar y desactivar). Sergio usa del kit el switch, la alerta, el diálogo y el toast.
- **Endpoints que ya puedes consumir** (contrato en Swagger, `/docs`): los de mesas (`POST` y `GET /v1/tables`, `PATCH /v1/tables/:id/status`, `PATCH /v1/tables/:id`, `POST /v1/tables/:id/deactivate` y `POST /v1/tables/:id/reactivate`), `GET` y `PATCH /v1/restaurants/me` (detalle en la sección de Jacobo), `POST /v1/restaurants` (registro, detalle en la sección de Santiago), `GET` y `PATCH /v1/restaurants/me/status`, que reciben y devuelven `{ "isOpen": boolean }` (detalle en el `CLAUDE.md`, sección 11), y `GET /v1/table-logs` (Sergio, PR #31; contrato en el `CLAUDE.md`, "Bitácora de mesas").
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

- **Sesiones revocadas:** `verifyIdToken` no usa `checkRevoked`, así que un token revocado sirve hasta que vence (máximo 1 hora). Activarlo exige credenciales de cuenta de servicio.
- **TLS con Neon:** la conexión no verifica el certificado del servidor (`rejectUnauthorized: false`).
- **Sin rate limiting:** ninguna ruta limita las peticiones por IP ni por usuario.
- **WebSocket sin límite de conexiones por IP:** igual que el rate limiting de HTTP, nada limita cuántas conexiones abre una IP (cada handshake valida un token y consulta la base). Para el Sprint 3.
- **`npm audit`:** hay vulnerabilidades reportadas en dependencias; falta revisar y aplicar `npm audit fix`.
- **Cuenta bloqueada por otro UID:** cuando el correo ya está vinculado a otro UID de Firebase (por ejemplo, una cuenta borrada y vuelta a crear), la API responde el mismo `401` "Tu sesión terminó" y la web entra en un bucle de login. Un `errorCode` propio necesita acordarse con la web; mientras tanto, el soporte está en `docs/database.md`.
- **Firebase caído o lento:** no hay timeout propio; si Firebase no responde, la API contesta `401` en vez de `503`, y la web lo trata como sesión vencida.
- **`/v1/health` no revisa la base:** responde `ok` aunque Neon no conteste. Agregarlo con Neon gratuito (que se duerme) puede hacer que Render reinicie el servicio en bucle.
- ~~**Finales de línea sin regla en el repo**~~: **resuelta en el backend el 2026-10-24** con `.gitattributes` (`* text=auto eol=lf`); falta en web y mobile (ver «Pendientes para el Sprint 3»). Lo que sigue es el contexto original. No hay `.editorconfig`, y Prettier (3.x, sin `endOfLine` en `.prettierrc`) usa LF. Hoy los archivos del repo están en LF; en Windows quedan en CRLF en el disco solo porque Git for Windows trae `core.autocrlf=true`. Riesgos: `npm run format` o `prettier --write` pasan a LF todos los archivos que toca, en el disco (git lo normaliza al hacer commit, pero el editor muestra el archivo como cambiado), y `prettier --check` marca todo el repo en Windows; y quien tenga `core.autocrlf=false` puede subir archivos en CRLF sin que nada lo detenga. Solución propuesta (en una rama propia, acordada con el equipo): `.gitattributes` con `* text=auto eol=lf` y `endOfLine: 'lf'` explícito en `.prettierrc`.
- **Consola de Firebase:** revisar que solo estén habilitados Email/Password y Google, y que la vinculación de cuentas por correo esté activa (una cuenta por correo).

Resuelta el 2026-10-15 (`feature/s2-cuentas-roles`, detalle en el Historial):

- ~~**Rol automático:** toda cuenta del proyecto Firebase con correo verificado entraba como `restaurant_admin`~~: el backend ya no crea usuarios; los restaurantes se habilitan a mano y `POST /v1/diners/me` solo crea comensales (PR #35).
- ~~**Detección del `23505` duplicada** en `tables.service.ts`~~: un solo `isUniqueViolation` en `src/common/database/`.
- ~~**Swagger del 401 copiado en cada controlador**~~: `SESSION_UNAUTHORIZED_RESPONSE` en `identity-access`.
- ~~**Comentario viejo del usuario de desarrollo** ("until the real authentication replaces it")~~: reescrito; `isDeployedEnvironment` tiene su propio archivo.
- ~~**Join de la bitácora a `users`** (excepción del Sprint 1)~~: los correos salen de `UsersService.findEmailsByIds`.

## Pendientes para el Sprint 3

Lo que queda abierto al cerrar el backend del Sprint 2 (2026-10-24). Los dueños son sugeridos: se confirman en la planeación.

| Tema | Repo | Dueño sugerido | Detalle |
|---|---|---|---|
| `POST /diners/me` con correo ligado a otro UID | backend | Elizabeth | Hoy responde 401; evaluar 403 `RESTAURANT_ACCOUNT` o un código propio |
| `ACCOUNT_CONFLICT` | backend + mobile | Elizabeth + Sebastián | Lo pidió Sebastián para cuentas de Firebase recreadas; no existe en ningún repo (ver «Deuda conocida», «Cuenta bloqueada por otro UID») |
| Desactivar una mesa Ocupada o Reservada | backend + web | Equipo | Decidir junto con las reservas del Sprint 3 |
| Límite de peticiones y de conexiones WebSocket por IP | backend | Elizabeth | Hoy no hay ninguno |
| Adaptador de Redis para Socket.IO | backend | Elizabeth | Solo si hay más de una instancia (ver «Migración a Azure» en `CLAUDE.md` §11) |
| PBI 2.2 «dirección o zona»: búsqueda por dirección en la app | mobile | Sebastián | El backend ya está listo: `GET /v1/geocode` acepta comensales desde el 2026-10-26. Falta la pantalla: geocode → «Resultados cerca de: `formattedAddress`» → búsqueda con `lat`/`lng` (ver el `AVISOS.md` de mobile) |
| Ubicación obligatoria al registrar | web | Santiago | Volver a exigirla: las llaves de Google ya están (2026-10-26) |
| Horarios de `restaurants.json` | backend | Santiago | Verificar los horarios reales |
| Términos de Google sobre guardar coordenadas de Geocoding | equipo | Equipo de Google Cloud | Revisar si se pueden guardar de forma permanente |
| `.gitattributes` en web y mobile | web + mobile | Sebastián | Igual que en el backend |
| CI en web y mobile | web + mobile | Sergio | Hoy no hay ninguna verificación antes de fusionar |
| Typecheck de mobile con rutas tipadas | mobile | Sebastián | Regenerar `.expo/types` y confirmar que pasa |
| Cuál es el `firebase_uid` de `onboarding@example.com` y `demo@example.com` | backend | Elizabeth | Pendiente del 2026-10-06, de antes de la vinculación por correo. Hoy esas cuentas solo sirven en local, con `DEV_USER_ID`. Para entrar a la web con Firebase hace falta un correo verificado, y `@example.com` no recibe correo: o se pasan a alias verificables como Casa 72 (cambio en el seed), o se crea la cuenta de Firebase y se guarda su UID a mano en Neon |
| `endOfLine: 'lf'` explícito en `.prettierrc` | backend | Elizabeth | Prettier 3 ya usa LF por defecto, igual que `.gitattributes`; dejarlo explícito evita depender del valor por defecto |
| Formato de `roles.decorator.ts` | backend | Jacobo | Es el único archivo `.ts` que no cumple Prettier; por eso `npm run format` todavía cambiaría código ajeno |
| `npm audit` | backend | Elizabeth | Sigue en «Deuda conocida» |

## Historial

- **2026-10-26 · Elizabeth · Búsqueda por dirección para el comensal y mensajes neutros de geocodificación (`docs/sprint2-cierre-contrato`, PBI 2.2).** Cambio en la API, sin cambios de esquema ni dependencias. **Afecta a web y mobile** (sección 7).
  - **`GET /v1/geocode` acepta los dos roles** (`@Roles(UserRole.RESTAURANT_ADMIN, UserRole.DINER)`). El restaurante sigue igual: no necesita restaurante registrado. El comensal lo usa para buscar por dirección: geocode → «Resultados cerca de: `formattedAddress`» → `GET /v1/search/restaurants?lat=…&lng=…`. La búsqueda no recibe `address`.
  - **Códigos de cuenta:** una cuenta sin perfil recibe `403 PROFILE_REQUIRED` (antes `ACCOUNT_NOT_ENABLED`), igual que `GET /v1/me`. Ya no existe `DINER_ACCOUNT` en esta ruta.
  - **Mensajes neutros:** `404 ADDRESS_NOT_FOUND` «No encontramos esa dirección en Bogotá.» y `503 GEOCODING_UNAVAILABLE` «No pudimos ubicar la dirección en este momento.». Cada cliente pone su propio texto según el `errorCode`. Las respuestas no cambian de forma.
  - **Regla de geocodificación sin cambios.** Se midieron 25 direcciones directamente contra Google. Ninguna regla sobre `partial_match`, `location_type` o `types` rechaza «asdfghjkl qwerty 999999» sin rechazar direcciones válidas del seed. Datos y motivo en `CLAUDE.md` §11, «Geocodificación».
  - **Pruebas:**
    - `google-geocoder.spec.ts` suma 7 casos con respuestas reales de Google.
    - `test/geocode.e2e-spec.ts` cubre: comensal `200` y `404`, sin perfil `403 PROFILE_REQUIRED`, mensajes nuevos, y que Swagger documente solo ese `403`.
    - Ya no está el caso `403 DINER_ACCOUNT`.
  - **Prueba real en local:** con el usuario de desarrollo del comensal, «Cra. 11 #72-30» → `200` y la búsqueda a 2 km de ese punto → 7 restaurantes de la Calle 72 (Casa 72 a 0,25 km). Con Casa 72, la misma dirección → `200`.
  - **`CLAUDE.md` §10** (igual en los tres repos): fila de `/geocode` con los dos roles y los mensajes, «Ambos roles», el flujo «Búsqueda por dirección (app)» y la fila «Cuándo está listo».
  - **Avisos:** a Sebastián en el `AVISOS.md` de mobile y a Santiago y Sebastián en el de frontend.

- **2026-10-26 · Elizabeth · Llave de Geocoding configurada y pruebas con tokens reales (`docs/sprint2-cierre-contrato`).** Solo documentación: sin cambios de código, esquema, API ni dependencias. Render servía `develop` (`19f3b28`).
  - **Geocodificación real** (`GOOGLE_GEOCODING_API_KEY` en local y en Render; 7 llamadas a `/v1/geocode` en total, 5 de ellas llegaron a Google):
    - «Av. Calle 72 con Cra. 9, Chapinero, Bogotá» → `200`, a 26 m de las coordenadas de Casa 72;
    - «Cra. 11 #72-30» → `200` dentro de Bogotá, igual en local y en Render;
    - «Calle 10 #43A-30, Medellín» → `404 ADDRESS_NOT_FOUND`;
    - «asdfghjkl qwerty 999999» → `200` con una dirección real de Bogotá (coincidencia parcial de Google). **Decisión (Elizabeth):** se deja así, y el dueño siempre confirma o mueve el pin antes de guardar (`CLAUDE.md` §11, «Geocodificación»);
    - comensal → `403 DINER_ACCOUNT`.

    El log de la API no muestra la llave, la URL de Google ni la dirección.
  - **Cuentas y roles con tokens reales** (local con `DEV_USER_ENABLED=false` y Render, mismos resultados): `GET /v1/me` del comensal (`diner`) y de Casa16 (`restaurant_admin` con su restaurante); `POST /v1/diners/me` dos veces → `200` y `200`, y con Casa16 → `403 RESTAURANT_ACCOUNT`; comensal en rutas de restaurante (incluido `/v1/geocode`) → `403 DINER_ACCOUNT`; Casa16 en rutas de comensal → `403 RESTAURANT_ACCOUNT`; sin token o con un token inválido → `401`. **Casa 72:**
    - primero respondió `INVALID_LOGIN_CREDENTIALS`, porque la cuenta todavía no existía;
    - después de crearla, `401 EMAIL_NOT_VERIFIED`, que es lo correcto con el correo sin verificar;
    - ya verificada: `GET /v1/me` → `200 restaurant_admin` con Casa 72, `POST /v1/diners/me` y las rutas de comensal → `403 RESTAURANT_ACCOUNT`, y `GET /v1/tables` → `200`, en local y en Render.

    El primer inicio de sesión vinculó su `firebase_uid` por correo: ya no está en `NULL`.
  - **Búsqueda y detalle:** zonas, `calle-72` con radio 2 y 10, `category=colombian`, `partySize=6` y el detalle de Casa 72 y de Pesquera Jaramillo (cerrado a mano, `closed`) dan respuestas idénticas en Render y en local, en el mismo minuto.
  - **Tiempo real de punta a punta en Render:** con `listen-availability.mjs` conectado con el token del comensal, cada cambio de Casa 72 hecho con su token emitió un `availability.changed` en menos de 1 s:
    - ocupar Mesa 7 → `few`;
    - cerrar → `closed` con `isSearchable: false`;
    - abrir → `few`;
    - liberar Mesa 7 → `few`.

    Repetir el mismo estado de la mesa no emitió nada. Antes, la prueba se había hecho también en local, con el usuario de desarrollo, y dio los mismos eventos. Casa 72 quedó como estaba (`is_open = true`, Mesas 7 y 8 libres): solo cambian los `updated_at` y la bitácora, que registra la prueba. **WebSocket en Render:** Casa16 → `RESTAURANT_ACCOUNT`; el comensal estuvo conectado 10 s sin errores; sin token o con un token inválido → `UNAUTHORIZED`.
  - **Cerrados:** recibir la llave de Geocoding, probar el inicio de sesión con un token real contra Render (las tres cuentas), la cuenta de Firebase de Casa 72, correr el seed en Neon, la fila de la §10 de los tres repos (cuentas de prueba sincronizadas en `CLAUDE.md` §10, mismo texto en backend, web y mobile) y el restaurante de prueba de `onboarding@example.com` (ya no tiene restaurante en Neon).

- **2026-10-25 · Santiago · Google Cloud (Maps) configurado.** Sin cambios de código, esquema ni dependencias.
  - **Qué quedó listo:** el proyecto `dinno-maps` con facturación en prueba gratuita, las tres APIs del Sprint 2 y tres llaves restringidas (backend, Android y web). Detalle en «Equipo de Google Cloud».
  - **Cambio respecto al reparto:** se agregó Maps JavaScript API (mapa de Google en la web en vez de Leaflet) y no hay topes diarios porque la consola no permite editarlos.
  - **Qué pasó antes:** Google bloqueó por «actividad sospechosa» los registros de la prueba gratuita en la cuenta del equipo y en una cuenta personal (errores `OR-CBAT-12` y `OR-CBAT-14`). Las dos quedaron en revisión y la cuenta del equipo tiene cuentas de facturación sin usar (cerradas o incompletas); no se tocan. Por eso solo Santiago entra a la consola (ver «Acciones pendientes de todos»).
  - **Para quién:** **Elizabeth:** configurar `GOOGLE_GEOCODING_API_KEY` en Render (ver tu sección). **Sebastián:** llave de la app y SHA-1 (ver tu sección). **Todos:** no pulsar «Actualizar» en el banner de la prueba.

- **2026-10-24 · Elizabeth · Cierre del backend del Sprint 2 (`feat/sprint2-cierre-backend`).** Sin cambios de esquema, de la API ni dependencias nuevas.
  - **Seed completo con los 15 restaurantes de Santiago.** `npm run seed` crea cada restaurante de `src/seed-data/restaurants.json` con su dueño (`restaurant_admin`), horarios y mesas, en una sola transacción e idempotente. En cada corrida los 15 vuelven a quedar como dice el archivo (estado de las mesas incluido); Casa 72 se restablece como antes. Nada más se toca (cuentas del equipo, Casa16). `seed.ts` quedó como entrada, la lógica está en `src/seed-data/run-seed.ts`, y `nest-cli.json` copia el `.json` a `dist`. Detalle en `CLAUDE.md`, sección 11, «Datos de prueba: el seed». **Hay que correrlo en Neon** (Elizabeth).
  - **Casa 72 tiene como dueño `dinnoteam2026+casa72@gmail.com`** (antes `casa72@example.com`): mismo usuario y mismo `id`, así que el `DEV_USER_ID` de Casa 72 sigue sirviendo en local. El seed deja su `firebase_uid` en `null` al cambiar el correo, y el primer inicio de sesión con el correo verificado lo vincula. Pasos para crear su cuenta de Firebase:
    1. En la consola de Firebase: *Authentication → Add user*, con ese correo y una contraseña.
    2. Entrar a la web con ese correo y esa contraseña.
    3. En la pantalla de verificación, *Reenviar*.
    4. Abrir el enlace en la bandeja de `dinnoteam2026@gmail.com`.

    Las credenciales se comparten por privado, nunca en el repo.
  - **Horario nuevo de Casa 72** (el seed lo restablece en cada corrida): de lunes a jueves 08:00–23:00, viernes 08:00–02:00 del día siguiente, sábado 11:00–02:00 y domingo 11:00–21:00. Antes abría a las 11:00 todos los días, así que estaba cerrada durante la demo de la mañana entre semana.
  - **Los 15 restaurantes usan correos `restaurante-XX@dinno.test`:** aparecen en la app, pero nadie puede entrar a la web como su dueño.
  - **`.gitattributes` en el backend** (`* text=auto eol=lf`, binarios marcados). No se renormalizó nada: el repositorio ya estaba en LF.
  - **Cerrados:** «integrar `restaurants.json` en `seed.ts`» (Elizabeth), el #6 de mobile («qué cuenta entra a la web como Casa 72») y, cuando se corra el seed en Neon, el #3 de mobile («en Render solo aparece Casa 72»). Los `AVISOS.md` de web y mobile se sincronizan después.
  - **Archivos de otros integrantes que se tocaron:** **Santiago:** `src/seed-data/restaurants.json` (solo el cierre del lunes de McDonald's) y `src/seed-data/restaurants.spec.ts` (imports y dos comentarios; ver su sección).

- **2026-10-22 · Santiago · Datos de los 15 restaurantes reales para el seed (`feature/s2-seed-restaurantes`, PBI 6.1).** Sin cambios de esquema ni migraciones (las columnas que usan ya existen en Neon), sin cambios en la API y sin dependencias nuevas. No toca `seed.ts`.
  - **Qué quedó listo:** `src/seed-data/restaurants.json` (15 restaurantes con el formato de la sección de Santiago) y `restaurants.spec.ts` (revisa los criterios del reparto con `computeAvailability`, suponiendo la demo entre semana de 9:00 a 11:00 a. m., `DEMO_WINDOW`).
  - **Por verificar:** nombre, dirección y horario salen de fuentes públicas; mesas, estados, `isOpen` y correos son datos de prueba.

- **2026-10-15 · Elizabeth · Ajustes de la revisión de integración del Sprint 2 (`chore/sprint2-ajustes-backend`).** Sin cambios de esquema, de rutas, de respuestas ni de Swagger; sin dependencias nuevas. El contrato (`CLAUDE.md`, sección 10) no cambia.
  - **`radiusKm` estricto:** usa `toNumberOrNaN`, igual que `lat`, `lng` y `partySize`. `0x2`, `2e0`, `+2`, `Infinity` y vacío ahora dan `400` con el mensaje de siempre (antes `0x2` y `2e0` pasaban como 2); `' 2 '` se acepta y sin `radiusKm` sigue siendo 2.
  - **Comentario de `SERVER_ERROR`** en `availability.gateway.ts`: ya es parte del contrato, y con ese código la app reintenta con espera creciente (5 s, 15 s, 30 s) además de consultar cada 60 s. Solo el comentario.
  - **Abrir y cerrar el restaurante de forma atómica:** `PATCH /v1/restaurants/me/status` ya no lee y luego escribe; es una sola sentencia condicional (`WHERE id = :id AND is_open <> :isOpen`) y emite `availability.changed` solo si `affected === 1`. Dos cambios simultáneos al mismo estado emiten un solo evento, y una escritura que falla no emite. La respuesta HTTP no cambia (`{ isOpen }` con el estado final) y `RESTAURANT_REQUIRED` sigue igual.
  - **Archivos de Sergio que se tocaron:** `restaurants/restaurant-status.service.ts` (solo el método `update`), `restaurants/restaurant-status.service.spec.ts` (el repositorio simulado aplica la condición; pruebas nuevas: cambio real, mismo estado, dos peticiones simultáneas y fallo de escritura; la del restaurante inexistente ya no espera que no se llame a `update`, sino que no se emita) y `test/restaurant-status.e2e-spec.ts` (el repositorio simulado aplica la condición y cambia el `where` esperado). Si tu e2e simula `update` del repositorio de `Restaurant` para esta ruta, recibe `{ id, isOpen: Not(<nuevo>) }`.
  - **Pendientes de Elizabeth del Sprint 1 cerrados:** variables de Render y regla de checks obligatorios en GitHub (confirmado el 2026-10-15).

- **2026-10-15 · Elizabeth · Tiempo real: eventos y WebSocket (`feature/s2-tiempo-real`, PBI 5.1).** Sin cambios de esquema ni de las rutas HTTP.
  - **Qué quedó listo:** el evento `availability.changed` por Socket.IO para comensales (mismo host, `/socket.io`, sala `diners`), con autenticación en el handshake y los códigos de `connect_error` del contrato (más `EMAIL_NOT_VERIFIED`). `restaurant-operations` emite un evento interno después de guardar; `search-availability` recalcula y envía. Detalle en `CLAUDE.md`, sección 11, "Tiempo real: eventos y WebSocket". Script de QA: `scripts/listen-availability.mjs`.
  - **Dependencias nuevas:** `@nestjs/event-emitter` 12.0.1, `@nestjs/websockets` 12.1.3, `@nestjs/platform-socket.io` 12.1.3, `socket.io` 4.8.4 y, de desarrollo, `socket.io-client` 4.8.4. Corre `npm ci` después de traer `develop`.
  - **Cambio de comportamiento:** `PATCH /v1/restaurants/me/status` con el estado que el restaurante ya tiene ya no escribe en la base (la respuesta no cambia: `200` con el estado).
  - **`identity-access`:** `CurrentUserResolver.resolve` recibe `IdentityRequest` (`{ headers }`) en vez del `Request` de Express, para reutilizarlo en el handshake. El `Request` sigue sirviendo tal cual; no cambia nada para quien usa `CurrentUserGuard`.
  - **Para las pruebas:** toda e2e que monte `RestaurantOperationsModule` importa `EventEmitterModule.forRoot()` (ver "Acciones pendientes de todos").
  - **Archivos de otros integrantes que se tocaron:**
    - **Sebastián (mesas):** `tables.service.ts` (inyecta `EventEmitter2`; emite después de crear, cambiar el estado si cambió, desactivar y reactivar; `updateStatus` devuelve lo mismo). En `tables.service.spec.ts`, `tables.service.edit-deactivate.spec.ts` y `tables.service.update-status.spec.ts` solo se agregó el emisor simulado al construir el servicio. En `test/tables.e2e-spec.ts` y `test/tables-edit.e2e-spec.ts` solo se agregó `EventEmitterModule.forRoot()`.
    - **Sergio (estado y bitácora):** `restaurant-status.service.ts` (lee el estado actual: si es igual no escribe ni emite; si cambia, escribe y emite). En `restaurant-status.service.spec.ts` se agregó el emisor simulado y cambió una aserción: con un restaurante inexistente ya no se llama a `update` (falla al leer). `test/restaurant-status.e2e-spec.ts`, `test/table-logs.e2e-spec.ts` y `test/table-status-log-wiring.e2e-spec.ts`: solo `EventEmitterModule.forRoot()`.
    - **Santiago (registro):** `test/restaurant-registration.e2e-spec.ts`: solo `EventEmitterModule.forRoot()`. El registro no emite.
    - **Jacobo (`identity-access`):** `current-user.resolver.ts` (`IdentityRequest`), `dev-user.resolver.ts` y `firebase-user.resolver.ts` (solo el tipo del parámetro), `identity-access.module.ts` e `index.ts` (registran y exportan `DinerSocketAuthenticator`); `test/accounts.e2e-spec.ts`: solo `EventEmitterModule.forRoot()`.

- **2026-10-15 · Elizabeth · Ubicación del restaurante: geocodificación y coordenadas (`feature/s2-geocode`).** Rutas y campos nuevos en la API, sin cambios de esquema (las columnas `latitude` y `longitude` llegaron con `AddDinerRoleAndRestaurantLocation`) ni dependencias nuevas.
  - **Qué quedó listo:** `GET /v1/geocode` (dirección → coordenadas con Google Geocoding, restringido a Bogotá, solo restaurantes y sin exigir restaurante registrado) y `latitude`/`longitude` en `POST /v1/restaurants`, `PATCH /v1/restaurants/me` y sus respuestas, incluida `GET /v1/restaurants/me`. Detalle para la web en la sección de Santiago; reglas en `CLAUDE.md`, sección 11, "Geocodificación".
  - **Sin llave, `GET /v1/geocode` responde `503 GEOCODING_UNAVAILABLE`** hasta que el equipo de Google Cloud la entregue (ver su sección). La app arranca igual.
  - **Variable nueva:** `GOOGLE_GEOCODING_API_KEY` (opcional y secreta; en `.env.example` sin valor). Solo se define en Render y en el `.env` de Elizabeth.
  - **Códigos nuevos:** `ADDRESS_NOT_FOUND` (404) y `GEOCODING_UNAVAILABLE` (503), en `ErrorResponseDto`.
  - **Para las pruebas:** las e2e que montan `RestaurantOperationsModule` no necesitan nada nuevo (sin llave el adaptador no llama a Google). Para probar `GET /v1/geocode`, reemplaza el puerto con `.overrideProvider(Geocoder)`, como `test/geocode.e2e-spec.ts`.
  - **Archivos de otros integrantes que se tocaron:** **Santiago (registro):** `restaurant-registration.service.ts` (guarda las coordenadas), `restaurant-registration.service.spec.ts` y `test/restaurant-registration.e2e-spec.ts` (los dos campos nuevos en lo esperado). `dto/restaurant-fields.dto.ts` (compartido) suma los dos campos.

- **2026-10-15 · Elizabeth · Búsqueda por ubicación y por zona, con filtros y detalle público (`feature/s2-busqueda`, PBI 2.1, 2.2, 3.2 y 4.1).** Rutas nuevas de la API, sin cambios de esquema ni dependencias nuevas.
  - **Qué quedó listo:** `GET /v1/search/zones` (las 20 zonas, ordenadas por nombre) y `GET /v1/search/restaurants` con `lat` + `lng` **o** `zone`, y `radiusKm` ∈ {1, 2, 5, 10} (por defecto 2). Solo comensales (`@Roles(UserRole.DINER)`). Contrato en `CLAUDE.md`, sección 10, y en Swagger (tag `search`).
  - **Filtros (PBI 4.1, misma rama):** `category` y `partySize` ya están listos y se combinan con ubicación, zona y radio. `category` se aplica en la consulta; `partySize` lo aplica `AvailabilityService.getForRestaurants(ids, { partySize })` (`CLAUDE.md`, sección 11, "Búsqueda").
  - **Detalle público (PBI 3.2, misma rama):** `GET /v1/restaurants/:id/public` ya está listo para comensales. Responde aunque el restaurante esté cerrado (`availability: closed`), agrega `distanceKm` solo con `lat` y `lng`, y responde 404 `RESTAURANT_NOT_FOUND` si el id no es un UUID, no existe o no tiene ubicación (`CLAUDE.md`, sección 11, "Detalle público"). `ErrorResponseDto` suma ese código. `lat` y `lng` de la búsqueda y del detalle comparten validación (`search-availability/location/location-fields.ts`).
  - **Cambio de la nota de implementación:** la distancia exacta se calcula en TypeScript; la base solo hace un prefiltro por rectángulo (`CLAUDE.md`, sección 11, "Búsqueda").
  - **Para tu código:** `restaurant-operations` tiene API pública (`restaurant-operations/index.ts`: `RestaurantOperationsModule`, `RESTAURANT_CATEGORIES`, `RestaurantCategory`); desde otro módulo se importa solo de ahí. `identity-access` exporta además `DINER_ENDPOINT_ACCOUNT_EXAMPLES`, los ejemplos de Swagger del `403` de las rutas de comensal (`PROFILE_REQUIRED` y `RESTAURANT_ACCOUNT`), junto a `RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES`. Úsalo en las rutas nuevas del comensal.
  - **Para las pruebas:** `SearchAvailabilityModule` ahora importa `IdentityAccessModule` (los guards del controlador). Una e2e que lo monte necesita `ConfigModule` con `DEV_USER_ENABLED: 'false'` y `FIREBASE_PROJECT_ID`, y reemplazar `FIREBASE_AUTH` y `getRepositoryToken(User)`, como `test/availability-wiring.e2e-spec.ts` y `test/search.e2e-spec.ts`.

- **2026-10-15 · Elizabeth · Regla de disponibilidad del Sprint 2 (`feature/s2-disponibilidad`, PBI 3.1).** Sin endpoints, sin cambios de esquema ni de la API, sin dependencias nuevas.
  - **Qué quedó listo:** la regla de "Disponibilidad" del `CLAUDE.md` (sección 10) está implementada y probada en `search-availability/availability/`. Calcula si el restaurante está abierto ahora (hora de Bogotá, cierre exclusivo, horarios que cierran al día siguiente y días de 24 horas), el nivel `available` / `few` / `none` / `closed` y si aparece en la búsqueda.
  - **Cómo se usa:** `SearchAvailabilityModule` exporta `AvailabilityService` (`getForRestaurant`, `getForRestaurants`, `canSeat`), importado desde `search-availability/index.ts`. Lo usarán la búsqueda, el detalle público y el WebSocket (viernes 16 y sábado 17) y la asignación de mesa del Sprint 3. Detalle en el `CLAUDE.md`, sección 11, "Disponibilidad".
  - **Para las pruebas:** la hora se fija reemplazando `Clock` (`.overrideProvider(Clock)`). Escriban los instantes en UTC con su hora de Bogotá en un comentario.
  - **Regla que no cambia:** ninguna respuesta lleva cuántas mesas hay ni cuántas están libres.

- **2026-10-15 · Elizabeth · Cuentas y roles del Sprint 2 (`feature/s2-cuentas-roles`).** Cambia el esquema y la API.
  - **El backend ya no crea usuarios al iniciar sesión.** Una cuenta de Firebase sin fila en `users` queda *sin perfil*. Solo `POST /v1/diners/me` crea usuarios, siempre con rol `diner`. Los restaurantes se habilitan a mano ([`docs/database.md`](docs/database.md), "Restaurantes habilitados"). El único correo real habilitado es `dinnoteam2026@gmail.com`.
  - **Roles:** `UserRole` tiene `RESTAURANT_ADMIN` y `DINER`. Todas las rutas del Sprint 1 siguen con `@Roles(UserRole.RESTAURANT_ADMIN)`; no cambian sus rutas ni sus respuestas de éxito.
  - **Códigos nuevos (403):** `ACCOUNT_NOT_ENABLED` (sin perfil en una ruta de restaurante), `PROFILE_REQUIRED` (sin perfil en una ruta de comensal), `DINER_ACCOUNT` (comensal en una ruta de restaurante) y `RESTAURANT_ACCOUNT` (restaurante en una ruta de comensal). Textos y precedencia en `CLAUDE.md`, sección 10. Los textos viven en `identity-access/roles/account-errors.ts` y los traduce `RolesGuard`. `User.role` y `CurrentUserData.role` son `UserRole` (la base lo garantiza con `CHK_users_role`): ya no existe el 403 sin `errorCode` por "rol desconocido". Las e2e de "rol inválido" de cada ruta de restaurante ahora usan un comensal y esperan `DINER_ACCOUNT`.
  - **Rutas nuevas:** `GET /v1/me` (los dos roles) y `POST /v1/diners/me` (201 si lo crea, 200 si ya era comensal). Swagger, tag `accounts`.
  - **Para tu código:** `@CurrentUser()` sigue entregando `CurrentUserData` con `userId` y `role` no nulos; no hay que cambiar ningún controlador. La identidad de la petición es `RequestIdentity` (registrada o sin perfil) y la entrega `@CurrentIdentity()`, solo para rutas sin `@Roles` como `POST /v1/diners/me`. `MaxCodePoints` pasó de `restaurant-operations/shared/` a `src/common/validation/` porque ahora lo usan dos módulos.
  - **Esquema** (migración `1792087341885-AddDinerRoleAndRestaurantLocation`, pendiente de aplicar en Neon antes de fusionar): `restaurants.latitude` y `longitude` (`numeric(9,6)`, NULL), `users.display_name` (`varchar(60)`, NULL) y los checks `CHK_users_role`, `CHK_users_email_normalized`, `CHK_restaurants_location_pair`, `CHK_restaurants_latitude` y `CHK_restaurants_longitude`. Las coordenadas todavía no salen en la API: llegan el viernes 16.
  - **Usuario de desarrollo:** el seed crea `comensal@example.com` (rol `diner`, "Comensal de prueba") e imprime su `DEV_USER_ID`. Con `x-dev-user-id` y ese id pruebas las rutas del comensal en local. También asegura `dinnoteam2026@gmail.com` como restaurante. **Casa 72 se restablece en cada corrida del seed:** categoría `colombian`, dirección "Av. Calle 72 con Cra. 9, Chapinero, Bogotá", coordenadas de la Calle 72 con Carrera 9 y horarios amplios (lunes a jueves 11:00–23:00, viernes y sábado 11:00–02:00, domingo 11:00–21:00). Lo que cambien en esos datos al probar se pierde al correr el seed; su nombre y sus mesas no se tocan.
  - **Pruebas e2e:** las que montan `IdentityAccessModule` ahora también cargan `MeController` y `DinersController`; no necesitan nada nuevo porque ya reemplazan el repositorio de `User`. Si tu e2e llama `GET /v1/table-logs`, ese repositorio simulado necesita además `find` (lo usa `UsersService.findEmailsByIds`; ver `test/table-logs.e2e-spec.ts`).
  - **Limpieza de deuda (mismo día):**
    - `isUniqueViolation` pasó a `src/common/database/unique-violation.ts` y lo usan `users.service.ts`, `diners.service.ts` y `tables.service.ts` (este último conserva la condición del índice `UQ_tables_restaurant_id_identifier`).
    - La regla de caracteres invisibles es `NoInvisibleCharacters` en `src/common/validation/`, junto a `MaxCodePoints`: la usan el identificador de mesa y `displayName`.
    - El Swagger del 401 es `SESSION_UNAUTHORIZED_RESPONSE` (exportado por `identity-access`), usado en los 7 controladores; el documento de `/docs` quedó idéntico.
    - `isDeployedEnvironment` pasó a `identity-access/auth/deployed-environment.ts` (se sigue importando desde `identity-access/index.ts`).
    - La bitácora ya no hace join a `users`: los correos salen de `UsersService.findEmailsByIds`, en una sola consulta. La respuesta de `GET /v1/table-logs` no cambió.
  - **Archivos de otros integrantes que se tocaron** (tenlo en cuenta al traer `develop` a tu rama):
    - **Sebastián (mesas):** `tables.controller.ts` (Swagger 401 y 403), `tables.service.ts` (detección de duplicados con `isUniqueViolation`), `dto/create-table.dto.ts` (`MaxCodePoints` y `NoInvisibleCharacters` desde `common/`), `tables.service.edit-deactivate.spec.ts`, `tables.service.update-status.spec.ts` (literal del rol), `test/tables.e2e-spec.ts` y `test/tables-edit.e2e-spec.ts` (rol inválido → comensal, aserción de Swagger).
    - **Sergio (estado y bitácora):** `restaurant-status.controller.ts` y `table-logs.controller.ts` (Swagger 401 y 403), `table-logs.service.ts` y `table-logs.service.spec.ts` (sin join a `users`), `restaurant-status.service.spec.ts` (coordenadas en el objeto de prueba), `test/restaurant-status.e2e-spec.ts` y `test/table-logs.e2e-spec.ts`.
    - **Santiago (registro):** `restaurant-registration.controller.ts` (Swagger 401 y 403), `dto/restaurant-fields.dto.ts` (import de `MaxCodePoints`), `restaurant-registration.service.spec.ts` (literal del rol) y `test/restaurant-registration.e2e-spec.ts`.
    - **Jacobo (`identity-access`):** `firebase-user.resolver.ts`, `roles.guard.ts`, `users.service.ts`, `user.entity.ts` y sus pruebas; `test/roles.e2e-spec.ts` se borró (su caso lo cubre `test/accounts.e2e-spec.ts`).

- **2026-10-15 · Elizabeth · Contratos del Sprint 2 publicados**
  - Los contratos del Sprint 2 están en `CLAUDE.md`, sección "Sprint 2 · Contratos". Es la fuente de verdad para backend, web y app; si algo no está ahí, se pregunta antes de inventarlo. Las fechas de cada contrato están en la tabla "Cuándo está listo cada contrato en `develop`".
  - **Cambio importante (llega a `develop` el 15 oct en la noche):** el backend deja de crear usuarios automáticamente. Por ahora el único correo real habilitado como restaurante es `dinnoteam2026@gmail.com`. Para probar la web como restaurante, usen esa cuenta o el usuario de desarrollo en local. Cualquier otra cuenta recibe 403 `ACCOUNT_NOT_ENABLED` en la web. Si necesitan habilitar otro correo, pídanselo a Elizabeth.

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
    - `PATCH /v1/restaurants/me/status` con `{ "isOpen": boolean }` → `200 { "isOpen": boolean }`. El restaurante sale de la sesión; `401` sin sesión, `403 RESTAURANT_REQUIRED` sin restaurante y `400` si `isOpen` no es booleano o hay campos de más. Detalle en el `CLAUDE.md` (sección 11, "Estado abierto/cerrado del restaurante") y en Swagger;
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
- **2026-10-06 · Limpieza de documentación y pruebas (Elizabeth, rama `chore/sprint1-docs-and-tests-cleanup`).** Solo documentación y pruebas, sin cambios de comportamiento ni de la API. Migraciones aplicadas al día en `docs/database.md` y en este archivo; los textos de la mesa dicen "identificador" en todo `AVISOS.md`; `CLAUDE.md` (sección 11), `README.md` y `AGENTS.md` al día con el código. Pruebas nuevas: 404 de `deactivate` y `reactivate`, `identifier: null` en `PATCH /v1/tables/:id` y `table-identifier.spec.ts`.
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
