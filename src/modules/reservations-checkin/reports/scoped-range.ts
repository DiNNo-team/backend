import type { ReportPeriod } from './report-period.js';

// El WHERE de un rango de fechas, de un restaurante o de toda la plataforma.
// Con restaurante, el texto y los parámetros son los de siempre ($1 =
// restaurant_id, $2 y $3 = el rango), así las consultas del restaurante no
// cambian y siguen usando su índice (restaurant_id, columna). Sin restaurante,
// solo el rango ($1 y $2), que usa el índice de la columna sola. No se usa
// "$1 IS NULL OR ...": cada alcance tiene su propia consulta.
export type ScopedColumn = 'checked_in_at' | 'created_at';

export interface ScopedRange {
  where: string;
  params: unknown[];
}

export function scopedRange(
  column: ScopedColumn,
  period: Pick<ReportPeriod, 'startsAt' | 'endsBefore'>,
  restaurantId?: string,
): ScopedRange {
  return restaurantId === undefined
    ? {
        where: `"${column}" >= $1 AND "${column}" < $2`,
        params: [period.startsAt, period.endsBefore],
      }
    : {
        where: `"restaurant_id" = $1 AND "${column}" >= $2 AND "${column}" < $3`,
        params: [restaurantId, period.startsAt, period.endsBefore],
      };
}
