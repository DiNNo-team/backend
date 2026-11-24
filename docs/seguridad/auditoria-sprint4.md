# Auditoría de dependencias y secretos · Sprint 4

**Fecha:** 16 nov 2026 · **Autor:** Sebastián · **Alcance:** los tres repos (`backend`, `frontend`, `mobile`), rama `develop`.
**Herramientas:** `npm audit --omit=dev` (solo lo que llega a producción) y `gitleaks git` (todo el historial de git).
**Regla del reparto:** los hallazgos críticos se corrigen; el resto queda anotado aquí, con su razón.

## 1. Secretos en el historial (gitleaks)

| Repo | Hallazgo | Veredicto |
|---|---|---|
| backend | 2 × `jwt` + 2 × `generic-api-key` en `scripts/qa/roles.mjs` y `scripts/qa/escuchar-eventos.mjs` | **Falso positivo.** Son tokens falsos a propósito: solo traen `sub`, sin `iss` ni `exp`, y la firma no es válida (las pruebas esperan el 401). |
| backend | `generic-api-key` en `README.md` | **Falso positivo:** es texto del README. |
| frontend | — | Sin hallazgos. |
| mobile | `gcp-api-key` en `google-services.json` | **Público a propósito** (decisión del 15 nov, mobile #48). Es la llave de Android de Firebase: viaja dentro del APK y no es un secreto. Su protección es la restricción en Google Cloud a la app `com.dinno.app` y a su huella SHA-1. Hay que revisar que la restricción siga puesta. |

- Los falsos positivos del backend están en `.gitleaksignore`, para que una revisión automática futura no los vuelva a marcar.
- **Ningún secreto real** (cadenas de conexión, cuentas de servicio, llaves de Geocoding o de IA) aparece en el historial de ningún repo.

## 2. Dependencias de producción (npm audit)

### backend

| Paquete | Severidad | Qué es | Decisión |
|---|---|---|---|
| `body-parser` 2.3.0 | alta | DoS con bytes de más después de un cuerpo comprimido | **Corregido:** 2.4.0, dentro del rango de express (`npm update body-parser qs`). |
| `qs` 6.16.0 | — | Se actualizó junto a `body-parser` | 6.17.1 |
| `multer` 2.4.0 (vía `@nestjs/platform-express`) | alta | DoS con un `fileFilter` asíncrono | **Anotado, no explotable:** la API no tiene ninguna ruta de subida de archivos (no hay `FileInterceptor`), así que multer nunca corre. El arreglo pide `@nestjs/platform-express` 12.5.1, publicado el mismo 16 nov y distinto de `@nestjs/core` 12.1.0: no se sube tres días antes de la demo. |
| `fast-xml-parser`, `glob`, `minimatch`, `uuid` | moderada | Vienen de `firebase-admin` y Google Cloud | Anotado. Se revisan después de la presentación. |

`npm audit fix` sin filtro también subía `@nestjs/platform-express` a 12.5.1 y otros 60 paquetes: se descartó por esa razón.

### frontend

| Paquete | Severidad | Decisión |
|---|---|---|
| `@grpc/grpc-js` (vía `firebase` → `@firebase/firestore`) | alta | **Anotado, no aplica:** la web usa solo Firebase Authentication. Firestore no se importa, y gRPC solo corre en Node, no en el navegador. El «arreglo» de npm es bajar `firebase` a la 9.14.0, cuatro versiones mayores atrás. No se aplica. |
| `vite`, `source-map-js`, `re2js` | alta | **Anotado, solo desarrollo y build:** no llegan al sitio publicado. `vite` es del servidor local (`launch-editor`, y solo en Windows). |

### mobile

| Paquete | Severidad | Decisión |
|---|---|---|
| `@grpc/grpc-js` (vía `firebase`) | alta | Igual que en la web: no aplica. |
| `node-forge`, `zod`, `glob` (vía `@expo/cli`) | alta | **Anotado, solo herramientas:** no van dentro del APK ni de la app de iOS. |
| `query-string` / `decode-uri-component` (vía `expo-router`) | alta | Anotado. El arreglo es `expo-router` 58, que exige Expo SDK 58: es un cambio mayor que no se hace antes de la demo. Las URL que lee la app son de DiNNo (los enlaces de la reserva). |

## 3. Permisos por rol (tarea 6.1.5)

Revisión de todas las rutas (`src/**/*.controller.ts`), el 16 nov:

- **Todas** las rutas, menos `GET /v1/health`, llevan `CurrentUserGuard`: sin un token válido de Firebase responden `401`.
- **Todas** llevan `@Roles(...)`, salvo dos que a propósito aceptan una cuenta todavía sin perfil: `POST /v1/diners/me` (crea el comensal) y `POST /v1/restaurants/signup` (registro público). Las dos exigen el correo verificado.
- **Comensal contra restaurante y al revés:** el guard responde `DINER_ACCOUNT`, `RESTAURANT_ACCOUNT` o `ADMIN_ACCOUNT` antes de entrar al controlador (§10). Lo prueban `test/accounts.e2e-spec.ts` y `test/restaurant-approval.e2e-spec.ts`.
- **Datos de otro restaurante:** las rutas del restaurante toman el restaurante de la sesión, nunca del cliente (`/restaurants/me/*`, `requireRestaurant`). Una mesa, zona o bitácora de otro restaurante responde igual que una que no existe (404 o lista vacía): no se revela nada. Lo prueban `test/tables*.e2e-spec.ts`, `test/table-logs.e2e-spec.ts` y `test/table-areas.e2e-spec.ts`.
- **Reserva de otro comensal:** `GET` y `cancel` responden el mismo `404 RESERVATION_NOT_FOUND` que una inexistente, y nunca vencen la reserva ajena (`test/reservations-read.e2e-spec.ts`, `test/reservations-cancel.e2e-spec.ts`).
- **Restaurante pendiente o rechazado:** solo usa las rutas marcadas con `@AllowUnapprovedRestaurant()`, y el socket lo rechaza (CLAUDE.md §11, «Aprobación de restaurantes»).
- **Errores sin información interna:** el filtro global responde los 500 en español sin stack (`test/unhandled-errors.e2e-spec.ts`).
- **Ruta nueva (el informe de IA):** debe llevar `CurrentUserGuard`, `@Roles(UserRole.RESTAURANT_ADMIN)`, el restaurante de la sesión y `@RateLimit('ai')`.

**Resultado:** sin hallazgos. Las pruebas contra Azure (rutas privadas sin sesión, rol incorrecto y exceso de peticiones) están en `docs/azure/seguridad-red.md`, §6.

## 4. Pendiente después de la presentación

- Subir `@nestjs/*` a la misma versión menor reciente (incluye multer 2.5.0).
- Expo SDK 58 (`expo-router` 58).
- Cambiar las contraseñas de PostgreSQL y Redis y las llaves que se hayan compartido durante el sprint (reparto, sección 4.2).
