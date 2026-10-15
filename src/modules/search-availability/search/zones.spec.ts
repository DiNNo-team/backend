import { listZones, ZONE_IDS, ZONES, zoneCenter } from './zones.js';

// Bogotá bounds of the contract (CLAUDE.md, section 10).
const inBogota = (lat: number, lng: number) =>
  lat >= 4.45 && lat <= 4.85 && lng >= -74.25 && lng <= -73.95;

describe('zones', () => {
  it('are the 20 zones of the contract, without repeated ids', () => {
    expect(ZONES).toHaveLength(20);
    expect(new Set(ZONE_IDS).size).toBe(20);
  });

  it('all lie inside Bogotá', () => {
    for (const zone of ZONES) {
      expect(inBogota(zone.latitude, zone.longitude)).toBe(true);
    }
  });

  it('are listed by name, Spanish order', () => {
    const names = listZones().map((zone) => zone.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'es')));
    expect(names.indexOf('Chicó')).toBeLessThan(names.indexOf('Colina'));
    expect(names[0]).toBe('Calle 72');
    expect(names.at(-1)).toBe('Zona T');
  });

  it('listing does not reorder the constant', () => {
    listZones();
    expect(ZONES[0].id).toBe('calle-72');
  });

  it('gives the centre of a zone', () => {
    expect(zoneCenter('kennedy')).toEqual({
      latitude: 4.628,
      longitude: -74.153,
    });
  });
});
