// Single source of the zone rules and texts, shared by the DTOs and the
// service. The web mirrors them in features/tables/areas/area-form.ts.

export const AREA_NAME_MAX_LENGTH = 30;
// Enough for a restaurant with several floors, each with a few rooms.
export const AREAS_PER_RESTAURANT_MAX = 20;

export const AREA_NAME_REQUIRED = 'Escribe el nombre de la zona.';
export const AREA_NAME_TOO_LONG = `Usa máximo ${AREA_NAME_MAX_LENGTH} caracteres en el nombre de la zona.`;
export const AREA_NAME_INVISIBLE_CHARACTERS =
  'El nombre de la zona no puede incluir caracteres invisibles.';
export const AREA_ID_INVALID =
  'La zona no es válida. Actualiza la página e intenta de nuevo.';
// Same text for a missing zone and another restaurant's zone.
export const AREA_NOT_FOUND_MESSAGE =
  'No encontramos esta zona. Actualiza la página e intenta de nuevo.';
export const AREAS_LIMIT_MESSAGE = `Puedes tener máximo ${AREAS_PER_RESTAURANT_MAX} zonas.`;
export const areaNameTakenMessage = (name: string): string =>
  `Ya tienes una zona llamada «${name.trim()}». Usa otro nombre.`;

// Key to detect repeated names: "Terraza", " terraza " and "TERRAZA" are the
// same zone (the unique index is on lower(trim(name))).
export function normalizeAreaName(name: string): string {
  return name.trim().toLowerCase();
}
