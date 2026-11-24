// Geometry of the search, pure (no Nest, no database). The exact distance is
// computed here and not in SQL so it can be tested without a database; the
// database only does the cheap bounding-box prefilter (CLAUDE.md, section 11).

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Mean Earth radius (IUGG).
const EARTH_RADIUS_KM = 6371.0088;
// Length of one degree of latitude on that same sphere (~111.195 km); one
// degree of longitude is this times cos(latitude). It must come from the
// radius haversineKm uses: the usual 111.32 km is longer, and a box built
// with it leaves out the edge of the circle (a 10 km box would stop at 9.99 km).
const KM_PER_DEGREE = (EARTH_RADIUS_KM * Math.PI) / 180;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// Great-circle distance in km (haversine, asin form).
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) *
      Math.cos(toRadians(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  // min(1, ...) guards against rounding just above 1 for antipodal points.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Rectangle that contains the whole circle of radiusKm around center. It is a
// prefilter only: its corners are farther than radiusKm, so the caller still
// filters by haversineKm. The longitude span uses the cosine of the latitude
// edge closest to a pole, where a degree of longitude is shortest, so the
// circle never sticks out of the box. It does not wrap around the
// antimeridian: restaurants are always inside Bogotá.
export function boundingBox(center: GeoPoint, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / KM_PER_DEGREE;
  const widestLat = Math.min(90, Math.abs(center.latitude) + latDelta);
  const cosLat = Math.cos(toRadians(widestLat));
  const lngDelta =
    cosLat > 1e-9 ? Math.min(180, radiusKm / (KM_PER_DEGREE * cosLat)) : 180;
  return {
    minLat: center.latitude - latDelta,
    maxLat: center.latitude + latDelta,
    minLng: center.longitude - lngDelta,
    maxLng: center.longitude + lngDelta,
  };
}

// distanceKm of the contract: km with 2 decimals.
export function roundKm(distanceKm: number): number {
  return Math.round(distanceKm * 100) / 100;
}
