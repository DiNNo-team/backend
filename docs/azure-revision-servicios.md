# Revisión de servicios de Azure: PostgreSQL Flexible Server, Redis y Container Apps

**Sprint 3 · PBI 7.1 · Tareas 7.1.3 y 7.1.4** · Autor: Jacobo · Consultado el 8 nov 2026

**Alcance:** solo revisión. **No se creó ningún recurso en Azure** (ni PostgreSQL ni Redis).

**Cómo leerlo:** cada dato lleva su fuente. Lo que la fuente no dice está marcado **«Por confirmar»** y se resuelve antes de crear el recurso, no se supone.

## 1. PostgreSQL Flexible Server

| Tema | Qué dice la documentación | Fuente |
|---|---|---|
| **Nivel más barato** | Burstable, SKU más pequeño **B1ms**: 1 vCore, 2 GiB de memoria. Los otros niveles empiezan en 2 vCores (General Purpose, 8 GiB; Memory Optimized, 16 GiB). | [Compute y almacenamiento](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-compute-storage) |
| **¿Sirve para DiNNo?** | Microsoft lo describe como adecuado para «servidores web, pruebas de concepto, bases pequeñas y desarrollo», y **no recomendado para producción** ni con soporte 24/7. Para el piloto y la demo alcanza; si se pasa a producción real, habrá que subir de nivel. | misma fuente |
| **Almacenamiento** | Mínimo 32 GiB en todos los niveles; máximo 64 TiB. Se puede **aumentar** en segundos. La página no dice que se pueda reducir. | misma fuente |
| **Precio** | La página oficial de precios mostraba «$-» al consultarla, así que **no hay cifra oficial en este documento**. Una fuente de terceros ([Bytebase](https://www.bytebase.com/dbcost/azure-flexible/instance/B1ms/), actualizada el 2 nov 2026) indica unos **12 dólares al mes** (la fuente no precisa la moneda) de cómputo para B1ms en East US, **sin** almacenamiento, IOPS, copias ni transferencia. **Por confirmar** con la [calculadora de Azure](https://azure.microsoft.com/en-ca/pricing/details/postgresql/flexible-server/) antes de crear nada. | enlaces del renglón |
| **Cómo se conecta** | Al crear el servidor se elige: **acceso privado** (integración con red virtual) o **acceso público** (IP permitidas) con opción de private endpoint. Con acceso público, por defecto **no se permite ninguna IP**; hay una casilla «Permitir acceso público desde cualquier servicio de Azure», que abre el servidor a todo Azure, incluso otras suscripciones, así que exige credenciales fuertes. Las reglas son solo **IPv4**, tardan hasta **5 minutos** en aplicarse y el cifrado de la conexión es obligatorio. Si el servicio de Azure tiene una IP de salida fija, Microsoft recomienda permitir esa IP. | [Acceso público](https://learn.microsoft.com/azure/postgresql/network/concepts-networking-public) |
| **¿Se puede cambiar el modo de red después?** | La página **no lo dice**. **Por confirmar** antes de crear el servidor. | misma fuente |
| **Conectar desde Container Apps** | No se verificó una guía oficial de esta conexión (variables, secretos y red). **Por confirmar.** Regla del proyecto: la cadena de conexión va como secreto del Container App, nunca en el repo. | — |
| **Copias de seguridad** | Automáticas, una vez al día más los registros de transacciones de forma continua. Retención de **7 a 35 días** (7 por defecto). Se puede restaurar a cualquier momento de ese periodo, y **siempre crea un servidor nuevo** (no pisa el actual). Hasta el 100 % del almacenamiento aprovisionado se incluye como copia sin costo adicional. | [Copias y restauración](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-backup-restore) |
| **Copias en otra región** | La redundancia geográfica se elige **solo al crear** el servidor y no se puede cambiar después. La página no indica qué niveles la admiten. **Por confirmar.** | misma fuente |
| **Alta disponibilidad** | Dos modos: **zone-redundant** (réplica en otra zona; conmutación en 60–120 s, a veces más, sin pérdida de datos) y **zonal** (misma zona; protege fallos de nodo, no de zona). **Zone-redundant no se admite en Burstable.** La página no habla del costo de la réplica ni dice si zonal se admite en Burstable. Para el MVP no se necesita. | [Alta disponibilidad](https://learn.microsoft.com/azure/postgresql/high-availability/concepts-high-availability) |
| **Apagar el servidor para ahorrar** | No se verificó cuánto puede estar detenido ni cómo cobra. **Por confirmar** (la fuente remite a la guía de administración por el portal). | [Administrar el servidor](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/how-to-manage-server-portal) |

## 2. Redis

**Cambio importante:** Azure Cache for Redis está **en retiro**. Microsoft recomienda **Azure Managed Redis** y pide no esperar a la fecha límite ([preguntas sobre el retiro](https://learn.microsoft.com/azure/azure-cache-for-redis/retirement-faq)).

| Niveles | Fecha de retiro |
|---|---|
| Basic, Standard y Premium | 30 sep 2028 (deshabilitados desde el 1 oct 2028) |
| Enterprise y Enterprise Flash | 31 mar 2027 (deshabilitados desde el 1 abr 2027) |

Por eso este plan considera **Azure Managed Redis** y no el servicio antiguo.

| Tema | Qué dice la documentación | Fuente |
|---|---|---|
| **Niveles** | Memory Optimized (12–1920 GB), Balanced (0,5–960 GB), Compute Optimized (3–720 GB) y Flash Optimized (250–4500 GB). El **tamaño más pequeño es 0,5 GB, en Balanced**. | [Descripción general](https://learn.microsoft.com/azure/redis/overview) |
| **Modo clúster** | Azure Managed Redis está en clúster **por defecto**; también ofrece una opción sin clúster de hasta 25 GB, pero Microsoft recomienda el clúster. Las librerías cliente deben estar configuradas para Redis en clúster, y hay que evitar los comandos entre ranuras (cross-slot). | [Retiro y migración](https://learn.microsoft.com/azure/azure-cache-for-redis/retirement-faq) |
| **Red** | Admite private endpoint y aislamiento de red. | descripción general |
| **Autenticación** | Admite Microsoft Entra ID. Las guías de migración mencionan también cambiar el host y la clave de acceso, así que las claves existen. | descripción general y retiro |
| **Pub/Sub** | La página **no lo menciona**. El reparto pide revisar Pub/Sub para varias réplicas. **Por confirmar** que Azure Managed Redis lo admite y con qué límites. | — |
| **Precio** | **No se obtuvo cifra.** Por confirmar en la [página de precios](https://azure.microsoft.com/en-au/pricing/details/managed-redis). | — |

**Para el adaptador de Socket.IO (Sprint 4):** el backend corre hoy en **una sola instancia**, con las salas en memoria. Para varias réplicas hace falta el adaptador de Redis. **Por confirmar:** si el adaptador elegido funciona con el modo clúster de Azure Managed Redis o hay que usar la opción sin clúster.

## 3. Container Apps (lo que afecta al backend)

| Tema | Qué dice la documentación | Fuente |
|---|---|---|
| **Cuota gratis mensual (plan Consumption, por suscripción)** | 180 000 vCPU-segundos, 360 000 GiB-segundos y 2 millones de solicitudes. | [Precios](https://azure.microsoft.com/en-us/pricing/details/container-apps/) |
| **Escala a cero** | Se puede configurar y, mientras la app está en cero réplicas, **no se cobra uso**. Los precios por segundo no se veían en la página. | misma fuente |
| **Afinidad de sesión** | Basada en cookies HTTP. Solo en modo de **revisión única** y con ingress HTTP. El cliente puede pasar a otra réplica si la suya deja de estar disponible. La página **no menciona WebSockets ni Socket.IO.** | [Afinidad de sesión](https://learn.microsoft.com/azure/container-apps/sticky-sessions) |

**Consecuencia:** hasta decidir lo del adaptador de Redis, el backend debe correr con **una sola réplica**, porque las salas de Socket.IO viven en la memoria del proceso. Escalar a cero ahorra créditos, pero la primera conexión tendría que esperar el arranque: se decide según lo que necesite la demo. Por confirmar cómo se comporta Socket.IO con la afinidad de sesión.

## 4. Resumen para el plan de migración

1. **PostgreSQL:** Burstable B1ms, sin alta disponibilidad y con retención de copias de 7 días. Para producción real habría que subir de nivel. En cuanto a la red, la documentación recomienda permitir la IP de salida del servicio si es fija; **por confirmar** si el Container App tiene una IP de salida fija. Si no la tiene, la alternativa es el acceso privado o la casilla «cualquier servicio de Azure» con credenciales fuertes, y se decide antes de crear el servidor.
2. **Redis:** Azure Managed Redis (el servicio antiguo se retira), nivel Balanced de 0,5 GB como punto de partida, y solo cuando se quiera más de una instancia del backend.
3. **Backend:** una réplica; la estrategia de WebSocket con varias réplicas se decide en el Sprint 4.
4. **Variables del backend** que hay que llevar (según los avisos de Elizabeth): `RESERVATION_TTL_MINUTES` (2 a 15, por defecto 15) y `RESERVATION_EXPIRY_ENABLED` (`true` o `false`). Con un valor inválido la app no arranca. Además (según `CLAUDE.md` §11, «Migración a Azure»): `NODE_ENV=production`, porque sin ella no aplican las protecciones que bloquean el usuario de desarrollo y el emulador de Firebase; y un reemplazo de `RENDER_GIT_COMMIT` para el commit de `GET /v1/health`, porque sin él la comprobación del despliegue en el CI no pasa.

## 5. Por confirmar antes de crear nada

- Precio actual de B1ms con almacenamiento, y de Azure Managed Redis Balanced 0,5 GB.
- Si el modo de red de PostgreSQL se puede cambiar después de crear el servidor.
- Guía oficial para conectar Container Apps con PostgreSQL (red, secretos y variables).
- Qué niveles admiten copias en otra región, y cómo cobra apagar el servidor.
- Pub/Sub y modo clúster en Azure Managed Redis frente al adaptador de Socket.IO.
- Cómo se comporta Socket.IO con la afinidad de sesión de Container Apps.

## Fuentes

- [Compute y almacenamiento de PostgreSQL Flexible Server](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-compute-storage)
- [Acceso público y reglas de firewall](https://learn.microsoft.com/azure/postgresql/network/concepts-networking-public)
- [Copias de seguridad y restauración](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-backup-restore)
- [Alta disponibilidad](https://learn.microsoft.com/azure/postgresql/high-availability/concepts-high-availability)
- [Precios de PostgreSQL Flexible Server](https://azure.microsoft.com/en-ca/pricing/details/postgresql/flexible-server/) y [referencia de terceros (Bytebase)](https://www.bytebase.com/dbcost/azure-flexible/instance/B1ms/)
- [Retiro de Azure Cache for Redis](https://learn.microsoft.com/azure/azure-cache-for-redis/retirement-faq)
- [Azure Managed Redis: descripción general](https://learn.microsoft.com/azure/redis/overview) y [precios](https://azure.microsoft.com/en-au/pricing/details/managed-redis)
- [Precios de Container Apps](https://azure.microsoft.com/en-us/pricing/details/container-apps/)
- [Afinidad de sesión en Container Apps](https://learn.microsoft.com/azure/container-apps/sticky-sessions)
