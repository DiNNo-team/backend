import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../../app.setup.js';
import { CreateTableDto } from './create-table.dto.js';

const CAPACITY_MESSAGE = 'La capacidad va de 1 a 20 personas.';
const IDENTIFIER_MESSAGE = 'Escribe el identificador de la mesa.';

// Same pipe the app registers globally in configureApp.
const pipe = createValidationPipe();

function validate(body: unknown): Promise<CreateTableDto> {
  return pipe.transform(body, { type: 'body', metatype: CreateTableDto });
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

describe('CreateTableDto', () => {
  it('accepts a valid table and trims the identifier', async () => {
    const dto = await validate({ identifier: '  Mesa 4 ', capacity: 4 });

    expect(dto).toBeInstanceOf(CreateTableDto);
    expect(dto).toEqual({ identifier: 'Mesa 4', capacity: 4 });
  });

  it.each([1, 20])('accepts capacity %i (limit)', async (capacity) => {
    await expect(validate({ identifier: 'Mesa 1', capacity })).resolves.toEqual(
      { identifier: 'Mesa 1', capacity },
    );
  });

  it.each([
    ['0', 0],
    ['21', 21],
    ['decimal', 2.5],
    ['text', 'cuatro'],
    ['numeric string', '4'],
    ['missing', undefined],
  ])('rejects capacity %s with one clear message', async (_case, capacity) => {
    await expect(
      messagesFor({ identifier: 'Mesa 1', capacity }),
    ).resolves.toEqual([CAPACITY_MESSAGE]);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['missing', undefined],
    ['not text', 4],
  ])(
    'rejects identifier %s with one clear message',
    async (_case, identifier) => {
      await expect(messagesFor({ identifier, capacity: 4 })).resolves.toEqual([
        IDENTIFIER_MESSAGE,
      ]);
    },
  );

  it('rejects an identifier longer than 10 characters after trimming', async () => {
    await expect(
      messagesFor({ identifier: 'x'.repeat(11), capacity: 4 }),
    ).resolves.toEqual([
      'Usa máximo 10 caracteres en el identificador de la mesa.',
    ]);
    await expect(
      validate({ identifier: ` ${'x'.repeat(10)} `, capacity: 4 }),
    ).resolves.toEqual({ identifier: 'x'.repeat(10), capacity: 4 });
  });

  it('rejects restaurantId, status and isActive in Spanish', async () => {
    await expect(
      messagesFor({
        identifier: 'Mesa 1',
        capacity: 2,
        restaurantId: '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f',
        status: 'occupied',
        isActive: false,
      }),
    ).resolves.toEqual([
      'El campo "restaurantId" no se permite. Quítalo de la solicitud.',
      'El campo "status" no se permite. Quítalo de la solicitud.',
      'El campo "isActive" no se permite. Quítalo de la solicitud.',
    ]);
  });

  it('reports every invalid field at once', async () => {
    await expect(messagesFor({ identifier: '', capacity: 0 })).resolves.toEqual(
      [IDENTIFIER_MESSAGE, CAPACITY_MESSAGE],
    );
  });
});
