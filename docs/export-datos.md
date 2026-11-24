# Exportación anónima de datos · DiNNo

Para Santiago y Sergio (definición de la IA). Elizabeth genera los CSV con `npm run export:data` contra la base que corresponda; ustedes no necesitan acceso a la base.

## Cómo pedirlos

Pídanle el CSV a Elizabeth. Ella corre el script y les entrega la carpeta `exports/<fecha-hora>/` (fecha-hora en UTC). Hoy hay pocos datos reales: usen datos sintéticos y estos CSV para validar el formato y el pipeline. Los datos del piloto de la demo se exportan **después** de la demo.

## Archivos

Cada exportación trae `reservations.csv`, `check_ins.csv`, `table_logs.csv` y un `LEEME.md` con los conteos y este mismo diccionario.

- UTF-8, con cabecera, separado por comas, saltos de línea `\n`. Los campos con coma, comillas o saltos de línea van entre comillas (las comillas internas se duplican).
- Campo vacío = no aplica. Una tabla sin filas deja solo la cabecera.
- Fechas en ISO 8601 UTC. `day_of_week` (1 = lunes ... 7 = domingo) y `hour_of_day` (0 a 23) están en hora de Bogotá.

### reservations.csv

| Columna | Qué es |
|---|---|
| `reservation_id` | UUID de la reserva |
| `diner_pseudonym` | Seudónimo del comensal (16 hex). Solo agrupa reservas del mismo comensal dentro de esta exportación |
| `restaurant_id` | UUID del restaurante |
| `restaurant_category` | `colombian`, `italian`, `mexican`, `asian`, `grill`, `fast_food`, `healthy`, `seafood`, `cafe`, `other`; vacío si no tiene |
| `table_capacity` | Capacidad de la mesa asignada |
| `party_size` | Personas de la reserva (1 a 20) |
| `status` | `active`, `cancelled`, `expired` o `completed` |
| `created_at` | Cuándo se creó |
| `expires_at` | Cuándo vence |
| `expired_at` | Cuándo se marcó vencida; vacío si no venció. Puede ser posterior a `expires_at` (se marca al leerla o con el barrido) |
| `cancelled_at` | Cuándo se canceló; vacío si no |
| `checked_in_at` | Cuándo el restaurante hizo el check-in; vacío si no |
| `no_show` | `true` si venció sin que el comensal llegara |
| `day_of_week` | Día de `created_at` en Bogotá |
| `hour_of_day` | Hora de `created_at` en Bogotá |
| `seconds_to_expire_or_resolve` | Segundos entre `created_at` y el cierre (`cancelled_at`, `expired_at` o `checked_in_at`); vacío mientras sigue activa |

### check_ins.csv

| Columna | Qué es |
|---|---|
| `check_in_id` | UUID del check-in |
| `reservation_id` | UUID de la reserva (`reservations.csv`) |
| `restaurant_id` | UUID del restaurante |
| `checked_in_at` | Cuándo se hizo |
| `day_of_week`, `hour_of_day` | De `checked_in_at`, en hora de Bogotá |

### table_logs.csv

| Columna | Qué es |
|---|---|
| `log_id` | UUID del registro |
| `restaurant_id` | UUID del restaurante dueño de la mesa |
| `table_id` | UUID de la mesa |
| `previous_status`, `new_status` | `available`, `reserved`, `occupied` o `inactive` |
| `source` | `manual` (el restaurante), `reservation` (una microreserva) o `system` (vencimiento automático) |
| `changed_at` | Cuándo ocurrió |
| `actor_type` | Solo el tipo de quien lo hizo: `restaurant_admin`, `diner` o `system` (sin usuario). Nunca el id ni el correo |

## Anonimización

- **No se exporta:** correos, nombres, identificadores de cuenta (Firebase), el id del usuario, el código de la reserva, direcciones, nombres de restaurantes ni coordenadas.
- **El comensal** aparece solo como `diner_pseudonym`: HMAC-SHA256 de su id con una sal aleatoria, truncado a 16 caracteres hexadecimales.
- **La sal es nueva en cada exportación** y no se guarda ni se imprime. El seudónimo es el mismo para un comensal dentro de una exportación, pero **no se puede cruzar con otra exportación ni revertir**. No intenten unir dos exportaciones por seudónimo.
- Los UUID de reserva, restaurante, mesa y registro son internos y no identifican personas.
- Combinar `restaurant_id`, `table_capacity` y horarios sigue permitiendo reconocer *un restaurante*; eso es intencional (la IA necesita el restaurante), pero no revela al comensal.
