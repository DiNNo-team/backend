# Prototipo de IA · Informe inteligente del restaurante

**Sprint 3 · PBI 6.1 · Tarea 6.1.4.** Prototipo del caso elegido en [`docs/ia-diseno.md`](../docs/ia-diseno.md): **informe para el restaurante con métricas de confiabilidad (opciones A + E)**.

Lee una exportación anónima de `npm run export:data` (ver [`docs/export-datos.md`](../docs/export-datos.md)), calcula métricas por restaurante y escribe un informe en texto con recomendaciones.

**Es independiente del backend:**
- no importa nada de `src/`;
- no se conecta a la base, al backend ni a la app;
- no toca `package.json`.

La IA del producto se construye en el Sprint 4. Esto es solo para validar las métricas, las reglas y el texto.

## Qué hace

1. **Entrada:** una carpeta con `reservations.csv`, `check_ins.csv` y `table_logs.csv`, con las columnas exactas de `docs/export-datos.md`. Si falta un archivo o una columna, se detiene y dice cuál.
2. **Métricas por restaurante** (`metrics.py`), sobre todos los días de la exportación (hora de Bogotá):
   - reservas creadas, por día de la semana, por fecha y las 3 franjas (día y hora) con más reservas;
   - tasa de check-in, de vencidas sin check-in (no-show) y de cancelación, sobre las reservas **resueltas** (`completed`, `cancelled` o `expired`; las `active` no cuentan);
   - tiempo promedio hasta resolverse (`seconds_to_expire_or_resolve`), en total y por estado final;
   - check-ins facturables (`check_ins.csv`);
   - cambios manuales de mesas (`source = manual`): total, por día y días sin ninguno;
   - **confiabilidad de la disponibilidad** (alta, media o baja) con sus motivos (sección 5 del diseño).
3. **Texto de recomendaciones** (`narrative.py`):
   - **Por defecto, plantillas y reglas simples** (el respaldo sin IA, sección 9 del diseño).
   - **Opcional:** si existe `INSIGHTS_LLM_API_KEY`, un modelo de lenguaje redacta el texto con **solo las métricas agregadas**.
4. **Salida:** en la carpeta `--output`, un `informe-<restaurant_id>.txt` por restaurante y `metricas.json` con todas las métricas.

Con menos de 10 reservas resueltas (`--min-resolved`, umbral **por confirmar** con el piloto), el informe no calcula tasas ni el indicador: muestra solo conteos y el aviso de datos insuficientes.

## Archivos

| Archivo | Qué es |
|---|---|
| `generate_synthetic.py` | Genera CSV sintéticos con el formato exacto de `export:data` |
| `report.py` | Lee la carpeta, calcula y escribe los informes |
| `metrics.py` | Lectura, validación de columnas, métricas e indicador de confiabilidad |
| `narrative.py` | Plantillas y llamada opcional al modelo, con validación del texto |
| `export_columns.py` | Columnas de los CSV (copia de `src/scripts/export-data/columns.ts`), categorías y días |
| `requirements.txt` | Dependencias con versión fija |

## Requisitos

- **Python 3.11 o más reciente** (lo exige pandas 3). Revísalo con `python3 --version`.
  - En Mac, el `python3` que trae el sistema puede ser 3.9. Si es menor que 3.11: `brew install python@3.12` y usa `python3.12` en los pasos de abajo.
- No hace falta Node, la base ni el backend.

## Crear el entorno virtual

Desde la carpeta `ai-prototype/`:

```bash
# macOS o Linux
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

```powershell
# Windows (PowerShell)
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

`.venv/` está en el `.gitignore` de esta carpeta. Para salir del entorno: `deactivate`.

## Correrlo con datos sintéticos

```bash
python generate_synthetic.py --output datos-sinteticos
python report.py --input datos-sinteticos --output informes
```

`generate_synthetic.py` crea 3 restaurantes ficticios durante 14 días (desde el 26 oct 2026, hora de Bogotá):

| Restaurante | Comportamiento | Qué debe mostrar el informe |
|---|---|---|
| Colombiano | Valida casi todos los códigos y actualiza sus mesas a diario | Confiabilidad **Alta** |
| Italiano | Muchas reservas vencidas sin check-in y casi sin cambios manuales | Confiabilidad **Baja** |
| Cafetería | Restaurante nuevo, muy pocas reservas | **Sin datos suficientes** |

Opciones: `--days` (por defecto 14), `--start` (AAAA-MM-DD) y `--seed` (por defecto 42; la misma semilla da los mismos CSV).

## Correrlo con el CSV de Elizabeth

1. Pídele la exportación a Elizabeth (`npm run export:data`; la corre ella). Llega como una carpeta `exports/<fecha-hora>/` con los tres CSV y un `LEEME.md`.
2. Cópiala dentro de `ai-prototype/`, en una carpeta que empiece por `datos-` (por ejemplo `datos-reales/`). El `.gitignore` excluye `datos-*/`, `exports/` y todos los `*.csv`.
3. Corre:

   ```bash
   python report.py --input datos-reales --output informes
   ```

4. **Antes de cualquier commit, revisa `git status`:** no debe aparecer ningún CSV ni nada de `informes/`.

Los datos del piloto de la demo se exportan después de la demo. El seudónimo del comensal cambia en cada exportación: no se pueden unir dos exportaciones por ese campo (el prototipo no lo usa).

## Texto con un modelo de lenguaje (opcional)

Sin llave, todo funciona igual con plantillas.

> **Estado de las pruebas:** esta ruta solo se probó con un servidor simulado que imita la API (respuesta válida, texto con un número inventado y error 500), nunca con el modelo real. Queda pendiente probarla con el proveedor que se elija en el Sprint 4: que la API acepte la petición, la calidad del texto, el costo por informe y cuántas veces la validación lo descarta.

Para probar el texto redactado por un modelo:

```bash
read -s INSIGHTS_LLM_API_KEY && export INSIGHTS_LLM_API_KEY   # pega la llave y Enter: no se ve ni queda en el historial
python report.py --input datos-sinteticos --output informes
unset INSIGHTS_LLM_API_KEY
```

- **Nunca** escribas la llave en un archivo del repo, en un commit, en el grupo ni en una captura.
- **Proveedor (decisión del equipo):** Claude (Anthropic), con el SDK oficial `anthropic`.
- **Modelo:**
  - Por defecto, **Claude Haiku 5.5** (`claude-haiku-5-5`).
  - Alternativa si la calidad del texto no alcanza, **Claude Sonnet 5.5**: `export INSIGHTS_LLM_MODEL=claude-sonnet-5-5` (o `INSIGHTS_LLM_MODEL=claude-sonnet-5-5 python report.py …` para una sola corrida).
  - Los dos se piden con esfuerzo bajo (`effort: low`), porque el texto es corto, y `max_tokens` de 16 000.
- **Respaldo ante negativas (`fallbacks: "default"`):** solo para los modelos que lo soportan, como Claude Sonnet 5.5. **Claude Haiku 5.5 no tiene respaldo del servidor:** con él no se envían ni `fallbacks` ni la cabecera `server-side-fallback`. Si el modelo se niega a responder (`stop_reason: refusal`), se usa la plantilla.
- **Qué se envía:** solo el objeto de métricas agregadas (conteos, porcentajes, franjas, días y el nivel de confiabilidad). Nunca el id, el nombre o la dirección del restaurante, ni datos de comensales.
- **Validación (sección 6.3 del diseño).** El texto del modelo se descarta y se usa la plantilla si:
  - llega vacío;
  - pasa de 600 caracteres;
  - menciona un número que no está en las métricas;
  - el modelo no termina normalmente.

  El motivo queda escrito en el informe («Nota: se usó la plantilla porque…»).
- **Fallas del modelo:** un error de red, un 429 o un 5xx también llevan a la plantilla. El informe nunca falla por la IA.

### Comparar Haiku y Sonnet con los mismos datos

La misma semilla genera los mismos datos sintéticos, así que la única diferencia entre las dos carpetas es el modelo:

```bash
python generate_synthetic.py --output datos-sinteticos
read -s INSIGHTS_LLM_API_KEY && export INSIGHTS_LLM_API_KEY
python report.py --input datos-sinteticos --output informes-haiku
INSIGHTS_LLM_MODEL=claude-sonnet-5-5 python report.py --input datos-sinteticos --output informes-sonnet
unset INSIGHTS_LLM_API_KEY
diff informes-haiku informes-sonnet
```

- Compara solo la sección «Recomendaciones» de cada informe: las métricas son iguales en las dos carpetas.
- Revisa si dice «(generado automáticamente por un modelo de lenguaje)» o «(plantilla)» con su «Nota»: una nota indica que el texto del modelo se descartó y por qué.
- **Cada corrida hace llamadas reales y cuesta dinero:** una llamada por restaurante con datos suficientes (2 con los datos sintéticos). Los precios están en la sección 10 de `docs/ia-diseno.md`.
- `informes-haiku/` e `informes-sonnet/` están en el `.gitignore`.

## Ejemplo

**Entrada** (`reservations.csv`, primeras filas, datos sintéticos):

```csv
reservation_id,diner_pseudonym,restaurant_id,restaurant_category,table_capacity,party_size,status,created_at,expires_at,expired_at,cancelled_at,checked_in_at,no_show,day_of_week,hour_of_day,seconds_to_expire_or_resolve
d4ea120a-5e65-4654-8e90-58b609a0a0f6,1a2a73ed562b0f79,eb7607c9-b08a-4895-94ff-a66675c8e90d,italian,6,5,completed,2026-10-26T17:22:32.075Z,2026-10-26T17:37:32.075Z,,,2026-10-26T17:26:04.075Z,false,1,12,212
80599b93-79c2-42e4-9ae1-a991524f93ff,47229389571aa876,eb7607c9-b08a-4895-94ff-a66675c8e90d,italian,2,2,expired,2026-10-26T17:28:58.829Z,2026-10-26T17:43:58.829Z,2026-10-26T17:44:01.829Z,,,true,1,12,903
```

**Salida** (`informes/informe-eb7607c9-….txt`, restaurante italiano, sin llave; se omiten las fechas):

```text
Informe de DiNNo · restaurante eb7607c9-b08a-4895-94ff-a66675c8e90d (Italiana)
Periodo: 26 oct 2026 a 8 nov 2026 (14 días, hora de Bogotá)

Métricas
- Reservas creadas: 52 (resueltas: 51; activas al exportar: 1)
- Con check-in: 13 de 51 (25 %)
- Vencieron sin check-in: 25 de 51 (49 %)
- Canceladas: 13 de 51 (25 %)
- Tiempo promedio hasta resolverse: 10,8 min (check-in: 7,4 min; cancelación: 6,0 min; vencimiento: 15,1 min)
- Check-ins facturables (check_ins.csv): 13
- Cambios manuales de mesas: 8 (0,6 por día; 12 de 14 días sin cambios)

Reservas por día de la semana
  lunes 8 · martes 5 · miércoles 8 · jueves 3 · viernes 9 · sábado 9 · domingo 10

Franjas con más reservas
  1. lunes 12:00 (3)
  2. viernes 20:00 (3)
  3. sábado 14:00 (3)

Confiabilidad de la disponibilidad: Baja
  - Tasa de check-in del 25 %
  - Cambios manuales de mesas en 2 de 14 días

Recomendaciones
  (plantilla)
  El 49 % de tus reservas resueltas venció sin check-in (25 de 51). Revisa si validas el código cuando llega el comensal: si no lo validas, la reserva cuenta como vencida. No actualizaste tus mesas a mano en 12 de 14 días. Márcalas como Ocupada o Disponible cuando cambien, para que los comensales vean tu disponibilidad real. El 25 % de tus reservas resueltas se canceló (13 de 51). Revisa en la bitácora a qué horas pasa.
```

## Limitaciones conocidas (frente al diseño)

- **«Días abiertos» (sección 5 del diseño):** la exportación no trae el historial de Abierto/Cerrado ni los horarios, así que el indicador cuenta los días del periodo completo.
- **Periodo:** el prototipo usa todos los días de la exportación. El diseño propone los últimos 7 días comparados con los 7 anteriores.
- **Uso por tamaño de mesa:** no se calcula, porque la exportación no trae cuántas mesas activas tiene cada restaurante. «Mesa más grande de lo necesario» sí se podría calcular (`reservations.csv` trae `table_capacity` y `party_size`), pero no está en este prototipo.
- **`no_show`:** una reserva vencida sin check-in no prueba que el comensal no llegó (puede que el restaurante no validó el código). Por eso el informe dice «vencieron sin check-in».
- **`source = system`** lo escriben el vencimiento automático y `demo:reset`. El no-show se cuenta desde `reservations.csv`, no desde la bitácora.
- **Datos de prueba y de la demo** están en la misma base que los reales. Cómo excluirlos está por confirmar (sección 15, punto 5).
