import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  UpdateQueryBuilder,
  type DataSource,
  type FindOperator,
} from 'typeorm';
import { configureApp } from './../src/app.setup.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import {
  ACCOUNT_ERROR_MESSAGES,
  UserRole,
} from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationsCheckinModule } from './../src/modules/reservations-checkin/index.js';
import { ReservationExpirationService } from './../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { Reservation } from './../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { Clock } from './../src/modules/search-availability/index.js';
import { FakeDatabaseModule, type Row } from './support/fake-database.js';
import {
  fakeFirebaseAuth,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';
import { createMetadataOnlyDataSource } from './support/typeorm-metadata.js';

// La capa HTTP real: controlador, pipes, guards, CheckInService y su SQL armado
// por TypeORM. Solo se reemplaza la ida a la base (el comportamiento real contra
// Postgres lo cubre test/db/check-ins.db-spec.ts).

// Viernes 2026-10-16 13:00 en Bogotá.
const NOW = new Date('2026-10-16T18:00:00Z');

const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
const OTHER_RESTAURANT_ID = '66cc1593-cf2f-4a1c-8ca9-8644446e069c';
const TABLE_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const SECOND_TABLE_ID = '7b6c5d4e-3f2a-4b1c-8d9e-8f7a6b5c4d3e';
const ACTIVE_ID = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const SOON_ID = '11111111-1111-4111-8111-111111111111';
const NAMELESS_DINER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EMAIL_NAMED_DINER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const CODE_NOT_FOUND = {
  statusCode: 404,
  message: 'No encontramos una reserva con ese código en tu restaurante.',
  error: 'Not Found',
  errorCode: 'RESERVATION_CODE_NOT_FOUND',
};

const at = (iso: string) => new Date(iso);

const reservation = (id: string, code: string, overrides: Row = {}): Row => ({
  id,
  code,
  status: 'active',
  partySize: 2,
  dinerId: DINER_ID,
  restaurantId: RESTAURANT_ID,
  tableId: TABLE_ID,
  createdAt: at('2026-10-16T17:50:00Z'),
  expiresAt: at('2026-10-16T18:05:00Z'),
  cancelledAt: null,
  expiredAt: null,
  checkedInAt: null,
  noShow: false,
  ...overrides,
});

describe('Check-in y reservas del restaurante (e2e)', () => {
  let app: INestApplication<App>;
  let stored: Row[];
  let metadataDataSource: DataSource;

  const expiration = {
    expireIfDue: vi.fn((id: string) => {
      stored
        .filter(
          (row) =>
            row.id === id &&
            row.status === 'active' &&
            (row.expiresAt as Date) <= NOW,
        )
        .forEach((row) => Object.assign(row, { status: 'expired' }));
      return Promise.resolve(0);
    }),
    expireDueForRestaurant: vi.fn((restaurantId: string) => {
      stored
        .filter(
          (row) =>
            row.restaurantId === restaurantId &&
            row.status === 'active' &&
            (row.expiresAt as Date) <= NOW,
        )
        .forEach((row) => Object.assign(row, { status: 'expired' }));
      return Promise.resolve(0);
    }),
  };
  const statusLog = { record: vi.fn(() => Promise.resolve()) };
  const checkInsRepo = { insert: vi.fn(() => Promise.resolve({})) };
  const tablesRepo = {
    update: vi.fn(() => Promise.resolve({ affected: 1 })),
    find: vi.fn(({ where }: { where: { id: FindOperator<string> } }) => {
      const ids = where.id.value as unknown as string[];
      return Promise.resolve(
        [
          { id: TABLE_ID, identifier: '04' },
          { id: SECOND_TABLE_ID, identifier: 'T1' },
        ].filter((table) => ids.includes(table.id)),
      );
    }),
  };

  const whereMatches = (row: Row, where: Row) =>
    Object.entries(where).every(([column, value]) => row[column] === value);
  const reservationsRepo = {
    findOne: vi.fn(({ where }: { where: Row }) =>
      Promise.resolve(
        stored
          .filter((row) => whereMatches(row, where))
          .sort(
            (a, b) =>
              (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          )[0] ?? null,
      ),
    ),
    findOneOrFail: vi.fn(({ where }: { where: Row }) =>
      Promise.resolve(stored.find((row) => whereMatches(row, where))),
    ),
    // Como Postgres con el SELECT y el ORDER BY de la consulta.
    find: vi.fn(
      ({ where, select }: { where: Row; select: Record<string, true> }) =>
        Promise.resolve(
          stored
            .filter((row) => whereMatches(row, where))
            .sort(
              (a, b) =>
                (a.expiresAt as Date).getTime() -
                (b.expiresAt as Date).getTime(),
            )
            .map((row) =>
              Object.fromEntries(
                Object.keys(select).map((column) => [column, row[column]]),
              ),
            ),
        ),
    ),
  };

  beforeAll(async () => {
    metadataDataSource = await createMetadataOnlyDataSource();
  });

  beforeEach(async () => {
    stored = [
      reservation(ACTIVE_ID, 'K7M4QX'),
      reservation('22222222-2222-4222-8222-222222222222', 'EXPRD2', {
        status: 'expired',
        // 12:41 en Bogotá.
        expiresAt: at('2026-10-16T17:41:00Z'),
        expiredAt: at('2026-10-16T17:59:00Z'),
      }),
      reservation('33333333-3333-4333-8333-333333333333', 'USADA3', {
        status: 'completed',
        // 12:35 en Bogotá.
        checkedInAt: at('2026-10-16T17:35:00Z'),
      }),
      reservation('44444444-4444-4444-8444-444444444444', 'CANCE4', {
        status: 'cancelled',
      }),
      // Activa, pero su hora ya pasó y nadie la barrió. 12:59 en Bogotá.
      reservation('55555555-5555-4555-8555-555555555555', 'VENC55', {
        expiresAt: at('2026-10-16T17:59:00Z'),
      }),
      reservation('66666666-6666-4666-8666-666666666666', 'AJENA6', {
        restaurantId: OTHER_RESTAURANT_ID,
      }),
    ];
    vi.clearAllMocks();

    vi.spyOn(UpdateQueryBuilder.prototype, 'execute').mockImplementation(
      function (this: UpdateQueryBuilder<Reservation>) {
        const [sql, params] = this.getQueryAndParameters();
        const row = stored.find((r) => r.id === params[2]);
        const hits =
          row !== undefined &&
          row.status === 'active' &&
          row.restaurantId === params[3] &&
          (row.expiresAt as Date) > (params[4] as Date);
        if (!hits) {
          return Promise.resolve({ raw: [], affected: 0, generatedMaps: [] });
        }
        Object.assign(row, { status: 'completed', checkedInAt: params[1] });
        expect(sql).toMatch(/RETURNING "id", "table_id"$/);
        return Promise.resolve({
          raw: [{ id: row.id, table_id: row.tableId }],
          affected: 1,
          generatedMaps: [],
        });
      } as never,
    );

    const manager = {
      createQueryBuilder: () => metadataDataSource.createQueryBuilder(),
      getRepository: (target: unknown) =>
        target === CheckIn ? checkInsRepo : tablesRepo,
    };
    const users = [
      ...testUsers(RESTAURANT_ID),
      {
        id: NAMELESS_DINER_ID,
        email: 'ana.perez@example.com',
        role: UserRole.DINER,
        displayName: null,
        restaurantId: null,
      } as User,
      // El valor por defecto de POST /v1/diners/me: el correo antes de @.
      {
        id: EMAIL_NAMED_DINER_ID,
        email: 'ana.perez@example.com',
        role: UserRole.DINER,
        displayName: 'ana.perez',
        restaurantId: null,
      } as User,
    ];
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
          {
            Reservation: reservationsRepo as never,
            Table: tablesRepo as never,
          },
          {
            transaction: (work: (m: unknown) => Promise<unknown>) =>
              work(manager),
          },
        ),
        EventEmitterModule.forRoot(),
        ReservationsCheckinModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => ({
        // Un restaurante habilitado que todavía no registró su restaurante.
        verifyIdToken: (token: string) =>
          token === 'ownerWithoutRestaurant'
            ? Promise.resolve({
                uid: 'uid-bare',
                email: 'bare@example.com',
                email_verified: true,
              })
            : fakeFirebaseAuth.verifyIdToken(token),
      }))
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        ...usersRepository([
          ...users,
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            email: 'bare@example.com',
            firebaseUid: 'uid-bare',
            role: UserRole.RESTAURANT_ADMIN,
            displayName: null,
            restaurantId: null,
          } as User,
        ]),
        // Como Postgres con el SELECT de la consulta: solo las columnas pedidas.
        find: ({
          where,
          select,
        }: {
          where: { id: FindOperator<string> };
          select: Record<string, true>;
        }) =>
          Promise.resolve(
            users
              .filter((user) =>
                (where.id.value as unknown as string[]).includes(user.id),
              )
              .map((user) =>
                Object.fromEntries(
                  Object.keys(select).map((column) => [
                    column,
                    user[column as keyof User],
                  ]),
                ),
              ),
          ),
      })
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({})
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(Reservation))
      .useValue({})
      .overrideProvider(getRepositoryToken(CheckIn))
      .useValue({})
      .overrideProvider(ReservationExpirationService)
      .useValue(expiration)
      .overrideProvider(TableStatusLog)
      .useValue(statusLog)
      .overrideProvider(Clock)
      .useValue({ now: () => NOW })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const checkIn = (body: unknown, token = 'owner') =>
    request(app.getHttpServer())
      .post('/v1/restaurants/me/check-ins')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  const list = (query = '', token = 'owner') =>
    request(app.getHttpServer())
      .get(`/v1/restaurants/me/reservations${query}`)
      .set('Authorization', `Bearer ${token}`);

  describe('POST /v1/restaurants/me/check-ins', () => {
    it('200 con la forma exacta de §12.8', async () => {
      const res = await checkIn({ code: 'K7M4QX' }).expect(200);

      expect(res.body).toEqual({
        reservationId: ACTIVE_ID,
        tableIdentifier: '04',
        partySize: 2,
        dinerName: 'Comensal',
        checkedInAt: NOW.toISOString(),
      });
    });

    it('acepta el código en minúsculas y con espacios', async () => {
      const res = await checkIn({ code: ' k7m 4qx ' }).expect(200);

      expect(res.body.reservationId).toBe(ACTIVE_ID);
    });

    it('escribe la mesa, la bitácora y check_ins', async () => {
      await checkIn({ code: 'K7M4QX' }).expect(200);

      expect(tablesRepo.update).toHaveBeenCalledWith(
        { id: TABLE_ID, status: 'reserved' },
        { status: 'occupied' },
      );
      expect(statusLog.record).toHaveBeenCalledTimes(1);
      expect(checkInsRepo.insert).toHaveBeenCalledWith({
        reservationId: ACTIVE_ID,
        restaurantId: RESTAURANT_ID,
        checkedInAt: NOW,
      });
    });

    it('no emite RESTAURANT_AVAILABILITY_AFFECTED: reserved → occupied no cambia las mesas libres', async () => {
      const emitted: unknown[] = [];
      app.get(EventEmitter2).onAny((event) => emitted.push(event));

      await checkIn({ code: 'K7M4QX' }).expect(200);

      expect(emitted).toEqual([
        'reservation.checked_in',
        'table.status-changed',
      ]);
    });

    it('repetir el check-in responde 409 RESERVATION_ALREADY_USED', async () => {
      await checkIn({ code: 'K7M4QX' }).expect(200);

      const res = await checkIn({ code: 'K7M4QX' }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        // 18:00Z son las 13:00 en Bogotá.
        message: 'Este código ya se usó a las 13:00.',
        error: 'Conflict',
        errorCode: 'RESERVATION_ALREADY_USED',
      });
    });

    it.each([
      ['falta code', {}],
      ['code numérico', { code: 123456 }],
      ['code null', { code: null }],
      ['code en una lista', { code: ['K7M4QX'] }],
    ])('400: %s', async (_case, body) => {
      const res = await checkIn(body).expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message: [
          'Escribe el código de la reserva que te muestra el comensal.',
        ],
        error: 'Bad Request',
      });
    });

    it('400: un campo que no existe', async () => {
      await checkIn({ code: 'K7M4QX', restaurantId: RESTAURANT_ID }).expect(
        400,
      );
    });

    it.each([
      ['no existe', '222222'],
      ['es de otro restaurante', 'AJENA6'],
      ['tiene letras que no están en el alfabeto', 'K7MLOI'],
      ['es corto', 'K7M'],
      ['está vacío', ''],
    ])('404 RESERVATION_CODE_NOT_FOUND si %s', async (_case, code) => {
      const res = await checkIn({ code }).expect(404);

      expect(res.body).toEqual(CODE_NOT_FOUND);
    });

    it('409 RESERVATION_EXPIRED con la hora de expires_at en Bogotá', async () => {
      const res = await checkIn({ code: 'EXPRD2' }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        message: 'Esta reserva se venció a las 12:41. La mesa ya se liberó.',
        error: 'Conflict',
        errorCode: 'RESERVATION_EXPIRED',
      });
    });

    it('409 RESERVATION_ALREADY_USED con la hora de checked_in_at en Bogotá', async () => {
      const res = await checkIn({ code: 'USADA3' }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        message: 'Este código ya se usó a las 12:35.',
        error: 'Conflict',
        errorCode: 'RESERVATION_ALREADY_USED',
      });
    });

    it('409 RESERVATION_CANCELLED con el mensaje de §12.6', async () => {
      const res = await checkIn({ code: 'CANCE4' }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        message: 'El comensal canceló esta reserva.',
        error: 'Conflict',
        errorCode: 'RESERVATION_CANCELLED',
      });
    });

    it('una activa vencida sin barrer se vence y responde 409 RESERVATION_EXPIRED', async () => {
      const res = await checkIn({ code: 'VENC55' }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        message: 'Esta reserva se venció a las 12:59. La mesa ya se liberó.',
        error: 'Conflict',
        errorCode: 'RESERVATION_EXPIRED',
      });
      expect(expiration.expireIfDue).toHaveBeenCalledWith(
        '55555555-5555-4555-8555-555555555555',
      );
      expect(checkInsRepo.insert).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/restaurants/me/reservations', () => {
    it('200 con la forma exacta de §12.8 y sin campo code', async () => {
      const res = await list().expect(200);

      expect(res.body).toEqual([
        {
          id: ACTIVE_ID,
          status: 'active',
          partySize: 2,
          dinerName: 'Comensal',
          tableId: TABLE_ID,
          tableIdentifier: '04',
          createdAt: '2026-10-16T17:50:00.000Z',
          expiresAt: '2026-10-16T18:05:00.000Z',
          serverTime: NOW.toISOString(),
        },
      ]);
      expect(res.body[0]).not.toHaveProperty('code');
      expect(JSON.stringify(res.body)).not.toContain('K7M4QX');
    });

    it('vence las debidas antes de responder: la vencida sin barrer sale en expired y no en active', async () => {
      const active = await list().expect(200);
      const expired = await list('?status=expired').expect(200);

      expect(expiration.expireDueForRestaurant).toHaveBeenCalledWith(
        RESTAURANT_ID,
      );
      expect(active.body.map((r: Row) => r.id)).toEqual([ACTIVE_ID]);
      expect(expired.body.map((r: Row) => r.id)).toContain(
        '55555555-5555-4555-8555-555555555555',
      );
    });

    it('ordena de la más próxima a vencer a la más lejana, con el mismo serverTime y sin código en ninguna', async () => {
      stored.push(
        reservation(SOON_ID, 'PRKNT2', {
          tableId: SECOND_TABLE_ID,
          expiresAt: at('2026-10-16T18:02:00Z'),
        }),
      );

      const res = await list().expect(200);

      expect(res.body.map((r: Row) => r.id)).toEqual([SOON_ID, ACTIVE_ID]);
      expect(res.body.map((r: Row) => r.tableIdentifier)).toEqual(['T1', '04']);
      expect(new Set(res.body.map((r: Row) => r.serverTime)).size).toBe(1);
      expect(JSON.stringify(res.body)).not.toContain('"code"');
    });

    it.each([
      ['cancelled', 'CANCE4'],
      ['completed', 'USADA3'],
      ['expired', 'EXPRD2'],
    ])(
      'filtra por status=%s y tampoco trae el código',
      async (status, code) => {
        const res = await list(`?status=${status}`).expect(200);

        expect(res.body.length).toBeGreaterThan(0);
        for (const row of res.body as Row[]) {
          expect(row.status).toBe(status);
          expect(row).not.toHaveProperty('code');
        }
        expect(JSON.stringify(res.body)).not.toContain(code);
      },
    );

    it('no incluye las reservas de otro restaurante', async () => {
      const res = await list().expect(200);

      expect(JSON.stringify(res.body)).not.toContain(
        '66666666-6666-4666-8666-666666666666',
      );
    });

    it.each(['?status=otra', '?status=', '?status=active&status=expired'])(
      '400 en español con %s',
      async (query) => {
        const res = await list(query).expect(400);

        expect(res.body).toEqual({
          statusCode: 400,
          message: [
            'El estado de la reserva debe ser uno de estos: active, cancelled, expired, completed.',
          ],
          error: 'Bad Request',
        });
      },
    );

    it('400 con un parámetro que no existe: el restaurante sale de la sesión', async () => {
      await list(`?restaurantId=${OTHER_RESTAURANT_ID}`).expect(400);
    });
  });

  // §12.8: lo que ve el restaurante es displayName o null, nunca el correo.
  describe.each([
    ['sin displayName', NAMELESS_DINER_ID],
    ['con displayName igual al correo antes de @', EMAIL_NAMED_DINER_ID],
  ])('dinerName de un comensal %s', (_case, dinerId) => {
    const expectNoEmail = (body: unknown) => {
      const json = JSON.stringify(body).toLowerCase();
      expect(json).not.toContain('ana');
      expect(json).not.toContain('perez');
      expect(json).not.toContain('example.com');
    };

    beforeEach(() => {
      stored.length = 0;
      stored.push(reservation(ACTIVE_ID, 'K7M4QX', { dinerId }));
    });

    it('el check-in responde dinerName null y ningún fragmento del correo', async () => {
      const res = await checkIn({ code: 'K7M4QX' }).expect(200);

      expect(res.body.dinerName).toBeNull();
      expectNoEmail(res.body);
    });

    it('la lista responde dinerName null y ningún fragmento del correo', async () => {
      const res = await list().expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].dinerName).toBeNull();
      expectNoEmail(res.body);
    });
  });

  describe.each([
    ['post', '/v1/restaurants/me/check-ins'],
    ['get', '/v1/restaurants/me/reservations'],
  ] as const)('%s %s: cuentas', (method, path) => {
    const call = (token?: string) => {
      const pending = request(app.getHttpServer())[method](path);
      if (method === 'post') {
        void pending.send({ code: 'K7M4QX' });
      }
      return token ? pending.set('Authorization', `Bearer ${token}`) : pending;
    };

    it('401 sin token', async () => {
      await call().expect(401);
    });

    it('401 con un token inválido', async () => {
      await call('malo').expect(401);
    });

    it('403 DINER_ACCOUNT si quien llama es un comensal', async () => {
      const res = await call('diner').expect(403);

      expect(res.body).toEqual({
        statusCode: 403,
        message: ACCOUNT_ERROR_MESSAGES.DINER_ACCOUNT,
        error: 'Forbidden',
        errorCode: 'DINER_ACCOUNT',
      });
    });

    it('403 ACCOUNT_NOT_ENABLED si la cuenta no tiene perfil', async () => {
      const res = await call('noProfile').expect(403);

      expect(res.body.errorCode).toBe('ACCOUNT_NOT_ENABLED');
    });

    it('403 RESTAURANT_REQUIRED si todavía no registra su restaurante', async () => {
      const res = await call('ownerWithoutRestaurant').expect(403);

      expect(res.body).toEqual({
        statusCode: 403,
        message: 'Primero registra tu restaurante.',
        error: 'Forbidden',
        errorCode: 'RESTAURANT_REQUIRED',
      });
    });
  });
});
