import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../../app.setup.js';
import {
  SEARCH_MESSAGES,
  SearchRestaurantsQueryDto,
} from './search-restaurants-query.dto.js';

// Same pipe the app registers globally in configureApp. Query values always
// arrive as text.
const pipe = createValidationPipe();

function validate(query: Record<string, unknown>) {
  return pipe.transform(query, {
    type: 'query',
    metatype: SearchRestaurantsQueryDto,
  });
}

async function messagesFor(query: Record<string, unknown>): Promise<string[]> {
  try {
    await validate(query);
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { message: string[] }).message;
    }
    throw error;
  }
  throw new Error('Expected the query to be rejected');
}

describe('SearchRestaurantsQueryDto', () => {
  describe('valid searches', () => {
    it('by location, with the default radius of 2 km', async () => {
      await expect(
        validate({ lat: '4.655671', lng: '-74.057006' }),
      ).resolves.toEqual({ lat: 4.655671, lng: -74.057006, radiusKm: 2 });
    });

    it('by location, with a radius', async () => {
      await expect(
        validate({ lat: '4.655671', lng: '-74.057006', radiusKm: '10' }),
      ).resolves.toEqual({ lat: 4.655671, lng: -74.057006, radiusKm: 10 });
    });

    it('by zone, with the default radius', async () => {
      await expect(validate({ zone: 'calle-72' })).resolves.toEqual({
        zone: 'calle-72',
        radiusKm: 2,
      });
    });

    it('by zone, with a radius', async () => {
      await expect(
        validate({ zone: 'usaquen', radiusKm: '1' }),
      ).resolves.toEqual({ zone: 'usaquen', radiusKm: 1 });
    });

    it('by a location outside Bogotá (it just finds nothing)', async () => {
      await expect(
        validate({ lat: '6.2442', lng: '-75.5812' }),
      ).resolves.toEqual({ lat: 6.2442, lng: -75.5812, radiusKm: 2 });
    });
  });

  describe('origin', () => {
    it('rejects location and zone together', async () => {
      await expect(
        messagesFor({ lat: '4.65', lng: '-74.05', zone: 'calle-72' }),
      ).resolves.toEqual([SEARCH_MESSAGES.BOTH_ORIGINS]);
    });

    it('rejects a zone with only lat', async () => {
      await expect(
        messagesFor({ lat: '4.65', zone: 'calle-72' }),
      ).resolves.toEqual([SEARCH_MESSAGES.BOTH_ORIGINS]);
    });

    it('rejects a search without location nor zone', async () => {
      await expect(messagesFor({})).resolves.toEqual([
        SEARCH_MESSAGES.NO_ORIGIN,
      ]);
      await expect(messagesFor({ radiusKm: '5' })).resolves.toEqual([
        SEARCH_MESSAGES.NO_ORIGIN,
      ]);
    });

    it.each([
      ['only lat', { lat: '4.65' }],
      ['only lng', { lng: '-74.05' }],
    ])('rejects %s', async (_case, query) => {
      await expect(messagesFor(query)).resolves.toEqual([
        SEARCH_MESSAGES.INCOMPLETE_LOCATION,
      ]);
    });
  });

  describe('coordinates', () => {
    it.each(['abc', '91', '-90.5', '1e3', '0x10', '1e1', 'Infinity', '+5'])(
      'rejects lat=%s',
      async (lat) => {
        await expect(messagesFor({ lat, lng: '-74.05' })).resolves.toEqual([
          SEARCH_MESSAGES.LAT_INVALID,
        ]);
      },
    );

    it.each(['abc', '181', '-180.1', '0x10', '1e1', '-Infinity', '+5'])(
      'rejects lng=%s',
      async (lng) => {
        await expect(messagesFor({ lat: '4.65', lng })).resolves.toEqual([
          SEARCH_MESSAGES.LNG_INVALID,
        ]);
      },
    );

    // Number('') is 0: without the check, "?lat=&lng=" would search at (0, 0).
    it.each(['', '  '])(
      'rejects an empty lat and lng ("%s")',
      async (empty) => {
        await expect(messagesFor({ lat: empty, lng: empty })).resolves.toEqual([
          SEARCH_MESSAGES.LAT_INVALID,
          SEARCH_MESSAGES.LNG_INVALID,
        ]);
      },
    );

    it('rejects an empty lng next to a valid lat', async () => {
      await expect(messagesFor({ lat: '4.65', lng: '' })).resolves.toEqual([
        SEARCH_MESSAGES.LNG_INVALID,
      ]);
    });

    it('accepts lat 0 and lng 0 written as numbers', async () => {
      await expect(validate({ lat: '0', lng: '0' })).resolves.toEqual({
        lat: 0,
        lng: 0,
        radiusKm: 2,
      });
    });

    // 0x10, 1e1 and +5 would be 16, 10 and 5 with Number(): all in range, so
    // the cases above only fail because of the plain decimal rule.
    it('accepts plain decimals with spaces around them', async () => {
      await expect(
        validate({ lat: ' 4.655671 ', lng: '-74.057006 ', partySize: ' 4 ' }),
      ).resolves.toEqual({
        lat: 4.655671,
        lng: -74.057006,
        partySize: 4,
        radiusKm: 2,
      });
    });

    it('rejects a repeated lat (?lat=1&lat=2)', async () => {
      await expect(
        messagesFor({ lat: ['4.6', '4.7'], lng: '-74.05' }),
      ).resolves.toEqual([SEARCH_MESSAGES.LAT_INVALID]);
    });
  });

  describe('zone', () => {
    it.each(['bogota', 'CALLE-72', '', 'Calle 72'])(
      'rejects an unknown zone "%s"',
      async (zone) => {
        await expect(messagesFor({ zone })).resolves.toEqual([
          SEARCH_MESSAGES.ZONE_UNKNOWN,
        ]);
      },
    );
  });

  describe('radiusKm', () => {
    it.each(['3', '0', '-2', 'abc', '', '2.5'])(
      'rejects radiusKm=%s',
      async (radiusKm) => {
        await expect(
          messagesFor({ zone: 'calle-72', radiusKm }),
        ).resolves.toEqual([SEARCH_MESSAGES.RADIUS_INVALID]);
      },
    );

    // Only plain decimals, like lat, lng and partySize: Number() would read
    // these as 2 (or as a number at all).
    it.each(['0x2', '2e0', '+2', 'Infinity', ' ', ['2', '5']])(
      'rejects radiusKm=%j even if Number() would read a number',
      async (radiusKm) => {
        await expect(
          messagesFor({ zone: 'calle-72', radiusKm }),
        ).resolves.toEqual([SEARCH_MESSAGES.RADIUS_INVALID]);
      },
    );

    it('accepts a valid radius with surrounding spaces', async () => {
      await expect(
        validate({ zone: 'calle-72', radiusKm: ' 2 ' }),
      ).resolves.toEqual({ zone: 'calle-72', radiusKm: 2 });
    });

    it('defaults to 2 km when radiusKm is missing', async () => {
      await expect(validate({ zone: 'calle-72' })).resolves.toEqual({
        zone: 'calle-72',
        radiusKm: 2,
      });
    });
  });

  describe('category', () => {
    it.each(['colombian', 'italian', 'fast_food'])(
      'accepts category=%s',
      async (category) => {
        await expect(validate({ zone: 'calle-72', category })).resolves.toEqual(
          { zone: 'calle-72', radiusKm: 2, category },
        );
      },
    );

    it.each(['Colombian', 'pizza', '', 'fast-food'])(
      'rejects category="%s" and lists the valid ones',
      async (category) => {
        await expect(
          messagesFor({ zone: 'calle-72', category }),
        ).resolves.toEqual([SEARCH_MESSAGES.CATEGORY_INVALID]);
      },
    );

    it('the message lists every category', () => {
      expect(SEARCH_MESSAGES.CATEGORY_INVALID).toBe(
        'La categoría (category) debe ser una de estas: colombian, italian, mexican, asian, grill, fast_food, healthy, seafood, cafe, other.',
      );
    });

    it('rejects two categories (?category=a&category=b)', async () => {
      await expect(
        messagesFor({ zone: 'calle-72', category: ['colombian', 'italian'] }),
      ).resolves.toEqual([SEARCH_MESSAGES.CATEGORY_INVALID]);
    });
  });

  describe('partySize', () => {
    it.each([
      ['1', 1],
      ['20', 20],
    ])('accepts partySize=%s', async (partySize, expected) => {
      await expect(validate({ zone: 'calle-72', partySize })).resolves.toEqual({
        zone: 'calle-72',
        radiusKm: 2,
        partySize: expected,
      });
    });

    // '' and '  ' must not become 0, the same rule as lat and lng.
    it.each([
      '0',
      '21',
      '2.5',
      'abc',
      '',
      '  ',
      '-1',
      '0x10',
      '1e1',
      'Infinity',
      '+5',
    ])('rejects partySize="%s"', async (partySize) => {
      await expect(
        messagesFor({ zone: 'calle-72', partySize }),
      ).resolves.toEqual([SEARCH_MESSAGES.PARTY_SIZE_INVALID]);
    });
  });

  describe('combined filters', () => {
    it('zone + category', async () => {
      await expect(
        validate({ zone: 'chapinero', category: 'italian' }),
      ).resolves.toEqual({
        zone: 'chapinero',
        radiusKm: 2,
        category: 'italian',
      });
    });

    it('location + partySize', async () => {
      await expect(
        validate({ lat: '4.65', lng: '-74.05', partySize: '4' }),
      ).resolves.toEqual({ lat: 4.65, lng: -74.05, radiusKm: 2, partySize: 4 });
    });

    it('location + category + partySize + radiusKm', async () => {
      await expect(
        validate({
          lat: '4.65',
          lng: '-74.05',
          category: 'grill',
          partySize: '6',
          radiusKm: '5',
        }),
      ).resolves.toEqual({
        lat: 4.65,
        lng: -74.05,
        radiusKm: 5,
        category: 'grill',
        partySize: 6,
      });
    });

    it('reports every invalid filter at once', async () => {
      await expect(
        messagesFor({ zone: 'calle-72', category: 'x', partySize: '0' }),
      ).resolves.toEqual([
        SEARCH_MESSAGES.CATEGORY_INVALID,
        SEARCH_MESSAGES.PARTY_SIZE_INVALID,
      ]);
    });
  });

  it('rejects a parameter that is not in the contract (restaurantId)', async () => {
    await expect(
      messagesFor({ zone: 'calle-72', restaurantId: 'x' }),
    ).resolves.toEqual([
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
    ]);
  });
});
