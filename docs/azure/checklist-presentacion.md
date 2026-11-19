# Checklist del día de la presentación · DiNNo

> Sábado 21 nov 2026. Dueño: Jacobo. Se prueba completo una vez en el ensayo del viernes.
> Comandos de encendido y apagado: [`azure-operacion.md`](azure-operacion.md). Red y permisos: [`seguridad-red.md`](seguridad-red.md). **Sin secretos en este documento.**

## Datos

| Qué | Valor |
|---|---|
| API (backend) | https://ca-dinno-backend.icyrock-d101225d.westus2.azurecontainerapps.io (`/v1/health`, Swagger en `/docs`) |
| Web | https://brave-grass-07093571e.3.azurestaticapps.net |
| App | development build o APK con `EXPO_PUBLIC_API_URL` = la URL de la API (sin `/v1`) |
| Grupo de recursos | `rg-dinno` |
| Backend | `ca-dinno-backend` (Container App, westus2) |
| PostgreSQL | `pg-d4821-westcentralus-1ms` (B1ms, **westcentralus**) |
| Redis | `redis-dinno-4821` (B0, westus2; siempre encendido) |
| Logs | `log-dinno` (Log Analytics) |

Variables para la terminal (o `source ~/.dinno-azure.env`, que ya las tiene):

```bash
RG=rg-dinno
APP=ca-dinno-backend
PG=pg-d4821-westcentralus-1ms
API_URL=https://ca-dinno-backend.icyrock-d101225d.westus2.azurecontainerapps.io
SWA_URL=https://brave-grass-07093571e.3.azurestaticapps.net
```

## Antes del sábado

- [ ] **Celular con la verificación en dos pasos** de la cuenta dueña de Azure (`dinnoTeam2026@outlook.com`): lo lleva **<por definir>**, con batería.
- [ ] Al menos dos personas pueden encender y apagar desde la CLI (sesión iniciada y extensión `containerapp` instalada).
- [ ] Saldo de créditos revisado el viernes en la noche.
- [ ] El dominio de la web está en Firebase → Authentication → Dominios autorizados (Sebastián) y en la llave de Maps `dinno-web` (Santiago). Sin eso fallan el login con Google y el mapa.
- [ ] Plan B acordado con el equipo, por si Azure falla: **<por definir: Render (backend con Neon) y Vercel siguen activos, pero con otra base: ¿se usan? ¿video de respaldo?>**.

## T − 60 min · Encender (PostgreSQL primero)

PostgreSQL va **antes** que el backend: tarda varios minutos en arrancar, y un backend que arranca sin base no responde el login ni la búsqueda (el health sí, y engaña).

- [ ] Encender PostgreSQL y esperar a que esté `Ready`:
  ```bash
  az postgres flexible-server start -g $RG -n $PG
  az postgres flexible-server show -g $RG -n $PG --query state -o tsv   # repetir hasta "Ready"
  ```
- [ ] Solo después, encender el backend con **exactamente 1 réplica**:
  ```bash
  az containerapp update -n $APP -g $RG --min-replicas 1 --max-replicas 1
  az containerapp replica list -n $APP -g $RG -o table                  # debe haber 1
  ```
- [ ] **El backend sirve el último commit de `develop`.** Si se fusiona a `develop` con PostgreSQL detenido, la revisión nueva queda en `ActivationFailed` y Azure sigue con la anterior. Al encender: primero PostgreSQL, después el backend; comprobar que `/v1/health` muestre el último commit de `develop`:
  ```bash
  git fetch -q origin && git rev-parse --short=7 origin/develop          # último commit de develop
  curl -s https://$(az containerapp show -n $APP -g $RG --query properties.configuration.ingress.fqdn -o tsv)/v1/health   # su "commit" debe ser el mismo
  ```
- [ ] **Si se cambió algo para la prueba de carga, revisar que no quedó nada:**
  ```bash
  # Debe mostrar min 1 y max 1
  az containerapp show -n $APP -g $RG --query "{min:properties.template.scale.minReplicas, max:properties.template.scale.maxReplicas}" -o table
  # Debe salir vacío: la variable RATE_LIMIT_FACTOR no debe existir
  az containerapp show -n $APP -g $RG --query "properties.template.containers[0].env[?name=='RATE_LIMIT_FACTOR']" -o tsv
  # Debe decir 15 (salvo que la demo muestre el vencimiento)
  az containerapp show -n $APP -g $RG --query "properties.template.containers[0].env[?name=='RESERVATION_TTL_MINUTES'].value" -o tsv
  # Tope de logs: debe decir 0.1
  az monitor log-analytics workspace show -g $RG -n log-dinno --query workspaceCapping.dailyQuotaGb -o tsv
  ```

## T − 45 min · Despertar el backend

El backend tarda en despertar: en Render la primera petición tardó 85 s, y en Azure pasa algo parecido al encender. Repetir `/v1/health` hasta que responda 200:

```bash
until [ "$(curl -s -o /dev/null -w '%{http_code}' $API_URL/v1/health)" = "200" ]; do
  echo "Esperando al backend…"; sleep 5
done
curl -s $API_URL/v1/health   # debe mostrar status ok y el commit del sprint
```

`/v1/health` **no revisa la base de datos**. Por eso el paso siguiente incluye un login real.

## T − 30 min · Prueba de red desde la universidad (antes de entrar a la sala)

- [ ] Conectado a la **red de la universidad** (si falla, repetir con datos móviles y anotar):
  ```bash
  cd backend && BASE_URL=$API_URL WEB_ORIGIN=$SWA_URL NETWORK_LABEL=universidad node scripts/qa/humo-red.mjs
  ```
  Revisa salud, cabeceras, 401 y CORS **sin escribir nada**. La versión completa, con cuentas y `CONFIRM=1`, la corre Sebastián (backend PR #67). La fila va en `docs/qa/pruebas-de-red.md`.
- [ ] Web (`$SWA_URL`): iniciar sesión como Casa 72. El panel de mesas carga y el mapa del formulario aparece.
- [ ] App (emulador o APK contra la API de Azure): iniciar sesión como comensal. La búsqueda muestra restaurantes.
- [ ] Una reserva de prueba aparece en la web sin recargar (tiempo real). Después se cancela.

## T − 15 min · Datos y configuración de la demo

- [ ] **Elizabeth** corre `demo:reset` (solo ella), ahora **contra la base de Azure** ⚠️ por confirmar con ella cómo (con la URL del administrador, desde su equipo y con una regla temporal en el firewall que se borra después). Después: recargar la web y reabrir la app, porque el reset no emite eventos.
- [ ] `RESERVATION_TTL_MINUTES=3` **solo** si la demo muestra el vencimiento (`az containerapp update -n $APP -g $RG --set-env-vars RESERVATION_TTL_MINUTES=3`, crea una revisión nueva). Anotar quién lo cambia para volver a 15.
- [ ] Nadie corre scripts de QA contra Casa 72 durante la presentación (`qa-cancel-reservation` incluido).
- [ ] Nadie fusiona a `develop` del backend ni a `main` del frontend durante la presentación: los dos despliegan solos en Azure.

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| `/v1/health` no responde después de 3 min | `az containerapp replica list -n $APP -g $RG` y revisar `ContainerAppSystemLogs` en `log-dinno`. Si no hay réplica, volver a correr el encendido |
| Health responde, pero el login o la búsqueda dan 500 | Revisar que PostgreSQL esté `Ready` (`az postgres flexible-server show -g $RG -n $PG --query state -o tsv`) y los errores en `ContainerAppConsoleLogs` |
| Funciona en casa pero no en la universidad | Avisar a **Sebastián** (red y firewall). No cambiar reglas por cuenta propia |
| La app o la web dicen «Conectando con DiNNo…» | Esperar y reintentar: el backend está despertando |
| Nada funciona a T − 10 | Pasar al plan B |

## Después de la presentación

- [ ] Volver `RESERVATION_TTL_MINUTES` a 15 si se cambió.
- [ ] **Apagar todo**, en este orden: backend a 0 réplicas y después PostgreSQL detenido. Redis no se apaga (cobra hasta que se elimine).
  ```bash
  az containerapp update -n $APP -g $RG --min-replicas 0 --max-replicas 1
  az postgres flexible-server stop -g $RG -n $PG
  az containerapp replica list -n $APP -g $RG -o table                  # vacío (tarda ~5 min sin tráfico)
  az postgres flexible-server show -g $RG -n $PG --query state -o tsv   # Stopped
  az postgres flexible-server firewall-rule list -g $RG -s $PG -o table # sin reglas temporales
  ```
- [ ] Revisar el saldo de créditos.
- [ ] Recordarle a Sebastián el cambio de contraseñas y claves después de la presentación (reparto §4.2).
