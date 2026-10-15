import {
  boundingBox,
  haversineKm,
  roundKm,
  type BoundingBox,
  type GeoPoint,
} from './geo.js';

const CASA_72: GeoPoint = { latitude: 4.655671, longitude: -74.057006 };
const PARQUE_93: GeoPoint = { latitude: 4.6766, longitude: -74.0486 };

// Point at distanceKm from start along bearing (degrees from north), on the
// same sphere: an independent check of the box, not a copy of its formula.
function destination(
  start: GeoPoint,
  bearingDeg: number,
  distanceKm: number,
): GeoPoint {
  const R = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  const deg = (r: number) => (r * 180) / Math.PI;
  const δ = distanceKm / R;
  const θ = rad(bearingDeg);
  const φ1 = rad(start.latitude);
  const λ1 = rad(start.longitude);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { latitude: deg(φ2), longitude: deg(λ2) };
}

function contains(box: BoundingBox, point: GeoPoint): boolean {
  return (
    point.latitude >= box.minLat &&
    point.latitude <= box.maxLat &&
    point.longitude >= box.minLng &&
    point.longitude <= box.maxLng
  );
}

describe('haversineKm', () => {
  it('is 0 for the same point', () => {
    expect(haversineKm(CASA_72, CASA_72)).toBe(0);
  });

  it('measures Casa 72 to Parque 93 as about 2.5 km', () => {
    expect(haversineKm(CASA_72, PARQUE_93)).toBeCloseTo(2.5, 1);
    expect(Math.abs(haversineKm(CASA_72, PARQUE_93) - 2.5)).toBeLessThan(0.1);
  });

  it('is symmetric', () => {
    expect(haversineKm(PARQUE_93, CASA_72)).toBe(
      haversineKm(CASA_72, PARQUE_93),
    );
  });
});

describe('boundingBox', () => {
  it.each([1, 2, 5, 10])(
    'contains the edge of a %i km circle in the 4 directions and the diagonals',
    (radiusKm) => {
      const box = boundingBox(CASA_72, radiusKm);
      // A hair inside the circle, so floating-point noise does not decide.
      const edge = radiusKm * (1 - 1e-9);
      for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const point = destination(CASA_72, bearing, edge);
        expect(haversineKm(CASA_72, point)).toBeCloseTo(edge, 6);
        expect(contains(box, point)).toBe(true);
      }
    },
  );

  it('is tight: a point just outside the circle to the north is outside the box', () => {
    const box = boundingBox(CASA_72, 2);
    expect(contains(box, destination(CASA_72, 0, 2.01))).toBe(false);
  });

  it('is centred on the point', () => {
    const box = boundingBox(CASA_72, 2);
    expect((box.minLat + box.maxLat) / 2).toBeCloseTo(CASA_72.latitude, 9);
    expect((box.minLng + box.maxLng) / 2).toBeCloseTo(CASA_72.longitude, 9);
  });

  it('is larger with a larger radius', () => {
    const small = boundingBox(CASA_72, 1);
    const large = boundingBox(CASA_72, 5);
    expect(large.minLat).toBeLessThan(small.minLat);
    expect(large.maxLat).toBeGreaterThan(small.maxLat);
    expect(large.minLng).toBeLessThan(small.minLng);
    expect(large.maxLng).toBeGreaterThan(small.maxLng);
  });

  it('stays finite near a pole', () => {
    const box = boundingBox({ latitude: 89.99, longitude: 0 }, 10);
    expect(box.minLng).toBe(-180);
    expect(box.maxLng).toBe(180);
  });
});

describe('roundKm', () => {
  it.each([
    [0, 0],
    [0.654, 0.65],
    [0.655001, 0.66],
    [2.50674, 2.51],
  ])('rounds %f km to %f', (km, rounded) => {
    expect(roundKm(km)).toBe(rounded);
  });
});
