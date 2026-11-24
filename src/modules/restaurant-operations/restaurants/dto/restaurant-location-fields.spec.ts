import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../../app.setup.js';
import { RegisterRestaurantDto } from './register-restaurant.dto.js';
import { RESTAURANT_LOCATION_MESSAGES } from './restaurant-location-fields.js';
import { UpdateRestaurantDto } from './update-restaurant.dto.js';

// Same pipe the app registers globally in configureApp.
const pipe = createValidationPipe();

const { LATITUDE_INVALID, LONGITUDE_INVALID, INCOMPLETE_LOCATION } =
  RESTAURANT_LOCATION_MESSAGES;

const REGISTRATION = {
  name: 'La Esquina de Ana',
  category: 'colombian',
  address: 'Calle 72 # 10-34, Bogotá',
  schedules: [{ dayOfWeek: 1, isOpen24h: true }],
};

// The coordinates live in RestaurantFieldsDto, so registration (POST) and
// editing (PATCH) must behave the same. Each case runs against both.
const DTOS = [
  {
    name: 'POST (RegisterRestaurantDto)',
    metatype: RegisterRestaurantDto,
    base: REGISTRATION,
  },
  {
    name: 'PATCH (UpdateRestaurantDto)',
    metatype: UpdateRestaurantDto,
    base: {},
  },
] as const;

describe.each(DTOS)('restaurant coordinates in $name', ({ metatype, base }) => {
  function validate(location: object): Promise<Record<string, unknown>> {
    return pipe.transform({ ...base, ...location }, { type: 'body', metatype });
  }

  async function messagesFor(location: object): Promise<string[]> {
    try {
      await validate(location);
    } catch (error) {
      if (error instanceof BadRequestException) {
        return (error.getResponse() as { message: string[] }).message;
      }
      throw error;
    }
    throw new Error('Expected the body to be rejected');
  }

  it('accepts both coordinates inside Bogotá', async () => {
    await expect(
      validate({ latitude: 4.655671, longitude: -74.057006 }),
    ).resolves.toMatchObject({ latitude: 4.655671, longitude: -74.057006 });
  });

  it('accepts neither (the web does not send them yet)', async () => {
    const dto = await validate({});

    expect(dto.latitude).toBeUndefined();
    expect(dto.longitude).toBeUndefined();
  });

  it('accepts the exact bounds', async () => {
    await expect(
      validate({ latitude: 4.45, longitude: -73.95 }),
    ).resolves.toMatchObject({ latitude: 4.45, longitude: -73.95 });
  });

  it('accepts more than 6 decimals and rounds them to 6', async () => {
    await expect(
      validate({ latitude: 4.65567149999, longitude: -74.05700651234 }),
    ).resolves.toMatchObject({ latitude: 4.655671, longitude: -74.057007 });
  });

  it.each([
    ['only the latitude', { latitude: 4.655671 }],
    ['only the longitude', { longitude: -74.057006 }],
  ])('rejects %s', async (_case, location) => {
    await expect(messagesFor(location)).resolves.toEqual([INCOMPLETE_LOCATION]);
  });

  it.each([
    ['south', { latitude: 4.449, longitude: -74.05 }, [LATITUDE_INVALID]],
    ['north', { latitude: 4.851, longitude: -74.05 }, [LATITUDE_INVALID]],
    ['west', { latitude: 4.65, longitude: -74.251 }, [LONGITUDE_INVALID]],
    ['east', { latitude: 4.65, longitude: -73.949 }, [LONGITUDE_INVALID]],
    [
      'Medellín',
      { latitude: 6.244203, longitude: -75.581212 },
      [LATITUDE_INVALID, LONGITUDE_INVALID],
    ],
  ])(
    'rejects a point outside Bogotá, to the %s',
    async (_case, location, messages) => {
      await expect(messagesFor(location)).resolves.toEqual(messages);
    },
  );

  it('rejects null: the location cannot be erased', async () => {
    await expect(
      messagesFor({ latitude: null, longitude: null }),
    ).resolves.toEqual([LATITUDE_INVALID, LONGITUDE_INVALID]);
  });

  it('rejects a coordinate written as text', async () => {
    await expect(
      messagesFor({ latitude: '4.655671', longitude: -74.057006 }),
    ).resolves.toEqual([LATITUDE_INVALID]);
  });
});

describe('PATCH with only coordinates', () => {
  it('is a body with fields to update', async () => {
    await expect(
      pipe.transform(
        { latitude: 4.655671, longitude: -74.057006 },
        { type: 'body', metatype: UpdateRestaurantDto },
      ),
    ).resolves.toEqual({ latitude: 4.655671, longitude: -74.057006 });
  });
});
