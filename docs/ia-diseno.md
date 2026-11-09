# Diseño de la IA de DiNNo: informe inteligente del restaurante

**Sprint 3 · PBI 6.1 · Tareas 6.1.3 (elegir el caso) y 6.1.5 (documento de diseño)** · Autores: Santiago y Sergio · Borrador del 9 nov 2026
**Alcance:** solo el diseño. **No cambia código, base de datos, variables de entorno ni dependencias.** La IA se construye en el Sprint 4 (Feature 2, con mecanismo de respaldo).
**Fuentes:** `DiNNo_Sprint3_Reparto.md` (§9.4), `CLAUDE.md` (§11 y §12), `docs/database.md`, `docs/export-datos.md`, el inventario de datos y la comparación de opciones del equipo, y el código citado en cada sección.
**Regla del documento:** lo que no está en el repo ni en una fuente citada está marcado **«Por confirmar»**. Lo que es propuesta del equipo dice «Propuesta».

> **El flujo principal nunca depende de la IA.** El informe es de solo lectura: si el módulo falla, reservar, cancelar, vencer y hacer check-in siguen funcionando igual.

---

## 1. Decisión

**Caso elegido: informe inteligente para el restaurante, con métricas de confiabilidad (opciones A + E de la comparación).**

Cada restaurante ve en la web un informe de los últimos 7 días con:

1. **Métricas de su operación en DiNNo:** reservas, check-ins, cancelaciones, vencimientos (no-show), horas con más reservas y uso de mesas por tamaño.
2. **Un indicador de confiabilidad de su disponibilidad:** alta, media o baja, con los motivos.
3. **Un texto corto en lenguaje natural con recomendaciones**, redactado por un modelo de lenguaje a partir **solo** de las métricas calculadas. Si el modelo no está disponible, el texto sale de plantillas (respaldo).

**Por qué este caso** (detalle en la sección 2):

- Funciona con los datos que DiNNo ya guarda (`reservations`, `check_ins`, `table_logs`, `tables`). No hay que guardar datos nuevos del comensal.
- Arranca sin historial: con pocos datos, el informe muestra conteos y reglas simples, y mejora a medida que llegan reservas del piloto.
- No toca el flujo principal: es un módulo nuevo, de solo lectura.
- La privacidad es sencilla: el modelo de lenguaje solo recibe números agregados de un restaurante, nunca datos de un comensal.
- Encaja con el negocio: el restaurante paga por check-in (evento facturable, Reparto §3.5), y el informe le muestra qué le aporta DiNNo.

---

## 2. Opciones evaluadas

Puntaje de 1 a 3 por criterio (más es mejor; en *Esfuerzo* y *Riesgo*, 3 = poco esfuerzo y poco riesgo). Es un puntaje del equipo, no una medición.

| Opción | Valor | Datos | Sin historial | Esfuerzo | Riesgo | Total (de 15) | Ejemplo real |
|---|---|---|---|---|---|---|---|
| **A. Informe para el restaurante** | 3 | 3 | 2 | 2 | 3 | **13** | OpenTable *Conversational Reporting* (en pruebas, 26 ago 2026) |
| **E. Confiabilidad de la disponibilidad** | 3 | 3 | 2 | 3 | 2 | **13** | Sin caso igual; Google Maps no publica afluencia sin datos suficientes |
| F. Búsqueda en lenguaje natural | 2 | 3 | 3 | 2 | 2 | 12 | OpenTable *Concierge* |
| B. Horas con mesa para el comensal | 2 | 2 | 1 | 2 | 3 | 10 | Google Maps *popular times* |
| C. Riesgo de no-show por reserva | 2 | 2 | 1 | 2 | 1 | 8 | Tesis URJC (2025) sobre predicción de cancelaciones |
| D. Recomendaciones personalizadas | 2 | 1 | 1 | 1 | 1 | 6 | Uber Eats (redes de grafos sobre pedidos) |

**Por qué no las otras:**

- **F** funciona desde el primer día, pero con 8 a 15 restaurantes en el piloto hay poco que buscar, cuesta una llamada al modelo por búsqueda y el texto del comensal sale a un tercero.
- **B** necesita varias semanas de historial por restaurante y depende de que el restaurante marque sus mesas a mano a tiempo.
- **C** perfila a una persona (privacidad y sesgo), y en DiNNo un no-show cuesta poco: la mesa se libera sola en máximo 15 minutos.
- **D** necesita datos que DiNNo no guarda (búsquedas, ubicación, preferencias) y aporta poco con tan pocos restaurantes.
- **A + E juntas:** E sola es casi solo estadística (débil como «IA»); A sola no tiene un indicador que el restaurante pueda mejorar. Juntas, E da el núcleo de métricas y A las convierte en recomendaciones.

**Fuentes:**
- OpenTable, 26 ago 2026: [anuncio de nuevas funciones para restaurantes](https://www.opentable.com/blog/?p=152599).
- Restaurant Online, 22 jul 2026: [OpenTable expands its AI dining assistant Concierge](https://www.restaurantonline.co.uk/Article/2026/07/22/opentable-expands-its-ai-dining-assistant-concierge/).
- Google, 15 oct 2020: [Behind the scenes: popular times and live busyness information](https://blog.google/products/maps/maps101-popular-times-and-live-busyness-information/).
- Uber, 4 dic 2019: [Food Discovery with Uber Eats: Using Graph Learning to Power Recommendations](https://www.uber.com/blog/uber-eats-graph-learning/).
- Gómez Talal, I., 2025: [Data-driven decision making: applying machine learning to revenue management in hospitality](https://portaldelaciencia.uva.es/documentos/68dacb269247dc36ff6752d5), tesis doctoral, Universidad Rey Juan Carlos.

---

## 3. Qué resuelve y para quién

| | |
|---|---|
| **Usuario** | El dueño o administrador del restaurante (`restaurant_admin`), en la web |
| **Problema** | El restaurante no sabe qué pasa con sus reservas de DiNNo: cuántas terminan en check-in, cuándo se le llenan las mesas, si sus mesas marcadas a mano reflejan la realidad. Hoy solo tiene la bitácora, fila por fila |
| **Qué gana** | Un resumen semanal con 2 o 3 recomendaciones accionables (por ejemplo, «el 40 % de tus reservas venció sin check-in: revisa si validas los códigos al recibir al comensal») |
| **Qué gana DiNNo** | Más reservas que terminan en check-in (evento facturable) y disponibilidad más confiable para el comensal, que es la promesa «Dile no a la espera» |

---

## 4. Datos

### 4.1 Tablas y columnas que usa (todas existen hoy)

| Tabla | Columnas | Para qué |
|---|---|---|
| `reservations` | `restaurant_id`, `table_id`, `party_size`, `status`, `created_at`, `expires_at`, `cancelled_at`, `expired_at`, `checked_in_at`, `no_show` | Conteos por estado, tasas, horas pico, tiempos |
| `check_ins` | `restaurant_id`, `reservation_id`, `checked_in_at` | Check-ins facturables |
| `table_logs` | `table_id`, `previous_status`, `new_status`, `source`, `changed_at` | Frecuencia de actualización manual de mesas (`source = 'manual'`) |
| `tables` | `restaurant_id`, `capacity`, `is_active` | Mesas activas por tamaño (denominador del uso) |

No se usan datos del comensal: ni `users`, ni `display_name`, ni correos, ni el código de la reserva.

### 4.2 Métricas (propuesta)

Periodo: los últimos 7 días completos, en hora de Bogotá, comparados con los 7 días anteriores. «Resueltas» = reservas que terminaron en `completed`, `cancelled` o `expired` dentro del periodo.

| Métrica | Cálculo | Fuente |
|---|---|---|
| Reservas creadas | Conteo por `created_at` en el periodo | `reservations` |
| Tasa de check-in | `completed` / resueltas | `reservations` |
| Tasa de no-show | `expired` / resueltas | `reservations` (no `table_logs`: ver 4.3) |
| Tasa de cancelación | `cancelled` / resueltas | `reservations` |
| Tiempo hasta el check-in | Mediana de `checked_in_at − created_at`, en minutos | `reservations` |
| Franjas con más reservas | Top 3 de (día de la semana, hora) por reservas creadas | `reservations` |
| Uso por tamaño de mesa | Reservas por capacidad de mesa ÷ mesas activas de esa capacidad | `reservations` + `tables` |
| Mesa más grande de lo necesario | Promedio de `capacity − party_size` | `reservations` + `tables` |
| Actualización manual | Cambios con `source = 'manual'` por día, y días del periodo sin ninguno | `table_logs` + `tables` |

### 4.3 Calidad de los datos (del inventario)

- **Volumen:** hoy casi no hay reservas reales. Con menos de **10 reservas resueltas** en el periodo (umbral **Por confirmar** con datos del piloto), el informe no calcula tasas ni el indicador: muestra solo conteos y el aviso de datos insuficientes.
- **`source = 'system'` mezcla dos cosas:** lo escriben el vencimiento automático y `demo:reset`. Por eso el no-show se cuenta desde `reservations`, no desde `table_logs`.
- **`no_show` no siempre es un no-show:** si el comensal llegó pero el restaurante no validó el código, cuenta como vencida. El informe lo dice así («reservas que vencieron sin check-in»), y esa misma tasa alta es la que dispara la recomendación de validar códigos.
- **Datos de prueba del equipo y de la demo** están en la misma base (Neon es desarrollo y producción a la vez). **Por confirmar:** cómo excluirlos (por fecha de inicio del piloto o por restaurante).
- **No hay historial de Abierto/Cerrado** (`restaurants.is_open` solo guarda el estado actual), así que el informe no puede medir cuántas horas estuvo abierto.

---

## 5. Indicador de confiabilidad (parte E)

**Propuesta de regla inicial** (sin entrenamiento; los umbrales son **Por confirmar** con datos del piloto):

| Nivel | Condición |
|---|---|
| **Sin datos suficientes** | Menos de 10 reservas resueltas en el periodo |
| **Alta** | Tasa de check-in ≥ 70 % **y** al menos un cambio manual de mesas en la mayoría de los días abiertos del periodo |
| **Baja** | Tasa de check-in < 40 % **o** ningún cambio manual de mesas en todo el periodo |
| **Media** | Cualquier otro caso |

- El indicador siempre trae sus **motivos** en texto («tasa de check-in del 35 %», «no actualizaste tus mesas en 5 de 7 días»), para que el restaurante sepa qué mejorar.
- **Quién lo ve:** en el Sprint 4, **solo el restaurante**. Mostrarlo al comensal (por ejemplo en el detalle público) queda **Por confirmar**: castigaría a un restaurante nuevo por tener pocos datos.

---

## 6. Arquitectura

### 6.1 Dónde vive

**Propuesta:** un módulo nuevo `insights` en el monolito modular (`src/modules/insights/`), registrado en `src/app.module.ts`, igual que los demás dominios (`CLAUDE.md` §11, «Arquitectura»).

| Pieza | Qué hace | Patrón que sigue en el repo |
|---|---|---|
| `InsightsController` | `GET /v1/restaurants/me/insights` con `@Roles(UserRole.RESTAURANT_ADMIN)` | Los controladores de `restaurants/me` |
| `InsightsMetricsReader` | Calcula las métricas del periodo con consultas **de solo lectura** | Lectores como `reservation-view.reader.ts` |
| `ReliabilityScorer` | Aplica la regla de la sección 5. Función pura, con pruebas | `table-assignment.ts` (regla pura) |
| `NarrativeWriter` (interfaz) | Convierte las métricas en el texto | `geocoder.ts` (interfaz) + `google-geocoder.ts` (proveedor) |
| `LlmNarrativeWriter` | Llama al modelo de lenguaje con timeout | `google-geocoder.ts` (`fetch` con `AbortSignal.timeout`) |
| `TemplateNarrativeWriter` | Respaldo con plantillas en español | — |
| Tabla `restaurant_insights` | Guarda el último informe generado (caché) | Migración de Elizabeth |

**Por confirmar con Elizabeth:** las métricas leen tablas de otros dos módulos (`reservations-checkin` y `restaurant-operations`). La regla del repo es que entre módulos solo se usan los providers exportados. Hay dos caminos: (a) consultas SQL de solo lectura dentro de `insights`, como un modelo de lectura, o (b) que esos módulos exporten un lector agregado. La (a) es más simple; la (b) respeta mejor la regla.

### 6.2 Cuándo corre

**Propuesta: bajo demanda, con caché de 24 horas.** Cuando el restaurante abre la pantalla, el backend devuelve el informe guardado si tiene menos de 24 horas; si no, lo genera, lo guarda y lo devuelve.

| Alternativa | A favor | En contra |
|---|---|---|
| **Bajo demanda con caché (propuesta)** | Sin proceso periódico nuevo; solo cuesta llamadas al modelo cuando alguien mira el informe | La primera apertura del día espera la generación (con timeout y respaldo) |
| Por lotes (por ejemplo, cada lunes) | El informe siempre está listo | Un proceso más que mantener; con varias réplicas en Azure correría en todas (mismo problema que el vencimiento) |

### 6.3 Flujo

1. La web pide `GET /v1/restaurants/me/insights`.
2. Si hay un informe de menos de 24 horas en `restaurant_insights`, se devuelve.
3. Si no: `InsightsMetricsReader` calcula las métricas → `ReliabilityScorer` calcula el nivel → `NarrativeWriter` redacta el texto.
4. `LlmNarrativeWriter` envía al modelo **solo** el objeto de métricas (números y etiquetas, sin nombre del restaurante ni datos de personas) y una instrucción fija: escribir 2 o 3 recomendaciones en español, tuteando, usando solo los números recibidos.
5. **Validación del texto:** si la respuesta llega vacía, pasa de 600 caracteres o menciona un número que no está en las métricas, se descarta y se usa `TemplateNarrativeWriter`.
6. Se guarda el informe con `narrativeSource` (`llm` o `template`) y se responde.

### 6.4 Variables de entorno nuevas (Sprint 4)

| Variable | Obligatoria | Qué es |
|---|---|---|
| `INSIGHTS_LLM_API_KEY` | No | Llave del proveedor del modelo. Sin ella, siempre se usan plantillas |
| `INSIGHTS_LLM_MODEL` | No | Nombre del modelo. **Por confirmar** con el proveedor |

Van en `.env.example` con comentario y en Render o Azure, nunca en el repo (`CLAUDE.md` §4).

---

## 7. Contrato del endpoint (propuesta)

| Método | Ruta | Rol | Recibe | Devuelve |
|---|---|---|---|---|
| GET | `/v1/restaurants/me/insights` | restaurant_admin | — | 200 `RestaurantInsights` · 403 `RESTAURANT_REQUIRED` / `DINER_ACCOUNT` / `ACCOUNT_NOT_ENABLED` (los de siempre) |

**`RestaurantInsights`:**

```json
{
  "periodStart": "2026-11-23T05:00:00.000Z",
  "periodEnd": "2026-11-30T05:00:00.000Z",
  "generatedAt": "2026-11-30T14:02:11.000Z",
  "dataSufficiency": "enough",
  "metrics": {
    "reservationsCreated": 42,
    "resolved": 40,
    "checkInRate": 0.65,
    "noShowRate": 0.25,
    "cancellationRate": 0.10,
    "medianMinutesToCheckIn": 9,
    "topSlots": [{ "dayOfWeek": 2, "hour": 13, "reservations": 8 }],
    "usageByCapacity": [{ "capacity": 2, "activeTables": 2, "reservations": 20 }],
    "averageSpareSeats": 1.2,
    "manualUpdatesPerDay": 3.4,
    "daysWithoutManualUpdates": 1,
    "previous": { "reservationsCreated": 35, "checkInRate": 0.58 }
  },
  "reliability": { "level": "medium", "reasons": ["Tasa de check-in del 65 %"] },
  "narrative": { "text": "…", "source": "llm" }
}
```

- `dataSufficiency`: `enough` o `insufficient`. Con `insufficient`, las tasas y `reliability.level` llegan en `null` y la web muestra el aviso de datos insuficientes.
- `dayOfWeek`: 1 = lunes … 7 = domingo (ISO 8601, igual que `restaurant_schedules`); `hour`: 0 a 23, en hora de Bogotá.
- El endpoint **nunca falla por la IA**: si el modelo falla, responde 200 con `narrative.source = "template"`.

---

## 8. Pantalla (web, propuesta)

- **Ruta nueva `/informe`** en el dashboard del restaurante, junto a `/mesas`, `/restaurante` y `/bitacora`.
- **Contenido, solo con el kit** (`components/ui`): `PageHeader`; `StatStrip` y `StatTile` para las métricas, con la comparación contra la semana anterior; `StatusChip` para el nivel de confiabilidad y sus motivos; `Card` con el texto de recomendaciones, marcado como generado automáticamente.
- **Estados:** carga (`Skeleton`), datos insuficientes (`EmptyState`: «Aún no hay suficientes reservas para tu informe. Vuelve cuando tengas al menos 10.»), error (`Alert` con «Intentar de nuevo») y modo oscuro.
- Textos del glosario del manual. Diseño final: Sebastián.

---

## 9. Respaldo sin IA

| Situación | Qué pasa |
|---|---|
| No hay `INSIGHTS_LLM_API_KEY` | Siempre plantillas. El informe funciona completo |
| El modelo tarda más del timeout, da error o se acaba el cupo | Plantillas para ese informe; se reintenta al vencer la caché |
| El texto no pasa la validación (sección 6.3, paso 5) | Plantillas |
| Datos insuficientes | Solo conteos y el aviso; sin indicador ni recomendaciones |
| Falla el módulo `insights` | Solo falla la pantalla `/informe`. Reservas, check-in y tiempo real no dependen de él |

---

## 10. Costos, privacidad y sesgos

**Costos.** Cada informe es una llamada al modelo, con una entrada pequeña (el objeto de métricas y la instrucción) y una salida de 2 o 3 párrafos. Con la caché de 24 horas, el máximo es **una llamada por restaurante al día**: con 15 restaurantes, unas 450 llamadas al mes. **El precio por llamada queda Por confirmar** al elegir el proveedor. Sin llave, el costo es cero.

**Privacidad.**
- Al proveedor solo sale el objeto de métricas de un restaurante: ningún dato de comensales, ni nombres, ni correos, ni códigos, ni el nombre o la dirección del restaurante.
- El informe solo lo ve el `restaurant_admin` de ese restaurante (filtro por el restaurante de la sesión, como toda la API).
- **Por confirmar:** revisar las condiciones del proveedor sobre retención de datos y uso para entrenamiento.

**Sesgos y riesgos.**
- **Restaurantes nuevos:** con pocos datos, el indicador podría salir bajo. Por eso existe «Sin datos suficientes».
- **Recomendaciones inventadas:** el modelo podría afirmar algo que los datos no dicen. Se mitiga con la instrucción fija, la validación de números y la marca de texto automático.
- **`no_show` engañoso** (sección 4.3): el texto habla de «reservas que vencieron sin check-in», no de «comensales que no llegaron».

---

## 11. Cómo se medirá si sirve

| Indicador | Cómo se mide | Meta |
|---|---|---|
| Uso | Restaurantes del piloto que abren `/informe` al menos una vez por semana | **Por confirmar** |
| Efecto | Tasa de check-in antes y después de que el restaurante use el informe | Que suba; meta **Por confirmar** |
| Confiabilidad | Días sin actualización manual de mesas, antes y después | Que bajen |
| Calidad del texto | Informes con `narrative.source = "template"` por fallas del modelo | Por debajo del 10 % (propuesta) |
| Opinión | Pregunta corta a los restaurantes del piloto: ¿la recomendación te sirvió? | Cualitativo |

La línea base son los datos del piloto antes de activar el informe.

---

## 12. Plan de tareas para el Sprint 4 (propuesta)

Responsables **Por confirmar** en la planeación del Sprint 4. Estimaciones en horas, propuesta del equipo.

| # | Tarea | Repo | Estimación |
|---|---|---|---|
| 1 | Migración de `restaurant_insights` y actualización de `docs/database.md` | backend | 2 h |
| 2 | `InsightsMetricsReader` con pruebas contra Postgres real (datos propios, como `test/db/`) | backend | 6 h |
| 3 | `ReliabilityScorer` (regla pura) con pruebas | backend | 2 h |
| 4 | `TemplateNarrativeWriter` con pruebas | backend | 3 h |
| 5 | `LlmNarrativeWriter` con timeout, validación del texto y pruebas con un doble del proveedor | backend | 5 h |
| 6 | Endpoint, caché de 24 h, Swagger y contrato en `CLAUDE.md` | backend | 4 h |
| 7 | Pantalla `/informe` con el kit, estados y modo oscuro | frontend | 8 h |
| 8 | Variables en Render y Azure, y aviso en `AVISOS.md` | backend | 1 h |
| 9 | Casos de QA en la matriz del Sprint 4 (datos suficientes e insuficientes, sin llave, modelo caído, otro restaurante) | frontend (`docs/qa/`) | 3 h |

---

## 13. Prototipo del Sprint 3

`ai-prototype/` (en este repo) calcula las métricas de las secciones 4 y 5 a partir de los CSV de `npm run export:data` (`docs/export-datos.md`) y escribe el informe con plantillas. No se conecta al backend, a la base ni a la app. Primero usa datos sintéticos; luego, el CSV que entrega Elizabeth.

**Diferencia con el diseño:** el CSV no trae la tabla `tables`, así que el prototipo no puede calcular el uso por tamaño de mesa ni la mesa más grande de lo necesario, salvo con una lista de mesas escrita a mano para la prueba.

---

## 14. Si el curso exige un modelo entrenado

**Por confirmar con el profesor:** si un modelo de lenguaje por API, que redacta a partir de métricas, cuenta como IA para el curso.

Si se exige un modelo entrenado, el diseño se mantiene y se agrega una pieza: un **modelo de clasificación simple** (por ejemplo, regresión logística) que estime la probabilidad de que una reserva termine en check-in según la franja horaria, el tamaño del grupo y el restaurante. Su resultado entraría al indicador de confiabilidad en lugar de los umbrales fijos de la sección 5. **Limitación:** con los datos actuales no hay suficientes reservas reales para entrenarlo bien; habría que entrenarlo con datos sintéticos y reentrenarlo con los del piloto.

---

## 15. Por confirmar

| # | Punto | Preguntar a |
|---|---|---|
| 1 | ¿El curso acepta un modelo de lenguaje por API como la IA del proyecto? (sección 14) | Profesor |
| 2 | Proveedor del modelo, precio por llamada y condiciones de privacidad | Equipo |
| 3 | Umbrales de datos suficientes y del indicador (secciones 4.3 y 5) | Santiago y Sergio, con datos del piloto |
| 4 | Consultas SQL de solo lectura en `insights` o lectores exportados por otros módulos (sección 6.1) | Elizabeth |
| 5 | Cómo excluir los datos de prueba y de la demo (sección 4.3) | Elizabeth |
| 6 | ¿El indicador de confiabilidad se muestra también al comensal? (sección 5) | Equipo |
| 7 | Responsables del Sprint 4 (sección 12) | Planeación del Sprint 4 |
