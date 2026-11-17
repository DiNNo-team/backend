import {
  Controller,
  type DynamicModule,
  Get,
  Global,
  HttpCode,
  type INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebSocketGateway } from '@nestjs/websockets';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { RateLimit } from './../src/common/rate-limit/rate-limit.decorator.js';
import { RATE_LIMITED_MESSAGE } from './../src/common/rate-limit/rate-limit.guard.js';
import { RateLimitModule } from './../src/common/rate-limit/rate-limit.module.js';
import {
  RATE_LIMIT_RULES,
  SOCKET_CONNECTION_RULE,
} from './../src/common/rate-limit/rate-limit.settings.js';
import { SocketConnectionLimiter } from './../src/common/rate-limit/socket-connection-limiter.js';
import { REDIS_CLIENT } from './../src/config/redis.config.js';

// Límite de peticiones y cabeceras de seguridad (Sprint 4, tareas 6.1.3 y
// 6.1.4) sobre rutas de prueba: lo que se prueba es la capa HTTP, no los
// módulos. Redis está "caído" (status `end`), así que se cuenta en memoria:
// es el mismo camino que el respaldo cuando Redis falla.

@Controller('probe')
class ProbeController {
  @Get()
  open(): { ok: true } {
    return { ok: true };
  }

  @Post('reserve')
  @HttpCode(200)
  @RateLimit('reservation')
  reserve(): { ok: true } {
    return { ok: true };
  }

  @Post('cancel')
  @HttpCode(200)
  @RateLimit('reservation')
  cancel(): { ok: true } {
    return { ok: true };
  }
}

@WebSocketGateway()
class ProbeGateway {}

// Redis "down" by default; a test passes its own client to see the calls.
@Global()
@Module({})
class FakeRedisModule {
  static with(client: unknown): DynamicModule {
    return {
      module: FakeRedisModule,
      providers: [{ provide: REDIS_CLIENT, useValue: client }],
      exports: [REDIS_CLIENT],
    };
  }
}

function token(sub: string): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `Bearer ${part({ alg: 'RS256' })}.${part({ sub })}.firma`;
}

async function start(
  env: Record<string, string>,
  redis: unknown = { status: 'end' },
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => env],
      }),
      FakeRedisModule.with(redis),
      RateLimitModule,
    ],
    controllers: [ProbeController],
    providers: [ProbeGateway],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app, {
    socketConnectionLimiter: app.get(SocketConnectionLimiter),
  });
  await app.init();
  return app;
}

const RESERVATION_LIMIT = RATE_LIMIT_RULES.reservation.limit;

describe('Límite de peticiones (HTTP)', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app.close();
  });

  it('responde 429 en español con Retry-After al pasar el límite de la ruta', async () => {
    app = await start({});
    const server = app.getHttpServer();
    for (let i = 0; i < RESERVATION_LIMIT; i++) {
      await request(server)
        .post('/v1/probe/reserve')
        .set('Authorization', token('uid-a'))
        .expect(200);
    }

    const blocked = await request(server)
      .post('/v1/probe/reserve')
      .set('Authorization', token('uid-a'))
      .expect(429);

    expect(blocked.body).toEqual({
      statusCode: 429,
      message: RATE_LIMITED_MESSAGE,
      error: 'Too Many Requests',
    });
    expect(Number(blocked.headers['retry-after-reservation'])).toBeGreaterThan(
      0,
    );
    // Las demás rutas de esa cuenta siguen funcionando.
    await request(server)
      .get('/v1/probe')
      .set('Authorization', token('uid-a'))
      .expect(200);
  });

  it('con Redis conectado cuenta en Redis, una clave por límite y cuenta', async () => {
    const redis = {
      status: 'ready',
      eval: vi.fn().mockResolvedValue([1, 60_000]),
    };
    app = await start({}, redis);

    await request(app.getHttpServer())
      .post('/v1/probe/reserve')
      .set('Authorization', token('uid-a'))
      .expect(200);

    const keys = redis.eval.mock.calls.map((call) => call[2] as string);
    expect(keys).toEqual(
      expect.arrayContaining([
        'dinno:rl:ip:ip:127.0.0.1',
        'dinno:rl:caller:user:uid-a',
        'dinno:rl:reservation:user:uid-a',
      ]),
    );
    expect(keys).toHaveLength(3);
  });

  it('cuenta por cuenta: otra persona en la misma red no se bloquea', async () => {
    app = await start({});
    const server = app.getHttpServer();
    for (let i = 0; i <= RESERVATION_LIMIT; i++) {
      await request(server)
        .post('/v1/probe/reserve')
        .set('Authorization', token('uid-a'));
    }

    await request(server)
      .post('/v1/probe/reserve')
      .set('Authorization', token('uid-b'))
      .expect(200);
  });

  it('las rutas con el mismo límite comparten el contador', async () => {
    app = await start({});
    const server = app.getHttpServer();
    for (let i = 0; i < RESERVATION_LIMIT; i++) {
      await request(server)
        .post(i % 2 === 0 ? '/v1/probe/reserve' : '/v1/probe/cancel')
        .set('Authorization', token('uid-a'))
        .expect(200);
    }

    await request(server)
      .post('/v1/probe/cancel')
      .set('Authorization', token('uid-a'))
      .expect(429);
  });

  it('sin sesión cuenta por la IP real que deja el proxy', async () => {
    app = await start({ TRUST_PROXY_HOPS: '1' });
    const server = app.getHttpServer();
    for (let i = 0; i <= RESERVATION_LIMIT; i++) {
      await request(server)
        .post('/v1/probe/reserve')
        .set('X-Forwarded-For', '200.1.1.1');
    }

    await request(server)
      .post('/v1/probe/reserve')
      .set('X-Forwarded-For', '200.1.1.1')
      .expect(429);
    await request(server)
      .post('/v1/probe/reserve')
      .set('X-Forwarded-For', '200.2.2.2')
      .expect(200);
  });

  it('RATE_LIMIT_FACTOR sube todos los límites (prueba de carga)', async () => {
    app = await start({ RATE_LIMIT_FACTOR: '2' });
    const server = app.getHttpServer();
    for (let i = 0; i < RESERVATION_LIMIT * 2; i++) {
      await request(server)
        .post('/v1/probe/reserve')
        .set('Authorization', token('uid-a'))
        .expect(200);
    }

    await request(server)
      .post('/v1/probe/reserve')
      .set('Authorization', token('uid-a'))
      .expect(429);
  });

  it('con RATE_LIMIT_ENABLED=false no limita nada', async () => {
    app = await start({ RATE_LIMIT_ENABLED: 'false' });
    const server = app.getHttpServer();
    for (let i = 0; i < RESERVATION_LIMIT + 5; i++) {
      await request(server)
        .post('/v1/probe/reserve')
        .set('Authorization', token('uid-a'))
        .expect(200);
    }
  });
});

describe('Configuración del límite', () => {
  it.each([
    ['RATE_LIMIT_ENABLED', 'si'],
    ['RATE_LIMIT_FACTOR', '0'],
    ['TRUST_PROXY_HOPS', 'x'],
  ])('con %s=%s la app no arranca', async (name, value) => {
    await expect(start({ [name]: value })).rejects.toThrow(name);
  });
});

describe('Cabeceras de seguridad', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await start({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('la API no se puede incrustar ni cargar nada y no dice qué servidor es', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/probe')
      .expect(200);

    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toMatch(
      /max-age=\d+/,
    );
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('los errores también llevan las cabeceras', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/no-existe')
      .expect(404);

    expect(response.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
  });
});

describe('Límite de conexiones del WebSocket', () => {
  let app: INestApplication<App>;
  let sockets: Socket[] = [];

  beforeEach(async () => {
    app = await start({});
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.close());
    sockets = [];
    await app.close();
  });

  function connect(url: string): Promise<'connected' | string> {
    return new Promise((resolve) => {
      const socket = io(url, {
        reconnection: false,
        transports: ['websocket'],
      });
      sockets.push(socket);
      socket.on('connect', () => resolve('connected'));
      socket.on('connect_error', (error) => resolve(error.message));
    });
  }

  it('rechaza con RATE_LIMITED las conexiones de una IP que pasa el límite', async () => {
    const url = await app.getUrl();
    for (let i = 0; i < SOCKET_CONNECTION_RULE.limit; i++) {
      expect(await connect(url)).toBe('connected');
    }

    expect(await connect(url)).toBe('RATE_LIMITED');
  });
});
