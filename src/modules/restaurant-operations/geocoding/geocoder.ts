// What a geocoding provider answers for an address. A discriminated union, not
// exceptions: the adapter never throws, and only the controller turns each
// outcome into HTTP.
export type GeocodeResult =
  | {
      kind: 'found';
      // Inside Bogotá and rounded to 6 decimals.
      latitude: number;
      longitude: number;
      formattedAddress: string;
    }
  // The provider has no result inside Bogotá for the address.
  | { kind: 'not_found' }
  // No API key, quota exhausted, provider error, network error or timeout.
  | { kind: 'unavailable' };

// Port owned by geocoding/. The real implementation is GoogleGeocoder, wired
// by the useClass line in the module; the tests replace it with a fake.
export abstract class Geocoder {
  abstract geocode(address: string): Promise<GeocodeResult>;
}
