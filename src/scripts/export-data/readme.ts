import {
  CHECK_IN_COLUMNS,
  type ColumnSpec,
  RESERVATION_COLUMNS,
  TABLE_LOG_COLUMNS,
} from './columns.js';

export interface ExportCounts {
  reservations: number;
  checkIns: number;
  tableLogs: number;
}

function dictionary(title: string, columns: readonly ColumnSpec[]): string {
  const lines = columns.map(
    (column) => `- \`${column.name}\`: ${column.description}`,
  );
  return `### ${title}\n\n${lines.join('\n')}`;
}

// LEEME.md de la carpeta exportada. No lleva ningún dato de la base, solo
// conteos y el diccionario.
export function buildReadme(generatedAt: Date, counts: ExportCounts): string {
  return `# Exportación anónima de datos · DiNNo

Generada el ${generatedAt.toISOString()} (UTC). Para Santiago y Sergio (definición de la IA).

| Archivo | Filas |
|---|---|
| reservations.csv | ${counts.reservations} |
| check_ins.csv | ${counts.checkIns} |
| table_logs.csv | ${counts.tableLogs} |

## Formato

- CSV en UTF-8, con cabecera, separado por comas, saltos de línea \`\\n\`.
- Los campos con coma, comillas o saltos de línea van entre comillas (las comillas internas se duplican).
- Campo vacío = no aplica (por ejemplo, \`cancelled_at\` de una reserva que no se canceló).
- Fechas en ISO 8601 UTC. \`day_of_week\` y \`hour_of_day\` están en hora de Bogotá (1 = lunes ... 7 = domingo; hora de 0 a 23).

## Anonimización

- **No se exporta:** correos, nombres, identificadores de cuenta (Firebase), el id del usuario, el código de la reserva, direcciones, nombres de restaurantes ni coordenadas.
- **El comensal** aparece solo como \`diner_pseudonym\`: HMAC-SHA256 de su id con una sal aleatoria, truncado a 16 caracteres hexadecimales.
- **La sal es nueva en cada exportación** y no se guarda ni se imprime. Por eso el seudónimo es el mismo para un comensal dentro de esta exportación (sirve para agrupar sus reservas), pero **no se puede cruzar con otra exportación ni revertir**.
- **La bitácora** solo dice el tipo de quien hizo el cambio (\`actor_type\`), nunca quién.
- Los ids de reserva, restaurante, mesa y registro son UUID internos que no identifican personas.

## Diccionario de columnas

${dictionary('reservations.csv', RESERVATION_COLUMNS)}

${dictionary('check_ins.csv', CHECK_IN_COLUMNS)}

${dictionary('table_logs.csv', TABLE_LOG_COLUMNS)}
`;
}
