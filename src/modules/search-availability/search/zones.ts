import type { GeoPoint } from './geo.js';

// Search zones of the Sprint 2 contract (CLAUDE.md, section 10). Closed list:
// the diner picks one instead of sharing the location. The coordinates are an
// approximate centre of each zone.
export const ZONES = [
  { id: 'calle-72', name: 'Calle 72', latitude: 4.6557, longitude: -74.057 },
  { id: 'cedritos', name: 'Cedritos', latitude: 4.724, longitude: -74.043 },
  { id: 'centro', name: 'Centro', latitude: 4.605, longitude: -74.072 },
  { id: 'chapinero', name: 'Chapinero', latitude: 4.645, longitude: -74.063 },
  { id: 'chico', name: 'Chicó', latitude: 4.681, longitude: -74.045 },
  { id: 'colina', name: 'Colina', latitude: 4.734, longitude: -74.064 },
  { id: 'galerias', name: 'Galerías', latitude: 4.642, longitude: -74.077 },
  { id: 'kennedy', name: 'Kennedy', latitude: 4.628, longitude: -74.153 },
  {
    id: 'la-candelaria',
    name: 'La Candelaria',
    latitude: 4.5965,
    longitude: -74.0735,
  },
  { id: 'modelia', name: 'Modelia', latitude: 4.67, longitude: -74.121 },
  { id: 'niza', name: 'Niza', latitude: 4.711, longitude: -74.071 },
  { id: 'normandia', name: 'Normandía', latitude: 4.664, longitude: -74.108 },
  { id: 'parque-93', name: 'Parque 93', latitude: 4.6766, longitude: -74.0486 },
  {
    id: 'quinta-camacho',
    name: 'Quinta Camacho',
    latitude: 4.653,
    longitude: -74.06,
  },
  { id: 'salitre', name: 'Salitre', latitude: 4.648, longitude: -74.103 },
  { id: 'suba', name: 'Suba', latitude: 4.741, longitude: -74.084 },
  {
    id: 'teusaquillo',
    name: 'Teusaquillo',
    latitude: 4.629,
    longitude: -74.074,
  },
  { id: 'usaquen', name: 'Usaquén', latitude: 4.695, longitude: -74.031 },
  { id: 'zona-g', name: 'Zona G', latitude: 4.6545, longitude: -74.0545 },
  { id: 'zona-t', name: 'Zona T', latitude: 4.667, longitude: -74.053 },
] as const;

export type Zone = (typeof ZONES)[number];
export type ZoneId = Zone['id'];

export const ZONE_IDS: readonly ZoneId[] = ZONES.map((zone) => zone.id);

// What GET /v1/search/zones answers: sorted by name as a Spanish reader
// expects ("Chicó" before "Colina").
export function listZones(): Zone[] {
  return [...ZONES].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function zoneCenter(id: ZoneId): GeoPoint {
  const zone = ZONES.find((candidate) => candidate.id === id);
  if (!zone) {
    // Unreachable: the query DTO only lets ZONE_IDS through.
    throw new Error(`Unknown zone: ${id}`);
  }
  return { latitude: zone.latitude, longitude: zone.longitude };
}
