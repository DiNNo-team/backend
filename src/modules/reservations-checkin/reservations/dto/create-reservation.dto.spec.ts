import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateReservationDto,
  PARTY_SIZE_RANGE,
  RESTAURANT_ID_INVALID,
} from './create-reservation.dto.js';

const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';

async function messagesOf(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(CreateReservationDto, body));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('CreateReservationDto', () => {
  it.each([1, 2, 20])('acepta partySize %i', async (partySize) => {
    expect(
      await messagesOf({ restaurantId: RESTAURANT_ID, partySize }),
    ).toEqual([]);
  });

  it.each([0, 21, -1, 2.5, '2', null, undefined])(
    'rechaza partySize %j con el mensaje en español',
    async (partySize) => {
      expect(
        await messagesOf({ restaurantId: RESTAURANT_ID, partySize }),
      ).toContain(PARTY_SIZE_RANGE);
    },
  );

  it.each(['no-es-uuid', '', 123, null, undefined])(
    'rechaza restaurantId %j',
    async (restaurantId) => {
      expect(await messagesOf({ restaurantId, partySize: 2 })).toEqual([
        RESTAURANT_ID_INVALID,
      ]);
    },
  );
});
