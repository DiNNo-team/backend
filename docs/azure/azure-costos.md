# Costos de Azure · DiNNo (Sprint 4)

> Estimación para decidir Redis y para los costos de infraestructura del plan de negocio.
> Dueño: Jacobo · 17 nov 2026 · Precios de lista en USD, pago por uso, regiones de EE. UU.
> **Confirmar cada fila en la calculadora de Azure con la región real del recurso** (`westus2`, salvo PostgreSQL en `westcentralus`; puede variar unos centavos) y pegar el enlace de la estimación aquí.
> Créditos: cuenta gratuita, vencen el **9 dic 2026**.

## 0. Lo que existe (creado el 17 nov 2026, grupo `rg-dinno`)

| Recurso | Nombre | Plan | Región | Cobra quieto |
|---|---|---|---|---|
| Azure Managed Redis | `redis-dinno-4821` | Balanced **B0**, sin alta disponibilidad | westus2 | **Sí, cada hora** (desde las 15:13 del 17 nov, hora de Bogotá) |
| PostgreSQL Flexible Server | `pg-d4821-westcentralus-1ms` | Burstable **B1ms**, 32 GiB, PostgreSQL 17 | **westcentralus** | Almacenamiento sí; cómputo solo encendido |
| Container App (backend) | `ca-dinno-backend` | Consumo, 1 réplica de **0,5 vCPU y 1 GiB** | westus2 | No con 0 réplicas |
| Container Registry | `acrdinno4821` | **Basic** | westus2 | **Sí, tarifa diaria** |
| Static Web Apps (web) | `swa-dinno` | **Free** | westus2 | No |
| Key Vault | `kv-dinno-4821` | Standard | westus2 | No (centavos por operación) |
| Log Analytics | `log-dinno` | Por GB, tope de 0,1 GB/día | westus2 | Solo al recibir registros |
| Identidades | `id-dinno-backend`, `id-gh-backend`, `id-gh-frontend` | — | westus2 | No |

- **API:** https://ca-dinno-backend.icyrock-d101225d.westus2.azurecontainerapps.io · **Web:** https://brave-grass-07093571e.3.azurestaticapps.net
- **PostgreSQL quedó en westcentralus** porque westus2, westus y westus3 no tenían capacidad de B1ms para la cuenta con créditos. El tráfico entre el backend (westus2) y la base (westcentralus) se cobra como transferencia entre regiones: con este volumen son centavos (confirmar en la calculadora). Decisión en [`seguridad-red.md`](seguridad-red.md) §1.

## 1. Precio por servicio

| Servicio | Plan | Precio unitario | Por hora | Por mes (730 h) | ¿Cobra aunque esté apagado o quieto? |
|---|---|---|---|---|---|
| **Azure Managed Redis** | Balanced **B0**, 1 nodo, sin alta disponibilidad | por hora de instancia | **~USD 0,016–0,018** | **~USD 11,7–13,1** | **SÍ. No se puede pausar: cobra cada hora mientras exista.** Con alta disponibilidad (2 nodos) cuesta el doble |
| **PostgreSQL Flexible Server** | Burstable **B1ms** (1 vCore, 2 GiB), en **westcentralus** | cómputo por hora | **~USD 0,017** (precio de EE. UU.; confirmar el de westcentralus) | **~USD 12,4** | Cómputo: **no** (se detiene). **Almacenamiento: SÍ**, se cobra aunque esté detenido |
| PostgreSQL: almacenamiento | 32 GiB (mínimo) | ~USD 0,115 por GiB al mes (verificar) | ~USD 0,005 | **~USD 3,7** | **SÍ, siempre** |
| **Container App (backend)** | Consumo, 1 réplica de 0,5 vCPU y 1 GiB (el tamaño real de `ca-dinno-backend`) | vCPU activa USD 0,000024/s · memoria USD 0,000003/GiB-s · vCPU inactiva USD 0,000003/s | Activa: **~USD 0,054** · Quieta: **~USD 0,016** | 24/7 quieta: **~USD 11,8** · 24/7 activa: **~USD 39,4** (antes del gratuito) | **No con 0 réplicas.** Con mínimo 1 cobra la tarifa de inactiva aunque nadie la use |
| Container App, **2 réplicas** | igual que arriba ×2 | — | Activa: **~USD 0,108** · Quieta: **~USD 0,032** | 24/7 quieta: **~USD 23,6** · 24/7 activa: **~USD 78,8** | Solo para pruebas puntuales |
| Container Apps: gratuito mensual | por suscripción | 180.000 vCPU-s · 360.000 GiB-s · 2 millones de solicitudes | — | Equivale a **~100 horas de 1 réplica** gratis al mes | — |
| **Key Vault** | Standard | USD 0,03 por cada 10.000 operaciones | ~USD 0 | **< USD 0,10** | No |
| **Static Web Apps** | Free | USD 0 · 100 GB de ancho de banda · 2 dominios propios · 10 apps | USD 0 | **USD 0** | No |
| **Container Registry** | Basic, 10 GB incluidos | USD 0,167 por día | ~USD 0,007 | **~USD 5,0** | **SÍ, cobra por día mientras exista.** Lo usa el pipeline del backend (job `deploy-azure`) |
| **Log Analytics** | Por GB ingerido, tope de 0,1 GB/día (0,5 solo el día de la prueba de carga) | por GB | — | Bajo, limitado por el tope | Solo cuando llegan registros |
| Transferencia entre regiones | backend (westus2) ↔ PostgreSQL (westcentralus) | por GB transferido | — | Centavos con este volumen (confirmar) | Solo con tráfico |

## 2. Lo que cobra por hora aunque nadie lo use

1. **Azure Managed Redis**: no se pausa. Se paga desde que se crea hasta que se elimina.
2. **Almacenamiento de PostgreSQL**: aunque el servidor esté detenido.
3. **Container Registry** (`acrdinno4821`): tarifa diaria fija.
4. **Container App con `min-replicas` ≥ 1**: tarifa de inactiva. Con `min-replicas 0` no cobra.

## 3. Redis: Azure Managed Redis o Upstash

**Decidido el 17 nov: Azure Managed Redis B0**, sin alta disponibilidad, en westus2 (`redis-dinno-4821`). La comparación queda como registro de por qué.

| | Azure Managed Redis B0 | Upstash (gratuito, el de hoy) |
|---|---|---|
| Costo | ~USD 0,016–0,018 por hora, siempre. Del 17 nov al 9 dic (~530 h): **~USD 8,5–9,5** | **USD 0** dentro de 256 MB y 500.000 comandos al mes; después, USD 0,20 por cada 100.000 comandos |
| Pausa | No se puede pausar | No hace falta: no cobra por tiempo |
| Ubicación | Misma región que el backend (westus2), baja latencia | Fuera de Azure: hay que elegir una región de EE. UU. Oeste para no sumar latencia |
| Red y seguridad | Se puede restringir dentro de Azure (decisión de Sebastián) | Acceso por internet con TLS y contraseña |
| Riesgo | Si alguien lo crea con alta disponibilidad, cuesta el doble | **El adaptador de Socket.IO y la prueba de carga pueden gastar los 500.000 comandos.** Revisar el consumo en la consola de Upstash durante la prueba |
| Para la sustentación | «Todo está en Azure» | Hay que explicar por qué una pieza está fuera de Azure |

**Conclusión para la reunión:** cualquiera de las dos cabe en los créditos. Redis B0 hasta el 9 de diciembre cuesta menos de USD 10. La decisión depende de la arquitectura y de la seguridad, no del dinero. Si se elige Azure Managed Redis, **se crea sin alta disponibilidad** y en **westus2**.

## 4. Escenarios

| Escenario | Cuánto cuesta |
|---|---|
| **Sprint (17 nov – 9 dic)**, encendiendo solo para trabajar y apagando cada noche (~60 h de backend y base) | Container App dentro del gratuito (~USD 0) + PostgreSQL ~USD 1 de cómputo + ~USD 2 de almacenamiento + Redis B0 ~USD 9 + ACR ~USD 4 → **~USD 16 en total** (con Upstash habría sido ~USD 7) |
| **Mes completo 24/7, 1 réplica con poco tráfico** (base para el plan de negocio) | Container App ~USD 12 − gratuito + PostgreSQL ~USD 16 + Redis ~USD 12 + ACR ~USD 5 + Key Vault y SWA ~USD 0 → **~USD 40–45 al mes** |
| **Mes completo 24/7, 1 réplica activa todo el tiempo** (peor caso razonable) | **~USD 65–70 al mes** |
| **Mes completo 24/7, 2 réplicas activas** | **~USD 105–110 al mes** |

## 5. Para Sergio (plan de negocio)

- Infraestructura del piloto en Azure: **~USD 40–70 al mes** con 1 réplica (rango según el tráfico), y **~USD 105–110** con 2 réplicas.
- Lo que más pesa: **PostgreSQL (~USD 16)**, **Redis (~USD 12)** y **el backend activo (hasta ~USD 39)**.
- Convertir a COP con la misma tasa de cambio que usa el modelo financiero.
- No incluye: Google Maps (otra cuenta, hoy en prueba gratuita), Firebase ni dominios propios.

## 6. Pendientes

- [ ] Confirmar cada fila en la calculadora (`westus2`; PostgreSQL con `westcentralus`) y pegar el enlace de la estimación.
- [x] Tamaño de la réplica y almacenamiento: 0,5 vCPU y 1 GiB; PostgreSQL con 32 GiB (17 nov).
- [ ] Después de unos días con todo creado, comparar contra **Cost Management → Análisis de costos**, filtrado por `rg-dinno` (costo real), actualizar y enviárselo a Sergio.

Fuentes de precios: páginas oficiales de precios y documentación de Azure (Container Apps, Key Vault, Static Web Apps, Container Registry), página de precios de Upstash y comparadores públicos para Managed Redis B0 y PostgreSQL B1ms (la página oficial de esos dos no muestra cifras sin la calculadora).
