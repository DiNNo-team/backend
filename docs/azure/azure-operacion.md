# Operación de Azure · DiNNo

> Encendido, apagado y revisión diaria de lo desplegado en Azure (Sprint 4).
> Dueño: Jacobo. **Sin secretos:** aquí no van claves, cadenas de conexión ni IDs de suscripción.
> Los créditos vencen el **9 de diciembre de 2026**. Nunca pasar la cuenta a «pago por uso».

## 1. Recursos

| Recurso | Nombre | Región | ¿Cobra quieto? | Estado |
|---|---|---|---|---|
| Grupo de recursos | `rg-dinno` | eastus | No | Existe |
| Entorno de Container Apps (consumo) | `managedEnvironment-rgdinno-8310` | westus2 | No | Existe |
| App de prueba (hello world) | `ca-dinno-prueba` | westus2 | No (escala a 0) | Existe · se elimina cuando el backend real esté arriba |
| Backend | `<por confirmar con Elizabeth>` | westus2 | Solo con réplicas > 0 | Pendiente |
| PostgreSQL Flexible Server | `<por confirmar>` | westus2 | **Sí, mientras está encendido** (el almacenamiento cobra siempre) | Pendiente |
| Redis administrado | `<por confirmar>` | westus2 | **Sí, siempre** (no se puede pausar) | Pendiente · decisión del equipo |
| Log Analytics | `log-dinno` | westus2 | Por GB ingerido (tope diario) | Pendiente |

Todo lo nuevo va en **westus2**, la región del entorno de Container Apps. Si la base o Redis quedan en otra región, aumenta la latencia y puede cobrarse tráfico entre regiones.

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
APP=<nombre-del-backend>      # mientras tanto: ca-dinno-prueba
PG=<nombre-del-servidor-pg>
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

- [ ] Nombres reales del backend, PostgreSQL y Redis.
- [ ] Monitoreo: Log Analytics conectado al entorno, consultas guardadas y panel.
- [ ] Checklist del día de la presentación (documento aparte).
