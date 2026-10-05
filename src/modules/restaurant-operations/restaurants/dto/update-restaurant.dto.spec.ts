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

  it('rejects fields that are not in the DTO, such as restaurantId', async () => {
    await expect(
      messagesFor({ name: 'Otro', restaurantId: 'abc', id: 'abc' }),
    ).resolves.toEqual([
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
      'El campo "id" no se permite. Quítalo de la solicitud.',
    ]);
  });
});
