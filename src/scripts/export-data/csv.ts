export type CsvValue = string | number | boolean | Date | null | undefined;

// Un campo CSV (RFC 4180): entre comillas si trae coma, comilla o salto de
// línea, y las comillas internas se duplican.
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

// null y undefined salen vacíos; las fechas, en ISO 8601 UTC.
export function formatCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return escapeCsvField(String(value));
}

// Cabecera y filas, separadas por \n y con un \n final. Sin filas, solo la
// cabecera.
export function toCsv(
  header: readonly string[],
  rows: readonly CsvValue[][],
): string {
  const lines = [header, ...rows].map((row) =>
    row.map((value) => formatCsvValue(value)).join(','),
  );
  return `${lines.join('\n')}\n`;
}
