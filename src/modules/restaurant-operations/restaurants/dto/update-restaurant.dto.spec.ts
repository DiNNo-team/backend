import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../../app.setup.js';
import { UpdateRestaurantDto } from './update-restaurant.dto.js';

const NAME_REQUIRED = 'Escribe el nombre de tu restaurante.';

// Same pipe the app registers globally in configureApp.
const pipe = createValidationPipe();

function validate(body: unknown): Promise<UpdateRestaurantDto> {
  return pipe.transform(body, { type: 'body', metatype: UpdateRestaurantDto });
}

async function messagesFor(body: unknown): Promise<string[]> {
  try {
    await validate(body);
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { message: string[] }).message;
    }
    throw error;
  }
  throw new Error('Expected the body to be rejected');
}

describe('UpdateRestaurantDto', () => {
  it('accepts a name and trims it (rules inherited from RestaurantFieldsDto)', async () => {
    await expect(validate({ name: '  La Esquina de Ana ' })).resolves.toEqual({
      name: 'La Esquina de Ana',
    });
  });

  it('lets an empty body through: the service answers "nothing to update"', async () => {
    await expect(validate({})).resolves.toEqual({});
  });

  it('accepts a name of exactly 120 characters', async () => {
    await expect(validate({ name: 'x'.repeat(120) })).resolves.toEqual({
      name: 'x'.repeat(120),
    });
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['null', null],
    ['not text', 42],
  ])('rejects a name that is %s', async (_case, name) => {
    await expect(messagesFor({ name })).resolves.toEqual([NAME_REQUIRED]);
  });

  it('rejects a name longer than 120 characters', async () => {
    await expect(messagesFor({ name: 'x'.repeat(121) })).resolves.toEqual([
      'El nombre del restaurante es muy largo. Usa máximo 120 caracteres.',
    ]);
  });

  describe('length in code points, like the varchar columns', () => {
    const NAME_TOO_LONG =
      'El nombre del restaurante es muy largo. Usa máximo 120 caracteres.';

    it('accepts 120 emoji in the name (120 code points)', async () => {
      const name = '🍕'.repeat(120);

      await expect(validate({ name })).resolves.toEqual({ name });
    });

    it('accepts a name with variation selectors that fits in 120 code points', async () => {
      const name = 'a\uFE0F'.repeat(60);

      await expect(validate({ name })).resolves.toEqual({ name });
    });

    it('rejects "a" + U+FE0F × 120: 240 code points do not fit in varchar(120)', async () => {
      await expect(
        messagesFor({ name: 'a\uFE0F'.repeat(120) }),
      ).resolves.toEqual([NAME_TOO_LONG]);
    });

    it('rejects an address of 256 code points and accepts 255', async () => {
      await expect(
        messagesFor({ address: 'a\uFE0F'.repeat(128) }),
      ).resolves.toEqual([
        'La dirección es muy larga. Usa máximo 255 caracteres.',
      ]);
      const address = '🍕'.repeat(255);
      await expect(validate({ address })).resolves.toEqual({ address });
    });
  });

  describe('schedules (same rules as registration)', () => {
    const MONDAY = {
      dayOfWeek: 1,
      isOpen24h: false,
      opensAt: '09:00',
      closesAt: '22:00',
    };

    it('accepts a valid list, alone or with other fields', async () => {
      const schedules = [MONDAY, { dayOfWeek: 7, isOpen24h: true }];

      await expect(validate({ schedules })).resolves.toEqual({ schedules });
      await expect(
        validate({ name: 'La Esquina de Ana', schedules }),
      ).resolves.toEqual({ name: 'La Esquina de Ana', schedules });
    });

    it('rejects null instead of skipping it', async () => {
      await expect(messagesFor({ schedules: null })).resolves.toEqual([
        'Envía los horarios como una lista, con un elemento por cada día que abres.',
      ]);
    });

    it('rejects an empty list: the restaurant cannot stay without open days', async () => {
      await expect(messagesFor({ schedules: [] })).resolves.toEqual([
        'Indica al menos un día en que abre tu restaurante.',
      ]);
    });

    it('rejects a repeated day', async () => {
      await expect(
        messagesFor({ schedules: [MONDAY, { ...MONDAY, opensAt: '10:00' }] }),
      ).resolves.toEqual([
        'Cada día de la semana va una sola vez en los horarios.',
      ]);
    });

    it('rejects more than seven days', async () => {
      const eightDays = [1, 2, 3, 4, 5, 6, 7, 1].map((dayOfWeek) => ({
        ...MONDAY,
        dayOfWeek,
      }));

      await expect(messagesFor({ schedules: eightDays })).resolves.toContain(
        'Envía como máximo un horario por cada día de la semana.',
      );
    });

    it('rejects times on a 24-hour day', async () => {
      await expect(
        messagesFor({ schedules: [{ ...MONDAY, isOpen24h: true }] }),
      ).resolves.toEqual([
        'El lunes: si abres 24 horas, no envíes la hora de apertura.',
        'El lunes: si abres 24 horas, no envíes la hora de cierre.',
      ]);
    });

    it('rejects a time that is not HH:MM, such as "9:00"', async () => {
      await expect(
        messagesFor({ schedules: [{ ...MONDAY, opensAt: '9:00' }] }),
      ).resolves.toEqual([
        'El lunes: escribe la hora de apertura en formato HH:MM, por ejemplo 09:30.',
      ]);
    });

    it('rejects a field that is not in the DTO inside a day', async () => {
      await expect(
        messagesFor({ schedules: [{ ...MONDAY, restaurantId: 'abc' }] }),
      ).resolves.toEqual([
        'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
      ]);
    });
  });

  it('rejects fields that are not in the DTO, such as restaurantId', async () => {
    await expect(
      messagesFor({ name: 'Otro', restaurantId: 'abc', id: 'abc' }),
    ).resolves.toEqual([
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
      'El campo "id" no se permite. Quítalo de la solicitud.',
    ]);
  });
});
