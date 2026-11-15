import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { DecodedIdToken } from 'firebase-admin/auth';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { FindOperator } from 'typeorm';
import { configureApp } from './../src/app.setup.js';
import { RestaurantApprovalReader } from './../src/modules/identity-access/approval/restaurant-approval.reader.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import {
  ACCOUNT_ERROR_MESSAGES,
  type AccountErrorCode,
  UserRole,
} from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { TableReservations } from './../src/modules/restaurant-operations/index.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { CONTACT_PHONE_INVALID } from './../src/modules/restaurant-operations/restaurants/dto/contact-phone-field.js';
import { ALREADY_REGISTERED_MESSAGE } from './../src/modules/restaurant-operations/restaurants/restaurant-registration.service.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { ALREADY_ENABLED_MESSAGE } from './../src/modules/restaurant-operations/restaurants/restaurant-signup.service.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { TableArea } from './../src/modules/restaurant-operations/table-areas/table-area.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';
import { approvalTestUsers, testUsers } from './support/test-accounts.js';

const OWNER_RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';

const TOKENS: Record<string, Partial<DecodedIdToken>> = {
  // A Firebase account without a users row, with its email in capitals.
  newcomer: { uid: 'uid-new', email: 'Nueva.Duena@Example.com' },
  unverified: {
    uid: 'uid-unverified',
    email: 'sin.verificar@example.com',
    email_verified: false,
  },
  diner: { uid: 'uid-diner', email: 'diner@example.com' },
  owner: { uid: 'uid-owner', email: 'owner@example.com' },
  enabledOwner: { uid: 'uid-enabled', email: 'habilitada@example.com' },
  platformAdmin: { uid: 'uid-admin', email: 'admin@example.com' },
};

const BODY = {
  name: 'La Esquina de Ana',
  category: 'colombian',
  address: 'Calle 72 # 10-34, Bogotá',
  latitude: 4.655671,
  longitude: -74.057006,
  contactPhone: '+57 300 123 4567',
  schedules: [
    { dayOfWeek: 6, isOpen24h: true },
    { dayOfWeek: 1, isOpen24h: false, opensAt: '09:00', closesAt: '22:00' },
  ],
};

function forbidden(code: AccountErrorCode) {
  return {
    statusCode: 403,
    message: ACCOUNT_ERROR_MESSAGES[code],
    error: 'Forbidden',
    errorCode: code,
  };
}

type Row = Record<string, unknown>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) =>
    value instanceof FindOperator && value.type === 'isNull'
      ? row[key] === null
      : row[key] === value,
  );
}

// In-memory users, restaurants and schedules, with the two unique constraints
// of users. A transaction that fails removes what it inserted (rollback). With
// raceSize, each transaction waits until that many have started, so the
// sign-ups really compete (the first insert wins, the others hit the unique).
function createDatabase(raceSize = 1) {
  const users: Row[] = [
    ...testUsers(OWNER_RESTAURANT_ID),
    ...approvalTestUsers(),
    {
      id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      email: 'habilitada@example.com',
      firebaseUid: 'uid-enabled',
      role: UserRole.RESTAURANT_ADMIN,
      displayName: null,
      restaurantId: null,
    },
  ].map((user) => ({ ...user }));
  const restaurants: Row[] = [
    { id: OWNER_RESTAURANT_ID, name: 'Casa 72', approvalStatus: 'approved' },
  ];
  const schedules: Row[] = [];
  let nextId = 1;
  const newId = () =>
    `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;

  function usersStore(inserted: Row[]) {
    return {
      findOneBy: (where: Row) =>
        Promise.resolve(users.find((user) => matches(user, where)) ?? null),
      create: (fields: Row) => ({ ...fields }),
      save: (user: Row) => {
        const clash = users.find(
          (row) =>
            row.id !== user.id &&
            (row.email === user.email ||
              (user.firebaseUid !== null &&
                row.firebaseUid === user.firebaseUid)),
        );
        if (clash) {
          const constraint =
            clash.email === user.email
              ? 'UQ_users_email'
              : 'UQ_users_firebase_uid';
          return Promise.reject({ code: '23505', constraint });
        }
        if (!user.id) {
          user.id = newId();
          users.push(user);
          inserted.push(user);
        }
        return Promise.resolve(user);
      },
    };
  }

  let started = 0;
  let release: () => void = () => undefined;
  const allStarted = new Promise<void>((resolve) => {
    release = resolve;
  });

  const transaction = vi.fn(
    async (work: (manager: unknown) => Promise<unknown>) => {
      started += 1;
      if (started >= raceSize) {
        release();
      }
      await allStarted;
      const inserted: Row[] = [];
      const kinds = new WeakMap<object, string>();
      const manager = {
        getRepository: (target: unknown) => {
          expect(target).toBe(User);
          return usersStore(inserted);
        },
        create: (target: { name: string }, data: Row) => {
          const entity = { ...data };
          kinds.set(entity, target.name);
          return entity;
        },
        save: (entity: Row | Row[]) => {
          if (Array.isArray(entity)) {
            schedules.push(...entity);
            inserted.push(...entity);
            return Promise.resolve(entity);
          }
          expect(kinds.get(entity)).toBe('Restaurant');
          const saved = { ...entity, id: newId() };
          restaurants.push(saved);
          inserted.push(saved);
          return Promise.resolve(saved);
        },
        update: (_target: unknown, where: Row, values: Row) => {
          const rows = users.filter((user) => matches(user, where));
          for (const row of rows) {
            Object.assign(row, values);
          }
          return Promise.resolve({ affected: rows.length });
        },
      };
      try {
        return await work(manager);
      } catch (error) {
        for (const list of [users, restaurants, schedules]) {
          for (const row of inserted) {
            const index = list.indexOf(row);
            if (index >= 0) {
              list.splice(index, 1);
            }
          }
        }
        throw error;
      }
    },
  );

  return { users, restaurants, schedules, transaction, usersStore };
}

describe('POST /v1/restaurants/signup (e2e)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof createDatabase>;

  async function createApp(raceSize = 1) {
    db = createDatabase(raceSize);
    const firebaseAuth = {
      verifyIdToken: (token: string) => {
        const account = TOKENS[token];
        return account
          ? Promise.resolve({ email_verified: true, ...account })
          : Promise.reject(
              Object.assign(new Error('bad token'), {
                code: 'auth/argument-error',
              }),
            );
      },
    };
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
        EventEmitterModule.forRoot(),
        RestaurantOperationsModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => firebaseAuth)
      // The approval of the in-memory restaurants, as the real reader reads it.
      .overrideProvider(RestaurantApprovalReader)
      .useValue({
        statusOf: (id: string) =>
          Promise.resolve(
            db.restaurants.find((row) => row.id === id)?.approvalStatus,
          ),
      })
      .overrideProvider(getRepositoryToken(User))
      .useValue(db.usersStore([]))
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({
        manager: { transaction: db.transaction },
        findOneBy: ({ id }: { id: string }) =>
          Promise.resolve(db.restaurants.find((row) => row.id === id) ?? null),
      })
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({
        find: ({ where }: { where: Row }) =>
          Promise.resolve(db.schedules.filter((row) => matches(row, where))),
      })
      .overrideProvider(getRepositoryToken(Table))
      .useValue({ find: vi.fn().mockResolvedValue([]) })
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableArea))
      .useValue({})
      .overrideProvider(TableReservations)
      .useValue({ countActive: vi.fn().mockResolvedValue(0) })
      .overrideProvider(TableStatusLog)
      .useValue({ record: vi.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }

  afterEach(async () => {
    await app.close();
  });

  const signup = (token: string | null, body: object = BODY) => {
    const req = request(app.getHttpServer())
      .post('/v1/restaurants/signup')
      .send(body);
    return token === null ? req : req.set('Authorization', `Bearer ${token}`);
  };
  const get = (path: string, token: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);

  describe('a Firebase account without profile', () => {
    beforeEach(() => createApp());

    it('201: creates the restaurant pending approval, with its user and schedules', async () => {
      const res = await signup('newcomer').expect(201);

      const restaurantId = res.body.id as string;
      expect(res.body).toEqual({
        id: restaurantId,
        name: 'La Esquina de Ana',
        category: 'colombian',
        address: 'Calle 72 # 10-34, Bogotá',
        latitude: 4.655671,
        longitude: -74.057006,
        schedules: [
          {
            dayOfWeek: 1,
            isOpen24h: false,
            opensAt: '09:00',
            closesAt: '22:00',
          },
          { dayOfWeek: 6, isOpen24h: true, opensAt: null, closesAt: null },
        ],
        activeReservationsCount: 0,
        approvalStatus: 'pending',
        rejectionReason: null,
        contactPhone: '+573001234567',
      });
      const created = db.users.filter((user) => user.firebaseUid === 'uid-new');
      expect(created).toEqual([
        expect.objectContaining({
          email: 'nueva.duena@example.com',
          role: UserRole.RESTAURANT_ADMIN,
          displayName: null,
          restaurantId,
        }),
      ]);
    });

    it('then the account exists: GET /v1/me answers it and the restaurant sees itself pending', async () => {
      const { body } = await signup('newcomer').expect(201);

      const me = await get('/v1/me', 'newcomer').expect(200);
      expect(me.body).toMatchObject({
        email: 'nueva.duena@example.com',
        role: 'restaurant_admin',
        restaurantId: body.id,
      });
      const mine = await get('/v1/restaurants/me', 'newcomer').expect(200);
      expect(mine.body.approvalStatus).toBe('pending');
    });

    it('then it does not operate yet: 403 ACCOUNT_PENDING_APPROVAL', async () => {
      await signup('newcomer').expect(201);

      const res = await get('/v1/tables', 'newcomer').expect(403);

      expect(res.body).toEqual(forbidden('ACCOUNT_PENDING_APPROVAL'));
    });

    it('a second sign-up of the same account answers 409 and creates nothing', async () => {
      await signup('newcomer').expect(201);

      // The account is now a restaurant with its restaurant (pending): no
      // @Roles here, so the service answers as the account that exists.
      const res = await signup('newcomer').expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        message: ALREADY_REGISTERED_MESSAGE,
        error: 'Conflict',
      });
      expect(db.users.filter((u) => u.firebaseUid === 'uid-new')).toHaveLength(
        1,
      );
      expect(
        db.restaurants.filter((row) => row.name === 'La Esquina de Ana'),
      ).toHaveLength(1);
    });
  });

  describe('two sign-ups of the same account at once', () => {
    beforeEach(() => createApp(2));

    it('one wins (201), the other gets a clean 409, and nothing is left half-done', async () => {
      const results = await Promise.all([
        signup('newcomer'),
        signup('newcomer'),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      const loser = results.find((res) => res.status === 409);
      expect(loser?.body).toEqual({
        statusCode: 409,
        message: ALREADY_REGISTERED_MESSAGE,
        error: 'Conflict',
      });
      expect(db.users.filter((u) => u.firebaseUid === 'uid-new')).toHaveLength(
        1,
      );
      expect(
        db.restaurants.filter((row) => row.name === 'La Esquina de Ana'),
      ).toHaveLength(1);
      expect(db.schedules).toHaveLength(2);
    });
  });

  describe('an account that already exists: nothing is created', () => {
    beforeEach(() => createApp());

    it.each<[string, AccountErrorCode]>([
      ['diner', 'DINER_ACCOUNT'],
      ['platformAdmin', 'ADMIN_ACCOUNT'],
    ])('%s → 403 %s', async (token, code) => {
      const res = await signup(token).expect(403);

      expect(res.body).toEqual(forbidden(code));
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['a restaurant with its restaurant', 'owner', ALREADY_REGISTERED_MESSAGE],
      [
        'a restaurant enabled by the team',
        'enabledOwner',
        ALREADY_ENABLED_MESSAGE,
      ],
    ])('%s → 409 without errorCode', async (_case, token, message) => {
      const res = await signup(token).expect(409);

      expect(res.body).toEqual({ statusCode: 409, message, error: 'Conflict' });
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('session and validation', () => {
    beforeEach(() => createApp());

    it('401 without a session', async () => {
      await signup(null).expect(401);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('401 EMAIL_NOT_VERIFIED for an unverified account', async () => {
      const res = await signup('unverified').expect(401);

      expect(res.body.errorCode).toBe('EMAIL_NOT_VERIFIED');
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', { ...BODY, contactPhone: undefined }],
      ['too short', { ...BODY, contactPhone: '12345' }],
      ['with letters', { ...BODY, contactPhone: '300 ABC 4567' }],
    ])('400 for a contact phone %s', async (_case, body) => {
      const res = await signup('newcomer', body).expect(400);

      expect(res.body.message).toEqual([CONTACT_PHONE_INVALID]);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('400 for invalid schedules, with the rules of the registration', async () => {
      const res = await signup('newcomer', { ...BODY, schedules: [] }).expect(
        400,
      );

      expect(res.body.message.length).toBeGreaterThan(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('400 if the client tries to choose its approval', async () => {
      const res = await signup('newcomer', {
        ...BODY,
        approvalStatus: 'approved',
      }).expect(400);

      expect(res.body.message).toEqual([
        'El campo "approvalStatus" no se permite. Quítalo de la solicitud.',
      ]);
    });
  });

  describe('POST /v1/restaurants (enabled by the team) is unchanged but explicit', () => {
    beforeEach(() => createApp());

    it('creates the restaurant approved, with the optional contact phone', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/restaurants')
        .set('Authorization', 'Bearer enabledOwner')
        .send(BODY)
        .expect(201);

      expect(res.body).toMatchObject({
        approvalStatus: 'approved',
        rejectionReason: null,
        contactPhone: '+573001234567',
      });
      expect(
        db.restaurants.find((row) => row.id === res.body.id),
      ).toMatchObject({ approvalStatus: 'approved' });
    });
  });

  it('documents the route in Swagger', async () => {
    await createApp();
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const route = res.body.paths['/v1/restaurants/signup'];

    expect(Object.keys(route)).toEqual(['post']);
    expect(res.body.components.schemas.SignupRestaurantDto.required).toContain(
      'contactPhone',
    );
    expect(Object.keys(route.post.responses).sort()).toEqual([
      '201',
      '400',
      '401',
      '403',
      '409',
    ]);
  });
});
