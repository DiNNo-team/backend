import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  Logger,
  Post,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { IsInt } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';

// Looks like what a real failure could carry: none of it may reach the client.
const ORIGINAL_MESSAGE =
  'Connection terminated unexpectedly: SELECT * FROM "tables" WHERE restaurant_id = $1';

class ProbeDto {
  @IsInt({ message: 'Escribe un número entero.' })
  value: number;
}

@Controller('probe')
class ProbeController {
  @Get('crash')
  crash(): never {
    throw new Error(ORIGINAL_MESSAGE);
  }

  @Get('crash-non-error')
  crashNonError(): never {
    // Third-party code can throw values that are not Error instances.
    throw 'raw string failure';
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('Primero registra tu restaurante.', {
      errorCode: 'RESTAURANT_REQUIRED',
    });
  }

  @Post('validate')
  validate(@Body() dto: ProbeDto): ProbeDto {
    return dto;
  }
}

// Prueba el filtro global de excepciones registrado en configureApp.
describe('Unhandled errors (e2e)', () => {
  let app: INestApplication<App>;
  let loggedErrors: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    loggedErrors = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const moduleFixture = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
      controllers: [ProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    loggedErrors.mockRestore();
  });

  it('answers an unexpected error with a Spanish 500 and no detail', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/probe/crash')
      .expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      message:
        'No pudimos completar la acción. Intenta de nuevo en un momento.',
      error: 'Internal Server Error',
    });
    expect(res.text).not.toContain('Connection terminated');
    expect(res.text).not.toContain('SELECT');
    expect(res.body).not.toHaveProperty('errorCode');
  });

  it('logs the full original error on the server', async () => {
    await request(app.getHttpServer()).get('/v1/probe/crash').expect(500);

    expect(loggedErrors).toHaveBeenCalledTimes(1);
    const [message, stack] = loggedErrors.mock.calls[0] as [string, string];
    expect(message).toBe(`GET /v1/probe/crash: Error: ${ORIGINAL_MESSAGE}`);
    expect(stack).toContain(ORIGINAL_MESSAGE);
    expect(stack).toContain('ProbeController.crash');
  });

  it('also handles and logs a thrown value that is not an Error', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/probe/crash-non-error')
      .expect(500);

    expect(res.text).not.toContain('raw string failure');
    expect(loggedErrors).toHaveBeenCalledWith(
      'GET /v1/probe/crash-non-error: Non-error value thrown: raw string failure',
      undefined,
    );
  });

  it('lets our 403 through unchanged, errorCode included', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/probe/forbidden')
      .expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      message: 'Primero registra tu restaurante.',
      error: 'Forbidden',
      errorCode: 'RESTAURANT_REQUIRED',
    });
    expect(loggedErrors).not.toHaveBeenCalled();
  });

  it('lets a validation 400 through unchanged, with its list of messages', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/probe/validate')
      .send({ value: 'dos' })
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      message: ['Escribe un número entero.'],
      error: 'Bad Request',
    });
    expect(loggedErrors).not.toHaveBeenCalled();
  });

  it('keeps a malformed JSON body as a 400, not a 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/probe/validate')
      .set('Content-Type', 'application/json')
      .send('{"value": ')
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body.message).not.toBe(
      'No pudimos completar la acción. Intenta de nuevo en un momento.',
    );
  });
});
