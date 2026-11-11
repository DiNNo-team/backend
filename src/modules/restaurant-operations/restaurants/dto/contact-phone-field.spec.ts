import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../../app.setup.js';
import { CONTACT_PHONE_INVALID } from './contact-phone-field.js';
import { RegisterRestaurantDto } from './register-restaurant.dto.js';
import { SignupRestaurantDto } from './signup-restaurant.dto.js';

// Same pipe the app registers globally in configureApp.
const pipe = createValidationPipe();

const BODY = {
  name: 'La Esquina de Ana',
  category: 'colombian',
  address: 'Calle 72 # 10-34, Bogotá',
  schedules: [
    { dayOfWeek: 1, isOpen24h: false, opensAt: '09:00', closesAt: '22:00' },
  ],
};

function validate<T>(metatype: new () => T, body: unknown): Promise<T> {
  return pipe.transform(body, { type: 'body', metatype });
}

async function messagesFor(
  metatype: new () => unknown,
  body: unknown,
): Promise<string[]> {
  try {
    await validate(metatype, body);
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { message: string[] }).message;
    }
    throw error;
  }
  throw new Error('Expected the body to be rejected');
}

describe('contact phone (SignupRestaurantDto, required)', () => {
  it.each([
    ['a mobile with spaces', '300 123 4567', '3001234567'],
    ['a landline with the area code', '(601) 234-5678', '6012345678'],
    ['the country code', '+57 300 123 4567', '+573001234567'],
    ['dots', '300.123.4567', '3001234567'],
    ['the shortest: 7 digits', '2345678', '2345678'],
    ['the longest: 15 digits', '+123456789012345', '+123456789012345'],
  ])(
    'accepts %s and stores it without separators',
    async (_case, raw, stored) => {
      const dto = await validate(SignupRestaurantDto, {
        ...BODY,
        contactPhone: raw,
      });

      expect(dto.contactPhone).toBe(stored);
    },
  );

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['only separators', ' - ( ) '],
    ['6 digits', '234567'],
    ['16 digits', '1234567890123456'],
    ['letters', '300-ABC-4567'],
    ['a + in the middle', '300+1234567'],
    ['a number, not text', 3001234567],
  ])(
    'rejects a phone that is %s with the Spanish message',
    async (_case, value) => {
      const body =
        value === undefined ? BODY : { ...BODY, contactPhone: value };

      expect(await messagesFor(SignupRestaurantDto, body)).toEqual([
        CONTACT_PHONE_INVALID,
      ]);
    },
  );

  it('keeps every rule of the registration fields (no schedules → 400)', async () => {
    const messages = await messagesFor(SignupRestaurantDto, {
      name: 'La Esquina de Ana',
      category: 'colombian',
      address: 'Calle 72 # 10-34, Bogotá',
      contactPhone: '3001234567',
    });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages).not.toContain(CONTACT_PHONE_INVALID);
  });

  it('rejects a field that is not in the DTO (approvalStatus cannot be sent)', async () => {
    const messages = await messagesFor(SignupRestaurantDto, {
      ...BODY,
      contactPhone: '3001234567',
      approvalStatus: 'approved',
    });

    expect(messages).toEqual([
      'El campo "approvalStatus" no se permite. Quítalo de la solicitud.',
    ]);
  });
});

describe('contact phone (RegisterRestaurantDto, optional)', () => {
  it('can be left out', async () => {
    const dto = await validate(RegisterRestaurantDto, BODY);

    expect(dto.contactPhone).toBeUndefined();
  });

  it('is normalized when sent', async () => {
    const dto = await validate(RegisterRestaurantDto, {
      ...BODY,
      contactPhone: '+57 (300) 123-4567',
    });

    expect(dto.contactPhone).toBe('+573001234567');
  });

  it.each([
    ['null', null],
    ['invalid', '12'],
  ])('rejects a phone that is %s', async (_case, value) => {
    expect(
      await messagesFor(RegisterRestaurantDto, {
        ...BODY,
        contactPhone: value,
      }),
    ).toEqual([CONTACT_PHONE_INVALID]);
  });
});
