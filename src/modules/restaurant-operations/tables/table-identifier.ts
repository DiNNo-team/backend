// Single source of the table identifier rules, shared by create and edit.
// Mirrors the web (frontend src/lib/format.ts): "4", "04" and "Mesa 4" are the
// same table, shown as "Mesa 04" (identity manual 14.1: two digits if numeric).

export const TABLE_IDENTIFIER_MAX_LENGTH = 10;

const NUMERIC = /^\d+$/;
const TABLE_WORD = /^mesa\s+/i;

// The identifier without a leading "Mesa": older rows store the full name.
function identifierCore(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.replace(TABLE_WORD, '').trim() || trimmed;
}

// Key to detect repeated identifiers within a restaurant.
export function normalizeTableIdentifier(identifier: string): string {
  const core = identifierCore(identifier);
  return NUMERIC.test(core) ? String(Number(core)) : core.toLowerCase();
}

// Display name used in messages: "4" → "Mesa 04", "T1" → "Mesa T1". An
// identifier that is only "Mesa" is shown as "Mesa", not "Mesa Mesa".
export function formatTableName(identifier: string): string {
  const core = identifierCore(identifier);
  if (core.toLowerCase() === 'mesa') {
    return 'Mesa';
  }
  return NUMERIC.test(core)
    ? `Mesa ${String(Number(core)).padStart(2, '0')}`
    : `Mesa ${core}`;
}

// User-facing texts: the same ones the web shows (sprint plan, section 10).
export const IDENTIFIER_REQUIRED = 'Escribe el identificador de la mesa.';
export const IDENTIFIER_TOO_LONG = `Usa máximo ${TABLE_IDENTIFIER_MAX_LENGTH} caracteres en el identificador de la mesa.`;
export const IDENTIFIER_INVISIBLE_CHARACTERS =
  'El identificador no puede incluir caracteres invisibles.';
export const identifierTakenMessage = (identifier: string): string =>
  `Ya tienes una ${formatTableName(identifier)}. Usa otro identificador.`;
