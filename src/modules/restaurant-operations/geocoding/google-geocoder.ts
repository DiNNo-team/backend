import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isInsideBogota, roundCoordinate } from '../shared/bogota-location.js';
import { Geocoder, type GeocodeResult } from './geocoder.js';

export const GOOGLE_GEOCODING_API_KEY = 'GOOGLE_GEOCODING_API_KEY';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const TIMEOUT_MS = 5_000;

// Only the fields we read; Google sends many more.
interface GoogleGeocodeResponse {
  status?: unknown;
  results?: {
    formatted_address?: unknown;
    types?: unknown;
    geometry?: { location?: { lat?: unknown; lng?: unknown } };
  }[];
}

// A result whose types are all in this list is the whole city (or wider),
// not a place in it: Google answers "Bogotá, Colombia" for an address it does
// not understand. A neighborhood or anything more precise is accepted.
// partial_match and location_type are not criteria: measured on 2026-10-26, a
// nonsense address came back with the same shape (partial, ROOFTOP, an
// establishment) as two valid seed addresses (CLAUDE.md §11).
const TOO_GENERAL_TYPES = new Set([
  'locality',
  'political',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'country',
]);

const NOT_FOUND: GeocodeResult = { kind: 'not_found' };
const UNAVAILABLE: GeocodeResult = { kind: 'unavailable' };

// Google Geocoding API adapter. Never throws: every failure is "unavailable".
// The key is optional, so the app boots without it and the endpoint answers
// 503. Logs only Google's status or the error type: never the key, the URL
// (it carries the key) nor the address.
@Injectable()
export class GoogleGeocoder extends Geocoder {
  private readonly logger = new Logger(GoogleGeocoder.name);
  private readonly apiKey: string | null;

  constructor(config: ConfigService) {
    super();
    this.apiKey = config.get<string>(GOOGLE_GEOCODING_API_KEY)?.trim() || null;
  }

  async geocode(address: string): Promise<GeocodeResult> {
    if (!this.apiKey) {
      this.logger.warn(
        `Geocoding unavailable: ${GOOGLE_GEOCODING_API_KEY} is not set`,
      );
      return UNAVAILABLE;
    }

    let body: GoogleGeocodeResponse;
    try {
      const response = await fetch(this.urlFor(address, this.apiKey), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        return this.unavailable(`HTTP ${response.status}`);
      }
      body = (await response.json()) as GoogleGeocodeResponse;
    } catch (error) {
      return this.unavailable(failureType(error));
    }

    return this.toResult(body);
  }

  // URLSearchParams encodes the address: "#", accents and spaces stay inside
  // the address parameter instead of cutting the URL.
  private urlFor(address: string, key: string): string {
    const params = new URLSearchParams({
      address,
      components: 'locality:Bogotá|country:CO',
      language: 'es',
      region: 'co',
      key,
    });
    return `${GEOCODE_URL}?${params.toString()}`;
  }

  private toResult(body: GoogleGeocodeResponse): GeocodeResult {
    if (body?.status === 'ZERO_RESULTS') {
      return NOT_FOUND;
    }
    if (body?.status !== 'OK') {
      return this.unavailable(
        `Google status ${typeof body?.status === 'string' ? body.status : 'missing'}`,
      );
    }

    const first = Array.isArray(body.results) ? body.results[0] : undefined;
    const lat = first?.geometry?.location?.lat;
    const lng = first?.geometry?.location?.lng;
    const formattedAddress = first?.formatted_address;
    const types = first?.types;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      typeof formattedAddress !== 'string' ||
      !isTypeList(types)
    ) {
      return this.unavailable('unexpected response shape');
    }
    if (types.every((type) => TOO_GENERAL_TYPES.has(type))) {
      return NOT_FOUND;
    }

    const point = {
      latitude: roundCoordinate(lat),
      longitude: roundCoordinate(lng),
    };
    // The components filter is only a preference: Google may still answer
    // with a place outside the city.
    if (!isInsideBogota(point)) {
      return NOT_FOUND;
    }
    return { kind: 'found', ...point, formattedAddress };
  }

  private unavailable(reason: string): GeocodeResult {
    this.logger.warn(`Geocoding unavailable: ${reason}`);
    return UNAVAILABLE;
  }
}

// A non-empty list of strings, as Google documents it.
function isTypeList(types: unknown): types is string[] {
  return (
    Array.isArray(types) &&
    types.length > 0 &&
    types.every((type) => typeof type === 'string')
  );
}

// The error type only: an error message could carry the URL, and the URL
// carries the key.
function failureType(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') {
      return 'timeout';
    }
    if (error instanceof SyntaxError) {
      return 'invalid JSON';
    }
    return `network error (${error.name})`;
  }
  return 'unknown error';
}
