# Operación de Azure · DiNNo

> Encendido, apagado y revisión diaria de lo desplegado en Azure (Sprint 4).
> Dueño: Jacobo. **Sin secretos:** aquí no van claves, cadenas de conexión ni IDs de suscripción.
> Los créditos vencen el **9 de diciembre de 2026**. Nunca pasar la cuenta a «pago por uso».

## 1. Recursos

| Recurso | Nombre | Región | ¿Cobra quieto? | Estado |
|---|---|---|---|---|
| Grupo de recursos | `rg-dinno` | eastus | No | Existe |
| Entorno de Container Apps (consumo) | `managedEnvironment-rgdinno-8310` | westus2 | No | Existe |
| App de prueba (hello world) | `ca-dinno-prueba` | westus2 | — | **Eliminada** (17 nov), cuando el backend real respondió el health |
| Container Registry (Basic) | `acrdinno4821` | westus2 | **Sí**, tarifa diaria fija | Existe (17 nov) · sin usuario administrador: se entra con identidades |
| Key Vault (Standard, RBAC) | `kv-dinno-4821` | westus2 | No (centavos por operación) | Existe (17 nov) · soft-delete de 7 días, sin protección de purga |
| Identidad del backend | `id-dinno-backend` | westus2 | No | Existe (17 nov) · Key Vault Secrets User sobre `kv-dinno-4821` y AcrPull sobre `acrdinno4821` ([`seguridad-red.md`](seguridad-red.md) §2) |
| Identidad de GitHub Actions (backend) | `id-gh-backend` | westus2 | No | Existe (17 nov) · credencial federada `github-develop` (`repo:DiNNo-team@329297407/backend@1391461154:ref:refs/heads/develop`, formato con IDs fijos de GitHub), AcrPush sobre `acrdinno4821` y Contributor solo sobre `ca-dinno-backend`. En el repo: variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ACR_NAME` y `APP_NAME`; ningún secreto |
| Identidad de GitHub Actions (frontend) | `id-gh-frontend` | westus2 | No | Existe (17 nov) · credencial federada `github-production` (`repo:DiNNo-team@329297407/frontend@1393536492:environment:production`, el job `deploy` de `web-ci-cd.yml`) y Contributor solo sobre `swa-dinno`. En el repo frontend: variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_STATIC_WEB_APP_NAME` y los `VITE_*`; ningún secreto |
| Web (Static Web Apps, Free) | `swa-dinno` | westus2 | No | Existe (17 nov) · https://brave-grass-07093571e.3.azurestaticapps.net. La publica `web-ci-cd.yml` del frontend en cada push a `main`; primer despliegue con `workflow_dispatch` el 17 nov. Usa el backend de Azure (`VITE_API_URL`) |
| Backend (Container App, consumo) | `ca-dinno-backend` | westus2 | Solo con réplicas > 0 | Existe (17 nov) · imagen `dinno-backend:5add132`, 0,5 vCPU y 1 GiB, 1 réplica, ingress externo solo HTTPS (HTTP → 301) en el puerto 3000. URL: `https://ca-dinno-backend.icyrock-d101225d.westus2.azurecontainerapps.io`. Secretos como referencias a Key Vault (`database-url`, `redis-url`, `google-geocoding-api-key`, `firebase-service-account-json`: notificaciones push activas; `insights-llm-api-key` desde el 18 nov: el informe de IA lo redacta el modelo) |
| PostgreSQL Flexible Server (Burstable B1ms) | `pg-d4821-westcentralus-1ms` | **westcentralus** | **Sí, mientras está encendido** (el almacenamiento cobra siempre) | Existe (17 nov) · PostgreSQL 17, 32 GB, sin alta disponibilidad, respaldos de 7 días sin redundancia geográfica. Base `dinno`, administrador `dinnoadmin` (clave en Key Vault: `pg-admin-password`). Firewall: solo la regla «servicios de Azure» (`0.0.0.0`). **Otra región a propósito:** westus2, westus y westus3 no tenían capacidad de B1ms para la cuenta; cada consulta del backend suma unos milisegundos (decisión en [`seguridad-red.md`](seguridad-red.md) §1) |
| Azure Managed Redis (Balanced B0) | `redis-dinno-4821` | westus2 | **Sí, siempre** (no se puede pausar) | Existe (17 nov) · base `default` en el puerto 10000, solo TLS 1.2+ (`rediss://`), clúster Enterprise (un solo punto de conexión, cliente normal), claves de acceso, sin alta disponibilidad ni persistencia, eviction `VolatileLRU`. La URL va en Key Vault (`redis-url`, paso 9) |
| Log Analytics | `log-dinno` | westus2 | Por GB ingerido (tope de 0,1 GB/día; retención de 30 días incluida) | Existe (17 nov) · recibe del entorno, con `diag-dinno`, `ContainerAppConsoleLogs` y `ContainerAppSystemLogs` (sin logs HTTP ni métricas). Al llegar al tope deja de recibir hasta el día siguiente. El día de la prueba de carga se sube a 0,5 GB y luego se vuelve a 0,1 |

Todo lo nuevo va en **westus2**, la región del entorno de Container Apps. Si la base o Redis quedan en otra región, aumenta la latencia y puede cobrarse tráfico entre regiones. **Única excepción:** PostgreSQL, en westcentralus por falta de capacidad (ver la fila).

## 2. Antes de empezar

```bash
# Una sola vez: Azure CLI en Debian/Ubuntu
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
az extension add --name containerapp --upgrade

# Cada vez
az login                      # o: az login --use-device-code
az account show -o table      # confirmar la suscripción de DiNNo
```

Variables para copiar en la terminal (completar las pendientes cuando existan):

```bash
RG=rg-dinno
APP=ca-dinno-backend
PG=pg-d4821-westcentralus-1ms   # westcentralus (ver la tabla)
```

## 3. Apagar (el mismo día en que se termina de trabajar)

```bash
# Backend a cero réplicas
az containerapp update -n $APP -g $RG --min-replicas 0 --max-replicas 1

# Base de datos detenida
az postgres flexible-server stop -n $PG -g $RG
```

## 4. Encender

PostgreSQL tarda varios minutos en arrancar: se enciende primero.

```bash
az postgres flexible-server start -n $PG -g $RG
az postgres flexible-server show -n $PG -g $RG --query state -o tsv   # esperar "Ready"

az containerapp update -n $APP -g $RG --min-replicas 1 --max-replicas 1
```

- **Si se fusiona a `develop` con PostgreSQL detenido, la revisión nueva queda en `ActivationFailed` y Azure sigue con la anterior** (el job `deploy-azure` queda en rojo: pasó con el PR #81 el 18 nov). Al encender: **primero PostgreSQL, después el backend**; el `update` de arriba crea una revisión nueva con la última imagen. Después, comprobar que `/v1/health` muestre el último commit de `develop`:

  ```bash
  git fetch -q origin && git rev-parse --short=7 origin/develop          # último commit de develop
  curl -s https://$(az containerapp show -n $APP -g $RG --query properties.configuration.ingress.fqdn -o tsv)/v1/health   # su "commit" debe ser el mismo
  ```

- **Si el backend ya estaba en 1–1** (el `update` no cambia la escala y no crea revisión nueva) y la revisión más reciente está en `ActivationFailed`, con PostgreSQL ya `Ready` se reinicia esa revisión y se vuelve a comprobar el commit:

  ```bash
  REV=$(az containerapp show -n $APP -g $RG --query properties.latestRevisionName -o tsv)
  az containerapp revision restart -n $APP -g $RG --revision $REV
  ```

## 5. Verificar

```bash
# Réplicas: debe haber exactamente 1 encendido, ninguna apagado
az containerapp replica list -n $APP -g $RG -o table

# Escala configurada
az containerapp show -n $APP -g $RG \
  --query "{min:properties.template.scale.minReplicas, max:properties.template.scale.maxReplicas}" -o table

# Base de datos: "Ready" encendida, "Stopped" apagada
az postgres flexible-server show -n $PG -g $RG --query state -o tsv

# API
URL=$(az containerapp show -n $APP -g $RG --query properties.configuration.ingress.fqdn -o tsv)
curl -s https://$URL/v1/health
```

**`/v1/health` no revisa la base de datos:** responde `ok` aunque PostgreSQL esté detenido. Para saber que todo funciona, hay que hacer además un login o una búsqueda desde la web o la app.

## 6. Cosas que hay que saber

- **«Running» no significa que haya réplicas.** `runningStatus: Running` solo dice que la app está activa. Lo que gasta son las réplicas: con `replica list` vacío no cobra.
- **Con `min-replicas 0`, cualquier petición despierta el backend** (por ejemplo, la app de alguien abierta). Es barato, pero no es un apagado total. La primera petición tarda unos segundos («Conectando con DiNNo…»).
- **PostgreSQL detenido se enciende solo a los 7 días.** Esta semana no importa, pero hay que revisarlo si queda apagado más tiempo.
- **2 réplicas solo para una prueba concreta** (tiempo real entre réplicas o carga) y se vuelve a 1 apenas termina:

  ```bash
  az containerapp update -n $APP -g $RG --min-replicas 2 --max-replicas 2   # prueba
  az containerapp update -n $APP -g $RG --min-replicas 1 --max-replicas 1   # al terminar
  ```

- **Redis no se puede pausar:** cobra mientras exista. El equipo decide si se deja o se elimina y se vuelve a crear para la presentación.

## 7. Revisión de cada noche

1. Correr los comandos de la sección 5: backend en 0 réplicas y base de datos `Stopped`.
2. Revisar el saldo de créditos en el portal (página de la suscripción) y anotarlo si cambió mucho.
3. Si algo quedó encendido: apagarlo y avisar en el grupo quién lo dejó así.

## 8. Alertas de presupuesto

Presupuesto sobre la suscripción con alertas de costo real al 25 %, 50 % y 75 % del crédito, al correo de los cinco integrantes. **Los presupuestos se actualizan con horas de retraso:** no reemplazan la revisión de cada noche.

## 9. Pendientes de este documento

- [x] Nombres reales del backend, PostgreSQL y Redis (tabla de la sección 1).
- [ ] Monitoreo: Log Analytics ya está conectado al entorno (`diag-dinno`); faltan las consultas guardadas, el panel y las alertas.
- [x] Checklist del día de la presentación: [`checklist-presentacion.md`](checklist-presentacion.md). Costos: [`azure-costos.md`](azure-costos.md).
