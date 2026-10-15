import {
  Controller,
  Get,
  INestApplication,
  Module,
  UseGuards,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { DecodedIdToken } from 'firebase-admin/auth';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import {
  CurrentUserGuard,
  IdentityAccessModule,
  Roles,
  UserRole,
} from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';

// Contract texts (CLAUDE.md, section 10, "Códigos de cuenta").
const MESSAGES = {
  SESSION: 'Tu sesión terminó. Inicia sesión de nuevo.',
  EMAIL_NOT_VERIFIED: 'Verifica tu correo para continuar.',
  ACCOUNT_NOT_ENABLED:
    'Esta cuenta no está habilitada como restaurante. Si eres comensal, encuentra mesa desde la app DiNNo.',
  PROFILE_REQUIRED: 'Completa tu perfil para continuar.',
  DINER_ACCOUNT:
    'Esta es una cuenta de comensal. Para buscar mesa, usa la app DiNNo.',
  RESTAURANT_ACCOUNT:
    'Esta es una cuenta de restaurante. Administra tu restaurante desde la web.',
  RESTAURANT_REQUIRED: 'Primero registra tu restaurante.',
};

function forbidden(code: keyof typeof MESSAGES) {
  return {
    statusCode: 403,
    message: MESSAGES[code],
    error: 'Forbidden',
    errorCode: code,
  };
}

// Firebase accounts, by token.
const TOKENS: Record<string, Partial<DecodedIdToken>> = {
  owner: { uid: 'uid-owner', email: 'owner@example.com' },
  newcomer: { uid: 'uid-newcomer', email: 'newcomer@example.com' },
  diner: { uid: 'uid-diner', email: 'diner@example.com' },
  // Enabled restaurant whose first login has not happened yet.
  enabled: { uid: 'uid-enabled', email: 'Enabled@Example.com' },
  google: {
    uid: 'uid-google',
    email: 'Ana.Gomez@Example.com',
    name: 'Ana Gómez',
  },
  plain: { uid: 'uid-plain', email: 'sin.nombre@example.com' },
  unverified: {
    uid: 'uid-unverified',
    email: 'nueva@example.com',
    email_verified: false,
  },
};

function seedUsers(): User[] {
  const row = (fields: Partial<User>) =>
    ({ displayName: null, restaurantId: null, ...fields }) as User;
  return [
    row({
      id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      email: 'owner@example.com',
      firebaseUid: 'uid-owner',
      role: UserRole.RESTAURANT_ADMIN,
      restaurantId: RESTAURANT_ID,
    }),
    row({
      id: '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718',
      email: 'newcomer@example.com',
      firebaseUid: 'uid-newcomer',
      role: UserRole.RESTAURANT_ADMIN,
    }),
    row({
      id: '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a',
      email: 'diner@example.com',
      firebaseUid: 'uid-diner',
      role: UserRole.DINER,
      displayName: 'Comensal',
    }),
    row({
      id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      email: 'enabled@example.com',
      firebaseUid: null,
      role: UserRole.RESTAURANT_ADMIN,
    }),
  ];
}

// In-memory users table with its two unique constraints.
function usersRepository(rows: User[]) {
  let nextId = 1;
  const matches = (user: User, where: Partial<User>) =>
    Object.entries(where).every(
      ([key, value]) => user[key as keyof User] === value,
    );
  return {
    findOneBy: (where: Partial<User>) =>
      Promise.resolve(rows.find((user) => matches(user, where)) ?? null),
    create: (fields: Partial<User>) => ({ ...fields }) as User,
    save: (user: User) => {
      const clash = rows.find(
        (row) =>
          row.id !== user.id &&
          (row.email === user.email ||
            (user.firebaseUid !== null &&
              row.firebaseUid === user.firebaseUid)),
      );
      if (clash) {
        return Promise.reject({ code: '23505' });
      }
      if (!user.id) {
        user.id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
        rows.push(user);
      }
      return Promise.resolve(user);
    },
  };
}

// Stand-in for the diner endpoints of later branches (search, public detail).
@Roles(UserRole.DINER)
@UseGuards(CurrentUserGuard)
@Controller('diner-probe')
class DinerProbeController {
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [IdentityAccessModule],
  controllers: [DinerProbeController],
})
class DinerProbeModule {}

describe('Accounts and roles (e2e)', () => {
  let app: INestApplication<App>;
  let users: User[];
  let tables: {
    find: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    manager: { transaction: ReturnType<typeof vi.fn> };
  };
  let restaurants: {
    findOneBy: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    manager: { transaction: ReturnType<typeof vi.fn> };
  };
  let logs: { createQueryBuilder: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    users = seedUsers();
    tables = {
      find: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      save: vi.fn(),
      manager: { transaction: vi.fn() },
    };
    restaurants = {
      findOneBy: vi.fn(),
      update: vi.fn(),
      manager: { transaction: vi.fn() },
    };
    logs = { createQueryBuilder: vi.fn() };
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
        RestaurantOperationsModule,
        DinerProbeModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => firebaseAuth)
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepository(users))
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue(restaurants)
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({ find: vi.fn() })
      .overrideProvider(getRepositoryToken(Table))
      .useValue(tables)
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue(logs)
      .overrideProvider(TableStatusLog)
      .useValue({ record: vi.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (token: string) => `Bearer ${token}`;

  describe('account codes (contract table)', () => {
    it('401 without errorCode for a missing or invalid token', async () => {
      for (const authorization of [undefined, as('not-a-firebase-token')]) {
        const call = request(app.getHttpServer()).get('/v1/tables');
        const res = await (
          authorization ? call.set('Authorization', authorization) : call
        ).expect(401);
        expect(res.body).toEqual({
          statusCode: 401,
          message: MESSAGES.SESSION,
          error: 'Unauthorized',
        });
      }
    });

    it('401 EMAIL_NOT_VERIFIED for an unlinked account with an unverified email', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', as('unverified'))
        .expect(401);

      expect(res.body).toEqual({
        statusCode: 401,
        message: MESSAGES.EMAIL_NOT_VERIFIED,
        error: 'Unauthorized',
        errorCode: 'EMAIL_NOT_VERIFIED',
      });
    });

    it('403 ACCOUNT_NOT_ENABLED for an account without profile on a restaurant endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/tables')
        .set('Authorization', as('google'))
        .expect(403);

      expect(res.body).toEqual(forbidden('ACCOUNT_NOT_ENABLED'));
      expect(users.map((user) => user.email)).not.toContain(
        'ana.gomez@example.com',
      );
    });

    it('403 PROFILE_REQUIRED for an account without profile on a diner endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/diner-probe')
        .set('Authorization', as('google'))
        .expect(403);

      expect(res.body).toEqual(forbidden('PROFILE_REQUIRED'));
    });

    it('403 DINER_ACCOUNT for a diner on a restaurant endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/tables')
        .set('Authorization', as('diner'))
        .expect(403);

      expect(res.body).toEqual(forbidden('DINER_ACCOUNT'));
    });

    it('403 RESTAURANT_ACCOUNT for a restaurant on a diner endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/diner-probe')
        .set('Authorization', as('owner'))
        .expect(403);

      expect(res.body).toEqual(forbidden('RESTAURANT_ACCOUNT'));
    });

    it('403 RESTAURANT_REQUIRED, unchanged, for an enabled restaurant without a restaurant', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/tables')
        .set('Authorization', as('newcomer'))
        .expect(403);

      expect(res.body).toEqual(forbidden('RESTAURANT_REQUIRED'));
    });

    it('lets the restaurant and the diner through their own endpoints', async () => {
      await request(app.getHttpServer())
        .get('/v1/tables')
        .set('Authorization', as('owner'))
        .expect(200)
        .expect([]);
      await request(app.getHttpServer())
        .get('/v1/diner-probe')
        .set('Authorization', as('diner'))
        .expect(200);
    });

    it('links an enabled restaurant email on its first login', async () => {
      await request(app.getHttpServer())
        .get('/v1/tables')
        .set('Authorization', as('enabled'))
        .expect(403)
        .expect(forbidden('RESTAURANT_REQUIRED'));

      expect(
        users.find((user) => user.email === 'enabled@example.com')?.firebaseUid,
      ).toBe('uid-enabled');
    });
  });

  describe('a diner cannot read or change restaurant data', () => {
    it.each<[string, string, object?]>([
      ['get', '/v1/tables'],
      ['post', '/v1/tables', { identifier: '04', capacity: 4 }],
      ['patch', `/v1/tables/${TABLE_ID}/status`, { status: 'occupied' }],
      ['patch', `/v1/tables/${TABLE_ID}`, { capacity: 2 }],
      ['post', `/v1/tables/${TABLE_ID}/deactivate`],
      ['post', `/v1/tables/${TABLE_ID}/reactivate`],
      ['post', '/v1/restaurants', { name: 'Nuevo' }],
      ['get', '/v1/restaurants/me'],
      ['patch', '/v1/restaurants/me', { name: 'Otro' }],
      ['get', '/v1/restaurants/me/status'],
      ['patch', '/v1/restaurants/me/status', { isOpen: false }],
      ['get', '/v1/table-logs'],
    ])('%s %s → 403 DINER_ACCOUNT', async (method, path, body) => {
      const call = request(app.getHttpServer())
        [method as 'get' | 'post' | 'patch'](path)
        .set('Authorization', as('diner'));
      const res = await (body ? call.send(body) : call).expect(403);

      expect(res.body).toEqual(forbidden('DINER_ACCOUNT'));
      for (const spy of [
        tables.find,
        tables.save,
        tables.manager.transaction,
        restaurants.findOneBy,
        restaurants.update,
        restaurants.manager.transaction,
        logs.createQueryBuilder,
      ]) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });

  describe('GET /v1/me', () => {
    it('answers a restaurant account', async () => {
      await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', as('owner'))
        .expect(200)
        .expect({
          id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          email: 'owner@example.com',
          displayName: null,
          role: UserRole.RESTAURANT_ADMIN,
          restaurantId: RESTAURANT_ID,
        });
    });

    it('answers a diner account', async () => {
      await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', as('diner'))
        .expect(200)
        .expect({
          id: '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a',
          email: 'diner@example.com',
          displayName: 'Comensal',
          role: UserRole.DINER,
          restaurantId: null,
        });
    });

    it('answers 403 PROFILE_REQUIRED without profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', as('google'))
        .expect(403);

      expect(res.body).toEqual(forbidden('PROFILE_REQUIRED'));
    });
  });

  describe('POST /v1/diners/me', () => {
    it('creates the diner (201), then answers the same profile (200) without changes', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/diners/me')
        .set('Authorization', as('google'))
        .send({ displayName: '  Ana  ' })
        .expect(201);

      expect(created.body).toEqual({
        id: expect.any(String),
        email: 'ana.gomez@example.com',
        displayName: 'Ana',
        role: UserRole.DINER,
        restaurantId: null,
      });

      const repeated = await request(app.getHttpServer())
        .post('/v1/diners/me')
        .set('Authorization', as('google'))
        .send({ displayName: 'Otro nombre' })
        .expect(200);

      expect(repeated.body).toEqual(created.body);
      await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', as('google'))
        .expect(200)
        .expect(created.body);
    });

    it('defaults displayName to the Google account name', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/diners/me')
        .set('Authorization', as('google'))
        .expect(201);

      expect(res.body.displayName).toBe('Ana Gómez');
    });

    it('defaults displayName to the email before the @ without a Google name', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/diners/me')
        .set('Authorization', as('plain'))
        .send({})
        .expect(201);

      expect(res.body.displayName).toBe('sin.nombre');
    });

    it.each([
      ['a linked restaurant account', 'owner'],
      ['an enabled restaurant email not linked yet', 'enabled'],
    ])('rejects %s with 403 RESTAURANT_ACCOUNT', async (_case, token) => {
      const before = users.length;
      const res = await request(app.getHttpServer())
        .post('/v1/diners/me')
        .set('Authorization', as(token))
        .expect(403);

      expect(res.body).toEqual(forbidden('RESTAURANT_ACCOUNT'));
      expect(users).toHaveLength(before);
    });

    it('rejects an unverified email with 401 EMAIL_NOT_VERIFIED', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/diners/me')
        .set('Authorization', as('unverified'))
        .expect(401);

      expect(res.body.errorCode).toBe('EMAIL_NOT_VERIFIED');
      expect(users.map((user) => user.email)).not.toContain(
        'nueva@example.com',
      );
    });

    it('rejects a request without a session with 401', async () => {
      await request(app.getHttpServer()).post('/v1/diners/me').expect(401);
    });

    it.each<[string, object, string]>([
      ['an empty name', { displayName: '   ' }, 'Escribe tu nombre.'],
      ['a null name', { displayName: null }, 'Escribe tu nombre.'],
      ['a name that is not text', { displayName: 7 }, 'Escribe tu nombre.'],
      [
        'a name of more than 60 characters',
        { displayName: 'a'.repeat(61) },
        'Tu nombre es muy largo. Usa máximo 60 caracteres.',
      ],
      [
        'a name with a line break',
        { displayName: 'Ana\nGómez' },
        'Tu nombre no puede incluir caracteres invisibles ni saltos de línea.',
      ],
      [
        'a name with a zero-width space',
        { displayName: 'Ana\u200BGómez' },
        'Tu nombre no puede incluir caracteres invisibles ni saltos de línea.',
      ],
      [
        'a field that does not exist',
        { role: UserRole.RESTAURANT_ADMIN },
        'El campo "role" no se permite. Quítalo de la solicitud.',
      ],
    ])('rejects %s with 400', async (_case, body, message) => {
      const res = await request(app.getHttpServer())
        .post('/v1/diners/me')
        .set('Authorization', as('plain'))
        .send(body)
        .expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message: [message],
        error: 'Bad Request',
      });
    });
  });

  it('documents GET /v1/me and POST /v1/diners/me in Swagger', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const { paths } = res.body as {
      paths: Record<string, Record<string, { responses: object }>>;
    };

    expect(Object.keys(paths['/v1/me'])).toEqual(['get']);
    expect(Object.keys(paths['/v1/me'].get.responses).sort()).toEqual([
      '200',
      '401',
      '403',
    ]);
    expect(Object.keys(paths['/v1/diners/me'])).toEqual(['post']);
    expect(Object.keys(paths['/v1/diners/me'].post.responses).sort()).toEqual([
      '200',
      '201',
      '400',
      '401',
      '403',
    ]);
  });
});
