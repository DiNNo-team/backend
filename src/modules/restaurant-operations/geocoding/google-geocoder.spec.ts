import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoogleGeocoder } from './google-geocoder.js';

// Fake key, easy to find in anything the adapter logs or returns.
const FAKE_KEY = 'FAKE-KEY-do-not-leak-1234';
const ADDRESS = 'Cra. 11 #72-30, Bogotá';

function configWith(key: string | undefined) {
  return { get: () => key } as unknown as ConfigService;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function okBody(
  lat: number,
  lng: number,
  formattedAddress = ADDRESS,
  types: unknown = ['street_address'],
) {
  return {
    status: 'OK',
    results: [
      {
        formatted_address: formattedAddress,
        types,
        geometry: { location: { lat, lng } },
      },
      {
        formatted_address: 'Otro resultado',
        types: ['street_address'],
        geometry: { location: { lat: 4.7, lng: -74.1 } },
      },
    ],
  };
}

describe('GoogleGeocoder', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logged: unknown[][];

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args) => {
        logged.push(args);
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // No default parameter: undefined must reach the config as "no key".
  const geocoder = (...key: [string | undefined] | []) =>
    new GoogleGeocoder(configWith(key.length === 0 ? FAKE_KEY : key[0]));

  function requestedUrl(): URL {
    return new URL(fetchMock.mock.calls[0][0] as string);
  }

  it('returns the first result, rounded to 6 decimals, with its formatted address', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        okBody(4.65567149, -74.05700651, 'Cra. 11 #72-30, Bogotá, Colombia'),
      ),
    );

    await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
      kind: 'found',
      latitude: 4.655671,
      longitude: -74.057007,
      formattedAddress: 'Cra. 11 #72-30, Bogotá, Colombia',
    });
    expect(logged).toEqual([]);
  });

  it('builds the URL with the address encoded, the Bogotá components, the language and the region', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody(4.65, -74.05)));

    await geocoder().geocode(ADDRESS);

    const raw = fetchMock.mock.calls[0][0] as string;
    const url = requestedUrl();
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://maps.googleapis.com/maps/api/geocode/json',
    );
    // The "#" is encoded: it does not start a fragment that would drop the
    // rest of the parameters.
    expect(raw).toContain('%2372-30');
    expect(url.hash).toBe('');
    expect(url.searchParams.get('address')).toBe(ADDRESS);
    expect(url.searchParams.get('components')).toBe(
      'locality:Bogotá|country:CO',
    );
    expect(url.searchParams.get('language')).toBe('es');
    expect(url.searchParams.get('region')).toBe('co');
    expect(url.searchParams.get('key')).toBe(FAKE_KEY);
  });

  it('passes a timeout signal to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody(4.65, -74.05)));

    await geocoder().geocode(ADDRESS);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['Medellín', 6.244203, -75.581212],
    ['just south of the bounds', 4.449999, -74.05],
  ])(
    'answers not found for an OK result outside Bogotá (%s)',
    async (_case, lat, lng) => {
      fetchMock.mockResolvedValue(jsonResponse(okBody(lat, lng)));

      await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
        kind: 'not_found',
      });
    },
  );

  describe('how precise the first result is (its types)', () => {
    it('answers not found for the whole city ("Bogotá, Colombia")', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          okBody(4.710989, -74.07209, 'Bogotá, Colombia', [
            'locality',
            'political',
          ]),
        ),
      );

      await expect(geocoder().geocode('asdfgh')).resolves.toEqual({
        kind: 'not_found',
      });
      expect(logged).toEqual([]);
    });

    it('answers not found for a department or wider', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          okBody(4.6, -74.08, 'Bogotá, Colombia', [
            'administrative_area_level_1',
            'political',
          ]),
        ),
      );

      await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
        kind: 'not_found',
      });
    });

    it.each([
      ['a neighborhood', ['neighborhood', 'political']],
      ['a sublocality', ['political', 'sublocality', 'sublocality_level_1']],
      ['a street address', ['street_address']],
      ['a route', ['route']],
      [
        'an establishment',
        ['establishment', 'point_of_interest', 'restaurant'],
      ],
    ])('accepts %s', async (_case, types) => {
      fetchMock.mockResolvedValue(
        jsonResponse(okBody(4.655671, -74.057006, 'Chapinero', types)),
      );

      await expect(geocoder().geocode(ADDRESS)).resolves.toMatchObject({
        kind: 'found',
        latitude: 4.655671,
      });
    });

    it.each([
      ['missing', undefined],
      ['empty', []],
      ['not a list', 'locality'],
      ['a list with a non-string', ['route', 42]],
    ])(
      'answers unavailable (unexpected shape) when types is %s',
      async (_case, types) => {
        const body = okBody(4.655671, -74.057006, ADDRESS, types);
        // undefined would take okBody's default: remove the property instead.
        if (types === undefined) {
          Reflect.deleteProperty(body.results[0], 'types');
        }
        fetchMock.mockResolvedValue(jsonResponse(body));

        await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
          kind: 'unavailable',
        });
        expect(logged).toEqual([
          ['Geocoding unavailable: unexpected response shape'],
        ]);
      },
    );
  });

  it('answers not found for ZERO_RESULTS', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'ZERO_RESULTS', results: [] }),
    );

    await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
      kind: 'not_found',
    });
  });

  describe('answers unavailable and logs one warning', () => {
    it.each([
      'OVER_QUERY_LIMIT',
      'OVER_DAILY_LIMIT',
      'REQUEST_DENIED',
      'INVALID_REQUEST',
      'UNKNOWN_ERROR',
      'SOMETHING_NEW',
    ])('for the Google status %s', async (status) => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          status,
          error_message: `The provided API key is invalid: ${FAKE_KEY}`,
          results: [],
        }),
      );

      await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
        kind: 'unavailable',
      });
      expect(logged).toEqual([
        [`Geocoding unavailable: Google status ${status}`],
      ]);
    });

    it('for HTTP 500', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'OK' }, 500));

      await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
        kind: 'unavailable',
      });
      expect(logged).toEqual([['Geocoding unavailable: HTTP 500']]);
    });

    it('for a body that is not JSON', async () => {
      fetchMock.mockResolvedValue(new Response('<html>oops</html>'));

      await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
        kind: 'unavailable',
      });
      expect(logged).toEqual([['Geocoding unavailable: invalid JSON']]);
    });

    it('for an OK result without coordinates', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'OK', results: [] }));

      await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
        kind: 'unavailable',
      });
      expect(logged).toEqual([
        ['Geocoding unavailable: unexpected response shape'],
      ]);
    });

    it('for a network error, whose message carries the URL', async () => {
      fetchMock.mockImplementation((url: string) =>
        Promise.reject(new TypeError(`fetch failed: ${url}`)),
      );

      await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
        kind: 'unavailable',
      });
      expect(logged).toEqual([
        ['Geocoding unavailable: network error (TypeError)'],
      ]);
    });

    it('for a timeout', async () => {
      fetchMock.mockRejectedValue(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError',
        ),
      );

      await expect(geocoder().geocode(ADDRESS)).resolves.toEqual({
        kind: 'unavailable',
      });
      expect(logged).toEqual([['Geocoding unavailable: timeout']]);
    });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])(
    'answers unavailable without calling Google when the key is %s',
    async (_case, key) => {
      await expect(geocoder(key).geocode(ADDRESS)).resolves.toEqual({
        kind: 'unavailable',
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(logged).toEqual([
        ['Geocoding unavailable: GOOGLE_GEOCODING_API_KEY is not set'],
      ]);
    },
  );

  it('never logs or returns the key, the URL or the address, whatever happens', async () => {
    const outcomes: Array<() => Promise<Response>> = [
      () => Promise.resolve(jsonResponse(okBody(4.65, -74.05))),
      () => Promise.resolve(jsonResponse(okBody(6.24, -75.58))),
      () =>
        Promise.resolve(
          jsonResponse({ status: 'REQUEST_DENIED', error_message: FAKE_KEY }),
        ),
      () => Promise.resolve(jsonResponse({}, 403)),
      () => Promise.resolve(new Response('not json')),
      () => Promise.reject(new TypeError(`fetch failed: key=${FAKE_KEY}`)),
      () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
    ];
    const results: unknown[] = [];
    for (const outcome of outcomes) {
      fetchMock.mockImplementationOnce(outcome);
      results.push(await geocoder().geocode(ADDRESS));
    }

    const everything = JSON.stringify({ logged, results });
    expect(everything).not.toContain(FAKE_KEY);
    expect(everything).not.toContain('maps.googleapis.com');
    expect(JSON.stringify(logged)).not.toContain('72-30');
  });
});
