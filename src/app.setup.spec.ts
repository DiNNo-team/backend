import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsInt, IsString, Max, Min, ValidateNested } from 'class-validator';
import { createValidationPipe, resolveListenHost } from './app.setup.js';

function configWith(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('resolveListenHost', () => {
  it('listens only on this machine locally, even with the development user on', () => {
    expect(
      resolveListenHost(
        configWith({ NODE_ENV: 'development', DEV_USER_ENABLED: 'true' }),
      ),
    ).toBe('127.0.0.1');
    expect(resolveListenHost(configWith({}))).toBe('127.0.0.1');
  });

  it.each([
    ['Render', { RENDER: 'true' }],
    ['production', { NODE_ENV: 'production' }],
  ])('listens on every interface when deployed (%s)', (_, env) => {
    expect(resolveListenHost(configWith(env))).toBe('0.0.0.0');
  });
});

const HOUR_MESSAGE = 'Escribe la hora en formato HH:MM, por ejemplo 09:30.';
const GUESTS_MESSAGE = 'Escribe un número de personas entre 1 y 20.';

class DayScheduleProbe {
  @IsString({ message: HOUR_MESSAGE })
  opensAt: string;
}

class ProbeDto {
  @IsString({ message: HOUR_MESSAGE })
  opensAt: string;

  @IsString({ message: HOUR_MESSAGE })
  closesAt: string;

  @IsInt({ message: GUESTS_MESSAGE })
  @Min(1, { message: GUESTS_MESSAGE })
  @Max(20, { message: GUESTS_MESSAGE })
  guests: number;

  @ValidateNested({ each: true })
  @Type(() => DayScheduleProbe)
  days: DayScheduleProbe[];
}

const valid = { opensAt: '09:00', closesAt: '18:00', guests: 2, days: [] };

async function messagesFor(body: object): Promise<string[]> {
  try {
    await createValidationPipe().transform(body, {
      type: 'body',
      metatype: ProbeDto,
    });
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { message: string[] }).message;
    }
    throw error;
  }
  throw new Error('Expected the body to be rejected');
}

describe('createValidationPipe', () => {
  it('gives one message when several rules fail on the same field', async () => {
    await expect(messagesFor({ ...valid, guests: 'dos' })).resolves.toEqual([
      GUESTS_MESSAGE,
    ]);
  });

  it('gives one entry per field when two fields fail with the same message', async () => {
    await expect(
      messagesFor({ ...valid, opensAt: 9, closesAt: 18 }),
    ).resolves.toEqual([HOUR_MESSAGE, HOUR_MESSAGE]);
  });

  it('gives one entry per item when nested items fail with the same message', async () => {
    await expect(
      messagesFor({
        ...valid,
        days: [{ opensAt: 9 }, { opensAt: '10:00' }, { opensAt: 9 }],
      }),
    ).resolves.toEqual([HOUR_MESSAGE, HOUR_MESSAGE]);
  });

  it('rejects unknown fields in Spanish, also inside nested objects', async () => {
    await expect(
      messagesFor({ ...valid, days: [{ opensAt: '09:00', extra: true }] }),
    ).resolves.toEqual([
      'El campo "extra" no se permite. Quítalo de la solicitud.',
    ]);
  });
});
