import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../../app.setup.js';
import { RegisterRestaurantDto } from './register-restaurant.dto.js';

// Same pipe the app registers globally in configureApp.
const pipe = createValidationPipe();

const MONDAY = {
  dayOfWeek: 1,
  isOpen24h: false,
  opensAt: '09:00',
  closesAt: '22:00',
};

const VALID_BODY = {
  name: 'La Esquina de Ana',
  category: 'colombian',
  address: 'Calle 72 # 10-34, Bogotá',
  schedules: [MONDAY],
};

function validate(body: unknown): Promise<RegisterRestaurantDto> {
  return pipe.transform(body, {
    type: 'body',
    metatype: RegisterRestaurantDto,
  });
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

function withSchedules(...schedules: unknown[]) {
  return { ...VALID_BODY, schedules };
}

describe('RegisterRestaurantDto', () => {
  it('accepts a complete body and trims the name and the address', async () => {
    const dto = await validate({
      ...VALID_BODY,
      name: '  La Esquina de Ana ',
      address: ' Calle 72 # 10-34, Bogotá  ',
    });

    expect(dto).toEqual(VALID_BODY);
    expect(dto).toBeInstanceOf(RegisterRestaurantDto);
  });

  it('accepts a 24-hour day without times and a closing time on the next day', async () => {
    const schedules = [
      { dayOfWeek: 5, isOpen24h: false, opensAt: '18:00', closesAt: '02:00' },
      { dayOfWeek: 6, isOpen24h: true },
    ];

    await expect(validate(withSchedules(...schedules))).resolves.toEqual(
      withSchedules(...schedules),
    );
  });

  // One message per missing field. class-validator checks schedules (declared
  // in the subclass) before the inherited fields, so the order is not asserted.
  it('asks for every missing field once, in Spanish', async () => {
    const messages = await messagesFor({});

    expect(messages.sort()).toEqual(
      [
        'Escribe el nombre de tu restaurante.',
        'Elige la categoría de tu restaurante de la lista.',
        'Escribe la dirección de tu restaurante.',
        'Envía los horarios como una lista, con un elemento por cada día que abres.',
      ].sort(),
    );
  });

  it.each([['lunes'], [42]])(
    'gives a single message when schedules is not a list (%j)',
    async (schedules) => {
      await expect(messagesFor({ ...VALID_BODY, schedules })).resolves.toEqual([
        'Envía los horarios como una lista, con un elemento por cada día que abres.',
      ]);
    },
  );

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['null', null],
  ])('rejects an address that is %s', async (_case, address) => {
    await expect(messagesFor({ ...VALID_BODY, address })).resolves.toEqual([
      'Escribe la dirección de tu restaurante.',
    ]);
  });

  it('rejects an address longer than 255 characters', async () => {
    await expect(
      messagesFor({ ...VALID_BODY, address: 'x'.repeat(256) }),
    ).resolves.toEqual([
      'La dirección es muy larga. Usa máximo 255 caracteres.',
    ]);
  });

  it.each([['Colombiana'], ['COLOMBIAN'], [null]])(
    'rejects the category %j, which is not in the list',
    async (category) => {
      await expect(messagesFor({ ...VALID_BODY, category })).resolves.toEqual([
        'Elige la categoría de tu restaurante de la lista.',
      ]);
    },
  );

  it('asks for at least one open day', async () => {
    await expect(messagesFor(withSchedules())).resolves.toEqual([
      'Indica al menos un día en que abre tu restaurante.',
    ]);
  });

  it('rejects a repeated day', async () => {
    await expect(
      messagesFor(withSchedules(MONDAY, { ...MONDAY, opensAt: '10:00' })),
    ).resolves.toEqual([
      'Cada día de la semana va una sola vez en los horarios.',
    ]);
  });

  it.each([[0], [8], [1.5], ['1']])(
    'rejects the day %j, which is not 1 to 7',
    async (dayOfWeek) => {
      await expect(
        messagesFor(withSchedules({ ...MONDAY, dayOfWeek })),
      ).resolves.toEqual([
        'Indica el día con un número del 1 (lunes) al 7 (domingo).',
      ]);
    },
  );

  it('names the day whose times are wrong', async () => {
    await expect(
      messagesFor(
        withSchedules(
          { ...MONDAY, opensAt: '9:00' },
          { dayOfWeek: 4, isOpen24h: false, opensAt: '09:00' },
        ),
      ),
    ).resolves.toEqual([
      'El lunes: escribe la hora de apertura en formato HH:MM, por ejemplo 09:30.',
      'El jueves: escribe la hora de cierre en formato HH:MM, por ejemplo 22:00.',
    ]);
  });

  it.each([['24:00'], ['09:60'], ['09:00:30'], ['9 am']])(
    'rejects the time %j, which is not HH:MM',
    async (opensAt) => {
      await expect(
        messagesFor(withSchedules({ ...MONDAY, opensAt })),
      ).resolves.toEqual([
        'El lunes: escribe la hora de apertura en formato HH:MM, por ejemplo 09:30.',
      ]);
    },
  );

  it('rejects the same opening and closing time', async () => {
    await expect(
      messagesFor(withSchedules({ ...MONDAY, closesAt: '09:00' })),
    ).resolves.toEqual([
      'El lunes: la hora de cierre debe ser distinta de la de apertura. Si abres todo el día, marca Abierto 24 horas.',
    ]);
  });

  it('rejects times on a 24-hour day', async () => {
    await expect(
      messagesFor(withSchedules({ ...MONDAY, isOpen24h: true })),
    ).resolves.toEqual([
      'El lunes: si abres 24 horas, no envíes la hora de apertura.',
      'El lunes: si abres 24 horas, no envíes la hora de cierre.',
    ]);
  });

  it('asks whether the day is open 24 hours', async () => {
    const { isOpen24h: _omitted, ...withoutFlag } = MONDAY;

    await expect(messagesFor(withSchedules(withoutFlag))).resolves.toEqual([
      'Indica con true o false si el restaurante abre 24 horas ese día.',
    ]);
  });

  it('rejects fields that are not in the DTO, also inside a day', async () => {
    await expect(
      messagesFor({
        ...VALID_BODY,
        restaurantId: 'abc',
        schedules: [{ ...MONDAY, restaurantId: 'abc' }],
      }),
    ).resolves.toEqual([
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
    ]);
  });
});
