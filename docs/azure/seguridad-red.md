# Seguridad y red en Azure · procedimiento (Sprint 4)

**Dueño:** Sebastián (reparto §4.2) · **Revisa:** Elizabeth · **Estado (17 nov, Jacobo):** en curso. Ya existen el registro, Key Vault, PostgreSQL, Redis y Log Analytics (tabla de recursos en [`azure-operacion.md`](azure-operacion.md)). Las decisiones de red de esta sección son las definitivas: no hay otro criterio en otro documento.
**Regla de costos (reparto §2.1):** todo lo de aquí es gratis o cuesta centavos: identidades administradas, credenciales federadas, reglas de firewall, Key Vault Standard y Static Web Apps Free. **No se crea** Azure Firewall, Application Gateway, Front Door, NAT Gateway, Private Endpoint, VNet ni planes de Defender.
**Regla de acceso (reparto §2.1 y §9):** la API pública queda accesible **desde cualquier red**. Lo que se restringe es la base y Redis, nunca la API.

Sin secretos en este documento: los valores reales se escriben solo en la terminal y en Key Vault.

---

## 0. Variables de la terminal

Se definen una vez por sesión. Los nombres son los reales (17 nov):

```bash
RG=rg-dinno                      # el grupo está en eastus; sus recursos, en westus2 salvo PostgreSQL
LOCATION=westus2                 # región del entorno de Container Apps y de todo lo demás
APP=ca-dinno-backend             # Container App del backend
ENV=managedEnvironment-rgdinno-8310
PG=pg-d4821-westcentralus-1ms    # PostgreSQL Flexible Server, en westcentralus (ver §1)
PGLOC=westcentralus
KV=kv-dinno-4821
REDIS=redis-dinno-4821
ACR=acrdinno4821
SWA=swa-dinno                    # Static Web Apps (Free)
```

---

## 1. Red: quién habla con quién

```
Comensal (app) ─┐                                                               ┌─ PostgreSQL Flexible Server (5432, TLS verify-full, usuario dinno_app)
                ├─ HTTPS/WSS 443 ─► Container App (westus2, ingress externo, solo HTTPS) ─┤   westcentralus · firewall: regla «servicios de Azure» (0.0.0.0)
Restaurante ────┘   cualquier red                                                         ├─ Redis (westus2, solo TLS en 10000, con clave)
(web en Static Web Apps, HTTPS)                                                           └─ Key Vault (westus2, identidad administrada)
```

- **API:** ingress **externo**, solo HTTPS (`allowInsecure: false`), y el WebSocket por el mismo puerto (`transport: auto`). Es la única puerta pública.
- **PostgreSQL (decidido el 17 nov):** acceso público con la regla **«Permitir acceso desde cualquier servicio de Azure»** (`0.0.0.0`), TLS obligatorio con **`sslmode=verify-full`** (el backend verifica el certificado) y la app entra con **`dinno_app`** (solo datos, sin crear ni borrar tablas). Para entrar a mano, una regla **temporal** con la IP de esa persona, que se borra el mismo día.
- **Riesgo aceptado (regla `0.0.0.0`):** esa regla deja llegar a la base a cualquier cliente que corra dentro de Azure, incluso de otras suscripciones, no solo a nuestro Container App. No se filtra por IP porque el entorno de Container Apps es de **consumo y sin red virtual**: sus IP de salida **no son fijas** (cambian si Azure mueve el entorno) **ni exclusivas** (las comparten otros clientes de la misma región), así que una regla por IP no aseguraría que solo entre DiNNo y podría cortar el backend sin aviso. La base queda protegida por TLS obligatorio con verificación del certificado, contraseñas largas generadas que solo viven en Key Vault y un usuario con permisos mínimos, no por la red. Hacerlo con red privada exige recrear el entorno y el servidor y crear endpoints privados, con costo.
- **Región de PostgreSQL (decidido el 17 nov):** el servidor está en **westcentralus**, no en westus2. Para la cuenta con créditos, westus2, westus y westus3 no tenían capacidad de B1ms (`Subscriptions are restricted from provisioning in this region`). El backend sigue en westus2: cada consulta cruza de región, **unos milisegundos más por consulta** (una reserva hace varias), y el tráfico entre regiones se cobra aparte, con un costo mínimo a este volumen. Si en el futuro hay capacidad en westus2, mover la base es restaurarla en un servidor nuevo allí.
- **Redis:** solo TLS y con clave, guardada en Key Vault.
- **Por qué no una VNet privada:** el modo de red de PostgreSQL se elige al crear el servidor y no se cambia después. La VNet exige un entorno de Container Apps con perfiles de carga, más configuración y más riesgo de dejar el sistema sin conexión a días de la presentación.

### 1.1 Ingress del backend

```bash
az containerapp ingress update -g $RG -n $APP \
  --type external --allow-insecure false --transport auto --target-port 3000
az containerapp show -g $RG -n $APP --query properties.configuration.ingress.fqdn -o tsv   # URL pública de la API
```

- `NODE_ENV=production` en el Container App (CLAUDE.md §11, «Migración a Azure»). `TRUST_PROXY_HOPS` no se define: el valor por defecto, 1, es el ingress.
- **Réplicas:** `--min-replicas 0 --max-replicas 1` normalmente (reparto §2.1). Se sube a 2 solo para la prueba de varias réplicas y la de carga.

### 1.2 Firewall de PostgreSQL

En `firewall-rule` (CLI 2.93), el servidor va con **`--server-name`/`-s`** y el nombre de la regla con **`--name`/`-n`**. No existe `--rule-name`.

```bash
# Reglas actuales: solo debe estar AllowAllAzureServicesAndResourcesWithinAzureIps_… (0.0.0.0) y, el día que se trabaja, la temporal
az postgres flexible-server firewall-rule list -g $RG -s $PG -o table

# TLS obligatorio (viene activado; se confirma)
az postgres flexible-server parameter show -g $RG --server-name $PG --name require_secure_transport --query value
az postgres flexible-server parameter set  -g $RG --server-name $PG --name require_secure_transport --value on

# Entrada temporal de una persona (y se borra el mismo día)
az postgres flexible-server firewall-rule create -g $RG -s $PG \
  -n temporal-<nombre>-<aaaammdd> --start-ip-address <su-ip> --end-ip-address <su-ip>
az postgres flexible-server firewall-rule delete -g $RG -s $PG -n temporal-<nombre>-<aaaammdd> --yes
```

- La `DATABASE_URL` de Azure va con **`sslmode=verify-full`**: el backend verifica el certificado (`src/config/database-ssl.ts`). Para `psql` (libpq 16 o más), `sslmode=verify-full sslrootcert=system` usa los certificados del sistema.
- **No se agregan reglas por IP de salida del Container App** (riesgo aceptado, arriba).

### 1.3 Usuario de la app con permisos mínimos

El administrador del servidor (el que crea Elizabeth) **solo** corre migraciones y el seed. La app usa `dinno_app`, que no puede crear ni borrar tablas.

```sql
-- Como administrador, conectado a la base dinno. La clave la genera quien lo corre y va directo a Key Vault.
CREATE ROLE dinno_app LOGIN PASSWORD '<clave-larga-generada>';
GRANT CONNECT ON DATABASE dinno TO dinno_app;
GRANT USAGE ON SCHEMA public TO dinno_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dinno_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dinno_app;
-- Tablas que creen migraciones futuras (las corre el administrador):
ALTER DEFAULT PRIVILEGES FOR ROLE <admin> IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dinno_app;
ALTER DEFAULT PRIVILEGES FOR ROLE <admin> IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dinno_app;
```

- **Por confirmar con Elizabeth:** si el pipeline corre `migration:run` al desplegar, lo hace con la URL del administrador (un secreto aparte en Key Vault), nunca con la de `dinno_app`.
- Después de la presentación se cambian las dos claves (reparto §4.2).

### 1.4 Redis

- **Decidido (17 nov):** Azure Managed Redis `redis-dinno-4821`, Balanced B0, westus2, sin alta disponibilidad, directiva de clúster Enterprise (un solo punto de conexión, cliente normal), claves de acceso, base en el puerto **10000 solo con TLS 1.2+**.
- URL `rediss://:<clave>@<host>:10000`, guardada en Key Vault como `redis-url`; nada de puertos sin TLS.
- **Rotar la llave:** se regenera la secundaria, se actualiza el secreto de Key Vault, se reinicia la revisión y se regenera la primaria.
- Si Redis falla, el límite de peticiones cuenta en memoria y la API sigue (CLAUDE.md §11, «Límite de peticiones y cabeceras de seguridad»).

---

## 2. Secretos con Key Vault e identidad administrada

El Container App lee los secretos con **su propia identidad** y referencias a Key Vault. No hay contraseñas guardadas en el Container App, en GitHub ni en la imagen.

**Identidades (decidido el 17 nov), una por función y nunca compartidas:**

| Identidad | La usa | Roles (cada uno solo sobre ese recurso) |
|---|---|---|
| `id-dinno-backend` (administrada de usuario) | el Container App `ca-dinno-backend` | **Key Vault Secrets User** sobre `kv-dinno-4821` (solo lee secretos) y **AcrPull** sobre `acrdinno4821` (solo baja imágenes) |
| `id-gh-backend` (administrada de usuario, credencial federada de GitHub) | el job `deploy-azure` de `ci-cd.yml` | **AcrPush** sobre `acrdinno4821` y **Contributor** solo sobre `ca-dinno-backend` |

- `id-dinno-backend` se crea **antes** que el Container App: sus roles ya están aplicados cuando arranca la primera revisión (con la identidad del sistema, la primera revisión suele fallar al bajar la imagen o leer los secretos).
- Son dos identidades para que el pipeline no pueda leer secretos y el backend no pueda publicar imágenes ni cambiar su propia configuración.

```bash
# 2.1 Key Vault con permisos por roles (RBAC), Standard
az keyvault create -g $RG -n $KV -l $LOCATION --enable-rbac-authorization true --sku standard

# 2.2 Identidad del backend: leer secretos SOLO de este Key Vault y bajar imágenes SOLO de este registro
az identity create -g $RG -n id-dinno-backend -l $LOCATION
MI_ID=$(az identity show -g $RG -n id-dinno-backend --query id -o tsv)
MI_PRINCIPAL=$(az identity show -g $RG -n id-dinno-backend --query principalId -o tsv)
KV_ID=$(az keyvault show -g $RG -n $KV --query id -o tsv)
az role assignment create --assignee-object-id $MI_PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope $KV_ID
az role assignment create --assignee-object-id $MI_PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role AcrPull --scope $(az acr show -n $ACR --query id -o tsv)

# 2.3 Quien carga los secretos (Sebastián, Elizabeth): Secrets Officer solo sobre el Key Vault
az role assignment create --assignee <correo> --role "Key Vault Secrets Officer" --scope $KV_ID

# 2.4 Cargar los secretos (el valor se escribe en la terminal; se limpia el historial después)
az keyvault secret set --vault-name $KV -n database-url              --value '<postgres://dinno_app:…@…/dinno?sslmode=verify-full>'
az keyvault secret set --vault-name $KV -n redis-url                 --value '<rediss://…>'
az keyvault secret set --vault-name $KV -n firebase-service-account-json --file ~/.dinno/firebase-service-account.json
az keyvault secret set --vault-name $KV -n google-geocoding-api-key  --value '<llave>'
# la llave del modelo de IA, con el nombre que acuerden Santiago y Sergio en AVISOS.md

# 2.5 El Container App usa la identidad y referencia los secretos
az containerapp identity assign -g $RG -n $APP --user-assigned $MI_ID
KV_URI=$(az keyvault show -g $RG -n $KV --query properties.vaultUri -o tsv)
az containerapp secret set -g $RG -n $APP --secrets \
  "database-url=keyvaultref:${KV_URI}secrets/database-url,identityref:$MI_ID" \
  "redis-url=keyvaultref:${KV_URI}secrets/redis-url,identityref:$MI_ID" \
  "firebase-sa=keyvaultref:${KV_URI}secrets/firebase-service-account-json,identityref:$MI_ID" \
  "geocoding-key=keyvaultref:${KV_URI}secrets/google-geocoding-api-key,identityref:$MI_ID"
az containerapp update -g $RG -n $APP --set-env-vars \
  DATABASE_URL=secretref:database-url REDIS_URL=secretref:redis-url \
  FIREBASE_SERVICE_ACCOUNT_JSON=secretref:firebase-sa GOOGLE_GEOCODING_API_KEY=secretref:geocoding-key \
  NODE_ENV=production FIREBASE_PROJECT_ID=<id-del-proyecto>
```

- **Comprobar:** el backend arranca y `GET /v1/health` responde, sin ninguna variable con un valor secreto escrito directamente (`az containerapp show … --query properties.template.containers[0].env` muestra solo `secretRef`).
- **Lo que ya se expuso alguna vez se cambia:** si una llave estuvo en un chat, una captura o en Render, se genera una nueva al cargarla en Key Vault.
- El log nunca muestra secretos: el backend no los registra (CLAUDE.md §4).

---

## 3. GitHub Actions entra a Azure con OIDC

Cada repo tiene **su propia identidad**, con una credencial federada solo para su rama o su entorno, y el rol mínimo **solo sobre su recurso**. En GitHub quedan identificadores (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`), nunca una clave.

```bash
# Web (frontend): despliega dist en Static Web Apps desde el entorno «production»
az identity create -g $RG -n id-gh-frontend
az identity federated-credential create -g $RG --identity-name id-gh-frontend --name github-production \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:DiNNo-team/frontend:environment:production \
  --audiences api://AzureADTokenExchange
SWA_ID=$(az staticwebapp show -g $RG -n $SWA --query id -o tsv)
az role assignment create --assignee-object-id $(az identity show -g $RG -n id-gh-frontend --query principalId -o tsv) \
  --assignee-principal-type ServicePrincipal --role Contributor --scope $SWA_ID
az identity show -g $RG -n id-gh-frontend --query clientId -o tsv   # → variable AZURE_CLIENT_ID del repo frontend

# Backend: job deploy-azure de ci-cd.yml (needs: checks, solo en push a develop, SIN environment en el job),
# así que el subject es la rama, no un entorno. Sube la imagen y actualiza el Container App.
az identity create -g $RG -n id-gh-backend
az identity federated-credential create -g $RG --identity-name id-gh-backend --name github-develop \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:DiNNo-team/backend:ref:refs/heads/develop \
  --audiences api://AzureADTokenExchange
GH_PRINCIPAL=$(az identity show -g $RG -n id-gh-backend --query principalId -o tsv)
az role assignment create --assignee-object-id $GH_PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role AcrPush --scope $(az acr show -n $ACR --query id -o tsv)
az role assignment create --assignee-object-id $GH_PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role Contributor --scope $(az containerapp show -g $RG -n $APP --query id -o tsv)
# Nunca sobre rg-dinno ni la suscripción. No es id-dinno-backend: el pipeline no lee secretos.
```

- **Comprobar:** `az role assignment list --assignee <clientId> --all -o table` muestra solo esos permisos. Ninguna identidad tiene *Owner* ni *Contributor* sobre el grupo o la suscripción.
- En GitHub: Settings → Environments → `production` (frontend), y Settings → Variables con los identificadores.

---

## 4. Cuentas y permisos del equipo

| Persona | Rol mínimo | Ámbito |
|---|---|---|
| Elizabeth | Contributor | `rg-dinno` (crea el backend, PostgreSQL, Redis y su pipeline) |
| Sebastián | Contributor + Role Based Access Control Administrator (solo para asignar roles a las identidades) | `rg-dinno` |
| Jacobo | Reader + Cost Management Reader + Monitoring Contributor | `rg-dinno` (costos, alertas y paneles, sin cambiar la red) |
| Santiago, Sergio | Reader | `rg-dinno` (ven el estado; la llave de IA se pide por privado) |

```bash
az role assignment list -g $RG --include-inherited -o table          # quién tiene qué
az role assignment delete --assignee <correo> --role <rol> -g $RG     # retirar lo que sobra
```

- **Verificación en dos pasos:** cada persona la activa en su cuenta. El día de la presentación, el celular de la cuenta dueña de la suscripción va con alguien del equipo (checklist de Jacobo).
- Nadie tiene *Owner* salvo la cuenta dueña de la suscripción.

---

## 5. Después de CADA cambio de red, firewall o secretos

1. `node scripts/qa/humo-red.mjs` con `CONFIRM=1` (ver su encabezado). Recorre salud, cabeceras, 401, CORS, inicio de sesión, búsqueda, los dos WebSocket y una reserva de punta a punta.
2. Se anota la fila en `docs/qa/pruebas-de-red.md`.
3. Si algo falla, se revierte el último cambio antes de seguir.

---

## 6. Pruebas de seguridad (tarea 6.1.6)

| Caso | Cómo | Esperado |
|---|---|---|
| Ruta privada sin sesión | `curl -i https://<api>/v1/me` | 401 |
| Rol incorrecto | token de comensal en `GET /v1/tables` | 403 `DINER_ACCOUNT` |
| Datos de otro restaurante | token de Casa 72 en `PATCH /v1/tables/<id de otro>` | 404 (no revela que existe) |
| Exceso de peticiones | 11 `POST /v1/reservations` en un minuto con la misma cuenta | el 11.º, 429 |
| Base no expuesta | `nc -vz -w 5 <pg> 5432` o `psql` desde una red fuera de Azure **sin** regla temporal | conexión rechazada o sin respuesta |
| Redis sin clave | `redis-cli --tls -h <redis> -p 10000 PING` | `NOAUTH` |
| Redis sin TLS | `redis-cli -h <redis> -p 10000 PING` | sin respuesta o conexión cerrada |
| HTTPS obligatorio | `curl -i http://<api>/v1/health` | redirección a HTTPS o rechazo |
| Errores sin detalle interno | ruta inexistente y JSON inválido | mensaje en español, sin stack |
| Cabeceras | `curl -I https://<api>/v1/health` | CSP, HSTS, `nosniff` |

Los resultados van en la matriz de Santiago, con responsable y evidencia.
