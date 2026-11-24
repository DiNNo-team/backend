import {
  BOGOTA_BOUNDS,
  isInsideBogota,
  roundCoordinate,
} from './bogota-location.js';

// Calle 72 con Carrera 9 (Casa 72 in the seed).
const CASA_72 = { latitude: 4.655671, longitude: -74.057006 };

describe('isInsideBogota', () => {
  it('accepts a point in Chapinero', () => {
    expect(isInsideBogota(CASA_72)).toBe(true);
  });

  it.each([
    [
      'south-west corner',
      BOGOTA_BOUNDS.minLatitude,
      BOGOTA_BOUNDS.minLongitude,
    ],
    [
      'north-east corner',
      BOGOTA_BOUNDS.maxLatitude,
      BOGOTA_BOUNDS.maxLongitude,
    ],
    ['south edge', 4.45, -74.05],
    ['north edge', 4.85, -74.05],
    ['west edge', 4.65, -74.25],
    ['east edge', 4.65, -73.95],
  ])('includes the exact edge (%s)', (_case, latitude, longitude) => {
    expect(isInsideBogota({ latitude, longitude })).toBe(true);
  });

  it.each([
    ['south', 4.449999, -74.05],
    ['north', 4.850001, -74.05],
    ['west', 4.65, -74.250001],
    ['east', 4.65, -73.949999],
  ])(
    'rejects a point just outside, to the %s',
    (_case, latitude, longitude) => {
      expect(isInsideBogota({ latitude, longitude })).toBe(false);
    },
  );

  it('rejects Medellín', () => {
    expect(isInsideBogota({ latitude: 6.244203, longitude: -75.581212 })).toBe(
      false,
    );
  });
});

describe('roundCoordinate', () => {
  it.each([
    [4.65567149, 4.655671],
    [4.65567151, 4.655672],
    [-74.05700649, -74.057006],
    [-74.05700651, -74.057007],
    [4.65, 4.65],
  ])('rounds %d to 6 decimals (%d)', (value, rounded) => {
    expect(roundCoordinate(value)).toBe(rounded);
  });
});
