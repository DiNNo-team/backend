// Where a restaurant can be (Sprint 2 contract, "Reglas de los campos"). Single
// source of the bounds: the restaurant coordinates DTO and the geocoder use
// them, so a number here is never repeated anywhere else.
export const BOGOTA_BOUNDS = {
  minLatitude: 4.45,
  maxLatitude: 4.85,
  minLongitude: -74.25,
  maxLongitude: -73.95,
} as const;

// Decimals stored in restaurants.latitude and longitude, numeric(9,6).
export const COORDINATE_DECIMALS = 6;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

// Bounds included: a point exactly on the edge is inside.
export function isInsideBogota({ latitude, longitude }: Coordinates): boolean {
  return (
    latitude >= BOGOTA_BOUNDS.minLatitude &&
    latitude <= BOGOTA_BOUNDS.maxLatitude &&
    longitude >= BOGOTA_BOUNDS.minLongitude &&
    longitude <= BOGOTA_BOUNDS.maxLongitude
  );
}

// Rounds like the column does, so the API answers what the database keeps.
export function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}
