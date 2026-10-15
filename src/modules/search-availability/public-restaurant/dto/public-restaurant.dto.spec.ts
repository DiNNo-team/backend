import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../../app.setup.js';
import { LOCATION_MESSAGES } from '../../location/location-fields.js';
import { PublicRestaurantQueryDto } from './public-restaurant.dto.js';

// Same pipe the app registers globally in configureApp.
const pipe = createValidationPipe();

function validate(query: Record<string, unknown>) {
  return pipe.transform(query, {
    type: 'query',
    metatype: PublicRestaurantQueryDto,
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

describe('PublicRestaurantQueryDto', () => {
  it('accepts no location', async () => {
    await expect(validate({})).resolves.toEqual({});
  });

  it('accepts lat and lng together, also outside Bogotá', async () => {
    await expect(validate({ lat: '6.2442', lng: '-75.5812' })).resolves.toEqual(
      { lat: 6.2442, lng: -75.5812 },
    );
  });

  it.each([
    ['only lat', { lat: '4.65' }],
    ['only lng', { lng: '-74.05' }],
  ])('rejects %s with one message', async (_case, query) => {
    await expect(messagesFor(query)).resolves.toEqual([
      LOCATION_MESSAGES.INCOMPLETE_LOCATION,
    ]);
  });

  it.each(['', '  ', 'abc', '0x10', '1e1', 'Infinity', '+5', '91'])(
    'rejects lat="%s"',
    async (lat) => {
      await expect(messagesFor({ lat, lng: '-74.05' })).resolves.toEqual([
        LOCATION_MESSAGES.LAT_INVALID,
      ]);
    },
  );

  it.each(['', 'abc', '181'])('rejects lng="%s"', async (lng) => {
    await expect(messagesFor({ lat: '4.65', lng })).resolves.toEqual([
      LOCATION_MESSAGES.LNG_INVALID,
    ]);
  });

  it('rejects any other parameter', async () => {
    await expect(messagesFor({ zone: 'calle-72' })).resolves.toEqual([
      'El campo "zone" no se permite. Quítalo de la solicitud.',
    ]);
  });
});
