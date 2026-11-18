import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { RestaurantApprovalReader } from './../src/modules/identity-access/approval/restaurant-approval.reader.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import {
  ACCOUNT_ERROR_MESSAGES,
  type AccountErrorCode,
} from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { InsightsCache } from './../src/modules/insights/cache/insights-cache.js';
import { InsightsModule } from './../src/modules/insights/index.js';
import {
  LlmClient,
  type LlmRequest,
  type LlmResult,
} from './../src/modules/insights/narrative/llm-client.js';
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationExpirationService } from './../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { Reservation } from './../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableArea } from './../src/modules/restaurant-operations/table-areas/table-area.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { Clock } from './../src/modules/search-availability/index.js';
import { FakeDatabaseModule } from './support/fake-database.js';
import {
  approvalReader,
  approvalTestUsers,
  fakeFirebaseAuth,
  TEST_APPROVALS,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';

// Informe inteligente del restaurante (docs/ia-diseno.md): forma de la
// respuesta, privacidad de lo que sale al modelo, respaldo con plantillas,
// caché, roles y aprobación. Sin Postgres ni modelo real: la base simulada
// responde según la consulta, y el modelo es un doble.

const OWNER_RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
// Martes 2026-11-17 09:00 en Bogotá.
const NOW = new Date('2026-11-17T14:00:00Z');
const CURRENT_STARTS = new Date('2026-11-11T05:00:00Z');
const CURRENT_ENDS = new Date('2026-11-18T05:00:00Z');
const PREVIOUS_STARTS = new Date('2026-11-04T05:00:00Z');

function forbidden(code: AccountErrorCode) {
  return {
    statusCode: 403,
    message: ACCOUNT_ERROR_MESSAGES[code],
    error: 'Forbidden',
    errorCode: code,
  };
}

interface QueryCall {
  sql: string;
  params: unknown[];
}

const COUNTS = {
  current: {
    created: 42,
    completed: 26,
    cancelled: 4,
    expired: 10,
    active: 2,
    average_party_size: 2.8333,
  },
  previous: {
    created: 35,
    completed: 19,
    cancelled: 4,
    expired: 10,
    active: 0,
    average_party_size: 2.5,
  },
  few: {
    created: 5,
    completed: 3,
    cancelled: 1,
    expired: 0,
    active: 1,
    average_party_size: 2,
  },
};

// Lo que responde Postgres a cada consulta del informe y del resumen.
function fakeQuery(queries: QueryCall[], few: boolean) {
  return (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    const isPrevious =
      params[1] instanceof Date &&
      params[1].getTime() === PREVIOUS_STARTS.getTime();
    if (sql.includes('percentile_cont')) {
      return Promise.resolve([{ median: 9.4667 }]);
    }
    if (sql.includes('"table_logs"')) {
      return Promise.resolve([
        { date: '2026-11-11', updates: 3 },
        { date: '2026-11-12', updates: 4 },
        { date: '2026-11-14', updates: 5 },
        { date: '2026-11-15', updates: 2 },
        { date: '2026-11-16', updates: 6 },
        { date: '2026-11-17', updates: 4 },
      ]);
    }
    if (sql.includes('GROUP BY 1, 2')) {
      return Promise.resolve([
        { dayOfWeek: 5, hour: 13, reservations: 6 },
        { dayOfWeek: 6, hour: 20, reservations: 5 },
      ]);
    }
    if (sql.includes('to_char')) {
      return Promise.resolve([
        {
          date: '2026-11-13',
          created: 8,
          completed: 5,
          cancelled: 1,
          expired: 2,
        },
      ]);
    }
    if (sql.includes('SUM("fee_cop")')) {
      return Promise.resolve([
        { check_ins: isPrevious ? 19 : 26, amount_cop: '52000' },
      ]);
    }
    if (sql.includes('FILTER')) {
      if (few) return Promise.resolve([COUNTS.few]);
      return Promise.resolve([isPrevious ? COUNTS.previous : COUNTS.current]);
    }
    if (sql.includes('EXTRACT(HOUR') || sql.includes('EXTRACT(ISODOW')) {
      return Promise.resolve([]);
    }
    throw new Error(`Consulta no simulada: ${sql}`);
  };
}

class FakeLlm extends LlmClient {
  enabled = true;
  readonly requests: LlmRequest[] = [];
  result: LlmResult = {
    ok: true,
    text: 'El {porcentaje_vencidas_sin_check_in} de tus reservas resueltas venció sin check-in ({reservas_vencidas_sin_check_in} de {reservas_resueltas}). Tu franja con más reservas es el {franja_1_dia} a las {franja_1_hora}.',
  };

  complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    return Promise.resolve(this.result);
  }
}

class MemoryCache extends InsightsCache {
  readonly entries = new Map<string, { value: string; ttl: number }>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key)?.value ?? null);
  }

  set(key: string, value: string, ttl: number): Promise<void> {
    this.entries.set(key, { value, ttl });
    return Promise.resolve();
  }
}

async function createApp(options: { few?: boolean } = {}) {
  const queries: QueryCall[] = [];
  const llm = new FakeLlm();
  const cache = new MemoryCache();

  const moduleFixture = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            DEV_USER_ENABLED: 'false',
            FIREBASE_PROJECT_ID: 'firebase-project-example',
          }),
        ],
      }),
      FakeDatabaseModule.with(
        {},
        { query: fakeQuery(queries, options.few ?? false) },
      ),
      EventEmitterModule.forRoot(),
      InsightsModule,
    ],
  })
    .overrideProvider(FIREBASE_AUTH)
    .useValue(() => fakeFirebaseAuth)
    .overrideProvider(RestaurantApprovalReader)
    .useValue(
      approvalReader({
        [OWNER_RESTAURANT_ID]: 'approved',
        ...TEST_APPROVALS,
      }),
    )
    .overrideProvider(getRepositoryToken(User))
    .useValue(
      usersRepository([
        ...testUsers(OWNER_RESTAURANT_ID),
        ...approvalTestUsers(),
      ]),
    )
    .overrideProvider(getRepositoryToken(Restaurant))
    .useValue({})
    .overrideProvider(getRepositoryToken(RestaurantSchedule))
    .useValue({})
    .overrideProvider(getRepositoryToken(Table))
    .useValue({})
    .overrideProvider(getRepositoryToken(TableLog))
    .useValue({})
    .overrideProvider(getRepositoryToken(TableArea))
    .useValue({})
    .overrideProvider(getRepositoryToken(Reservation))
    .useValue({})
    .overrideProvider(getRepositoryToken(CheckIn))
    .useValue({})
    .overrideProvider(ReservationExpirationService)
    .useValue({ expireDueForRestaurant: vi.fn() })
    .overrideProvider(TableStatusLog)
    .useValue({ record: vi.fn() })
    .overrideProvider(Clock)
    .useValue({ now: () => NOW })
    .overrideProvider(LlmClient)
    .useValue(llm)
    .overrideProvider(InsightsCache)
    .useValue(cache)
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return { app, queries, llm, cache };
}

const PATH = '/v1/restaurants/me/insights';

describe('Informe inteligente del restaurante (e2e)', () => {
  let app: INestApplication<App>;
  let queries: QueryCall[];
  let llm: FakeLlm;
  let cache: MemoryCache;

  beforeEach(async () => {
    ({ app, queries, llm, cache } = await createApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (path: string, token: string | null) => {
    const req = request(app.getHttpServer()).get(path);
    return token === null ? req : req.set('Authorization', `Bearer ${token}`);
  };

  it('la forma exacta: periodos, métricas, comparación, indicador y texto del modelo', async () => {
    const res = await get(PATH, 'owner').expect(200);

    expect(res.body).toEqual({
      period: {
        from: '2026-11-11',
        to: '2026-11-17',
        timezone: 'America/Bogota',
      },
      previousPeriod: {
        from: '2026-11-04',
        to: '2026-11-10',
        timezone: 'America/Bogota',
      },
      generatedAt: NOW.toISOString(),
      dataSufficiency: 'enough',
      minResolved: 10,
      metrics: {
        reservationsCreated: 42,
        active: 2,
        resolved: 40,
        completed: 26,
        cancelled: 4,
        expired: 10,
        checkIns: 26,
        checkInRate: 0.65,
        noShowRate: 0.25,
        cancellationRate: 0.1,
        medianMinutesToCheckIn: 9.5,
        averagePartySize: 2.83,
        topSlots: [
          { dayOfWeek: 5, hour: 13, reservations: 6 },
          { dayOfWeek: 6, hour: 20, reservations: 5 },
        ],
        daily: [
          {
            date: '2026-11-11',
            created: 0,
            completed: 0,
            cancelled: 0,
            expired: 0,
            manualUpdates: 3,
          },
          {
            date: '2026-11-12',
            created: 0,
            completed: 0,
            cancelled: 0,
            expired: 0,
            manualUpdates: 4,
          },
          {
            date: '2026-11-13',
            created: 8,
            completed: 5,
            cancelled: 1,
            expired: 2,
            manualUpdates: 0,
          },
          {
            date: '2026-11-14',
            created: 0,
            completed: 0,
            cancelled: 0,
            expired: 0,
            manualUpdates: 5,
          },
          {
            date: '2026-11-15',
            created: 0,
            completed: 0,
            cancelled: 0,
            expired: 0,
            manualUpdates: 2,
          },
          {
            date: '2026-11-16',
            created: 0,
            completed: 0,
            cancelled: 0,
            expired: 0,
            manualUpdates: 6,
          },
          {
            date: '2026-11-17',
            created: 0,
            completed: 0,
            cancelled: 0,
            expired: 0,
            manualUpdates: 4,
          },
        ],
        manualUpdates: 24,
        manualUpdatesPerDay: 3.4,
        daysWithManualUpdates: 6,
        daysWithoutManualUpdates: 1,
      },
      previous: { reservationsCreated: 35, resolved: 33, checkInRate: 0.5758 },
      reliability: {
        level: 'medium',
        reasons: [
          'Tasa de check-in del 65 %',
          'Actualizaste tus mesas a mano en 6 de 7 días',
        ],
      },
      narrative: {
        text: 'El 25 % de tus reservas resueltas venció sin check-in (10 de 40). Tu franja con más reservas es el viernes a las 13:00.',
        source: 'llm',
        fallback: null,
      },
    });
  });

  it('si el modelo escribe un número en vez de una clave, responde 200 con plantillas', async () => {
    // 24 existe en las métricas (cambios manuales de mesas), pero como porcentaje es falso.
    llm.result = {
      ok: true,
      text: 'El 24 % de tus reservas resueltas terminó en check-in.',
    };

    const res = await get(PATH, 'owner').expect(200);

    expect(res.body.narrative).toMatchObject({
      source: 'template',
      fallback: 'llm_invalid',
    });
    expect(res.body.narrative.text).not.toContain('24 %');
  });

  it('al modelo solo le llegan números agregados: ni ids, ni correos, ni nombres', async () => {
    await get(PATH, 'owner').expect(200);

    expect(llm.requests).toHaveLength(1);
    const [{ user, system }] = llm.requests;
    expect(user).not.toContain(OWNER_RESTAURANT_ID);
    expect(user).not.toMatch(/@/);
    expect(user).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(JSON.parse(user)).toMatchObject({
      reservas_resueltas: { valor: '40' },
      porcentaje_con_check_in: { valor: '65 %' },
    });
    expect(system).toContain('NUNCA escribas números');
  });

  it('todas las consultas son del restaurante de la sesión', async () => {
    await get(PATH, 'owner').expect(200);

    // Resumen del periodo y del anterior (4 + 4) y actividad del periodo (4).
    expect(queries).toHaveLength(12);
    for (const { params } of queries) {
      expect(params[0]).toBe(OWNER_RESTAURANT_ID);
    }
    const activity = queries.filter(({ sql }) =>
      ['percentile_cont', '"table_logs"', 'GROUP BY 1, 2', 'to_char'].some(
        (marker) => sql.includes(marker),
      ),
    );
    expect(activity).toHaveLength(4);
    for (const { params } of activity) {
      expect(params).toEqual([
        OWNER_RESTAURANT_ID,
        CURRENT_STARTS,
        CURRENT_ENDS,
      ]);
    }
  });

  it('si el modelo falla, responde 200 con plantillas', async () => {
    llm.result = { ok: false, reason: 'el modelo no respondió en 20 s' };

    const res = await get(PATH, 'owner').expect(200);

    expect(res.body.narrative).toMatchObject({
      source: 'template',
      fallback: 'llm_unavailable',
    });
    expect(res.body.narrative.text).toContain('franja con más reservas');
  });

  it('sin llave del modelo, plantillas', async () => {
    llm.enabled = false;

    const res = await get(PATH, 'owner').expect(200);

    expect(res.body.narrative).toMatchObject({
      source: 'template',
      fallback: 'llm_disabled',
    });
    expect(llm.requests).toHaveLength(0);
  });

  it('con pocas reservas resueltas: tasas y nivel en null, sin llamar al modelo', async () => {
    const few = await createApp({ few: true });
    const res = await request(few.app.getHttpServer())
      .get(PATH)
      .set('Authorization', 'Bearer owner')
      .expect(200);

    expect(res.body).toMatchObject({
      dataSufficiency: 'insufficient',
      metrics: {
        resolved: 4,
        checkInRate: null,
        noShowRate: null,
        cancellationRate: null,
      },
      previous: { checkInRate: null },
      reliability: { level: null, reasons: [] },
      narrative: { source: 'template', fallback: 'insufficient_data' },
    });
    expect(few.llm.requests).toHaveLength(0);
    await few.app.close();
  });

  it('la segunda vez sale de la caché; con refresh=true se genera de nuevo', async () => {
    llm.result = {
      ok: true,
      text: 'El {porcentaje_con_check_in} terminó en check-in.',
    };

    await get(PATH, 'owner').expect(200);
    expect(cache.entries.get(`${OWNER_RESTAURANT_ID}:2026-11-17`)?.ttl).toBe(
      3600,
    );
    const firstQueries = queries.length;

    await get(PATH, 'owner').expect(200);
    expect(queries).toHaveLength(firstQueries);
    expect(llm.requests).toHaveLength(1);

    await get(`${PATH}?refresh=true`, 'owner').expect(200);
    expect(queries.length).toBeGreaterThan(firstQueries);
    expect(llm.requests).toHaveLength(2);
  });

  it.each([['refresh=si'], ['from=2026-11-01']])(
    '400 con %s, sin consultar',
    async (query) => {
      await get(`${PATH}?${query}`, 'owner').expect(400);
      expect(queries).toHaveLength(0);
    },
  );

  it.each([
    ['pendingOwner', 'ACCOUNT_PENDING_APPROVAL'],
    ['rejectedOwner', 'ACCOUNT_REJECTED'],
    ['suspendedOwner', 'RESTAURANT_SUSPENDED'],
    ['diner', 'DINER_ACCOUNT'],
    ['platformAdmin', 'ADMIN_ACCOUNT'],
    ['noProfile', 'ACCOUNT_NOT_ENABLED'],
  ] as const)(
    '%s recibe 403 %s, sin consultar ni llamar al modelo',
    async (token, code) => {
      const res = await get(PATH, token).expect(403);

      expect(res.body).toEqual(forbidden(code));
      expect(queries).toHaveLength(0);
      expect(llm.requests).toHaveLength(0);
    },
  );

  it('sin sesión: 401', async () => {
    await get(PATH, null).expect(401);
  });
});
