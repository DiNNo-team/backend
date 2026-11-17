# Pruebas de carga y capacidad · Sprint 4

**Dueño:** Sebastián (reparto §4.2) · **Herramienta:** [k6](https://k6.io) (`brew install k6`) · **Script:** `load-tests/dinno.k6.js`.
**Para qué:** responder en la sustentación cuántos usuarios y cuántas reservas simultáneas aguanta la arquitectura con **1 réplica** y con **2**, dónde se degrada primero (backend, base de datos o Redis) y qué se cambiaría para soportar más.

## 1. Qué mide

| Escenario | Simula | Métricas |
|---|---|---|
| `navegar` | comensales que buscan y abren un detalle, con 1 a 3 s entre pantallas | peticiones por segundo, tiempo de respuesta (mediana y p95), % de fallas |
| `reservar` | cada cuenta de prueba reserva y cancela en ciclo sobre el **mismo** restaurante: compiten por las mesas | reservas creadas por segundo, p95 al crear, `409 NO_TABLE_AVAILABLE` (esperado cuando todo está lleno) y otros errores |
| `tiempo_real` | teléfonos con la app abierta: Socket.IO conectado de 20 a 40 s, respondiendo los ping | % de conexiones aceptadas, p95 al conectar |

**Perfiles** (`PROFILE`):
- `humo`: 1 minuto y medio. Hasta 5 usuarios navegando y 10 sockets.
- `carga`: 5 minutos. Hasta 50 usuarios navegando y 200 sockets: la demo y un piloto pequeño, con margen.
- `estres`: 7 minutos. Sube a 400 usuarios navegando y 1000 sockets, para encontrar el límite.

**Umbrales de «sano»:**
- menos del 1 % de fallas al navegar;
- p95 de navegar por debajo de 800 ms;
- p95 al reservar por debajo de 1,5 s;
- más del 99 % de los sockets conectados, con p95 al conectar por debajo de 2 s.

No cortan la prueba: marcan dónde empieza la degradación.

## 2. Cómo correrla contra Azure

**Solo con el sistema encendido para la prueba, y se apaga al terminar** (reparto §2.1).

### Antes de empezar

1. Elizabeth y Sebastián acuerdan la hora. Nadie más usa el ambiente mientras tanto.
2. En el Container App, `RATE_LIMIT_FACTOR=1000`. Si no, el límite de peticiones corta la prueba: en el ensayo local dio 65 respuestas 429 con el factor normal.
3. Restaurante de prueba abierto (Casa 72), con todas sus mesas Disponibles.
4. Cuentas: las de QA (`dinnoteam2026+qa21` … `+qa25`), con la clave que tiene Sebastián.

### Comando

```bash
cd backend
k6 run -e BASE_URL=https://<api> -e PROFILE=carga -e LABEL=1-replica \
  -e RESTAURANT_ID=<casa-72> -e FIREBASE_API_KEY=… \
  -e DINER_EMAILS=dinnoteam2026+qa21@gmail.com,dinnoteam2026+qa22@gmail.com,… -e DINER_PASSWORD=… \
  load-tests/dinno.k6.js
```

### Orden

1. `humo` con 1 réplica, para confirmar que todo responde.
2. `carga` con 1 réplica.
3. `estres` con 1 réplica.
4. Se sube a 2 réplicas (`az containerapp update -g rg-dinno -n <app> --min-replicas 2 --max-replicas 2`) y se repiten `carga` y `estres` con `LABEL=2-replicas`.
5. **Se vuelve a 1 réplica, se quita `RATE_LIMIT_FACTOR` y se apaga.**

### Mientras corre

En el portal (Container App → Métricas), se miran:
- CPU y memoria de las réplicas;
- PostgreSQL: CPU, conexiones activas y almacenamiento;
- Redis: CPU y operaciones por segundo.

Así se sabe qué se satura primero. Cada corrida deja su JSON completo en `load-tests/results/` (ignorado por git).

## 3. Cómo leer el resultado

- **Se degrada el backend** si su CPU llega a ~100 % mientras PostgreSQL está holgado. Se arregla con más réplicas (con el adaptador de Redis para Socket.IO, tareas 5.1.x) o más CPU por réplica.
- **Se degrada la base** si la CPU o las conexiones de PostgreSQL suben primero. B1ms es el plan más pequeño. Se arregla con un plan mayor (General Purpose) o un *pool* de conexiones (PgBouncer, que viene incluido en Flexible Server). Las reservas bloquean una mesa a la vez (`FOR UPDATE SKIP LOCKED`), así que la contención por mesa no frena a los demás restaurantes.
- **`409 NO_TABLE_AVAILABLE` no es un error:** es la regla de concurrencia funcionando, porque no hay más mesas. Lo grave sería ver dos reservas activas en la misma mesa. Eso lo impiden los índices únicos y lo prueba `test/db/reservations-concurrency.db-spec.ts`.
- **Sockets rechazados con `RATE_LIMITED`:** muchas conexiones nuevas desde la misma IP, la de la máquina que corre k6. En la vida real cada teléfono tiene su propia IP o comparte la de su red.

## 4. Resultados

| Fecha | Perfil | Réplicas | Usuarios navegando (máx.) | Sockets (máx.) | Peticiones/s | p95 navegar | Reservas/s | p95 reservar | Sockets OK | Lo primero que se degradó |
|---|---|---|---|---|---|---|---|---|---|---|
| 16 nov · ensayo **local** (Docker, Mac) | humo | 1 | 5 | 10 | 3,5 | 20 ms | 0,32 (1 cuenta) | 24 ms | 100 % | — (solo valida el script) |

## 5. Qué se cambiaría para soportar más usuarios

*(Se completa con los resultados de Azure.)* Por orden de costo:
1. Más réplicas del backend, con el adaptador de Redis.
2. Un plan mayor de PostgreSQL.
3. Caché en Redis de la búsqueda (`GET /v1/search/restaurants` es la ruta más pedida).
4. CDN para la web (Static Web Apps ya la trae).
