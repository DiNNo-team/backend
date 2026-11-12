import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import {
  PUSH_PLATFORM_INVALID,
  PUSH_TOKEN_INVALID,
} from './../src/modules/notifications/devices/dto/push-device.dto.js';
import { PushDevice } from './../src/modules/notifications/devices/push-device.entity.js';
import { NotificationsModule } from './../src/modules/notifications/notifications.module.js';
import {
  PushSender,
  type PushMessage,
} from './../src/modules/notifications/push/push-sender.js';
import {
  RESERVATION_CHECKED_IN,
  RESERVATION_CREATED,
} from './../src/modules/search-availability/index.js';
import { FakeDatabaseModule } from './support/fake-database.js';
import {
  fakeFirebaseAuth,
  testUsers,
  usersRepository,
} from './support/test-accounts.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const DINER_ID = testUsers(RESTAURANT_ID)[0].id;
const RESERVATION_ID = '3c2b1a0f-9e8d-4c7b-a6f5-e4d3c2b1a0f9';
const PHONE = 'fcm-token-of-the-phone';

// Phones of the diner (/v1/notifications/devices) and the path from a
// reservation event to the notification, without PostgreSQL or Firebase: an
// in-memory push_devices table, a DataSource that answers the facts query and
// a fake sender that records what it would send.
describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let devices: { userId: string; token: string; platform: string }[];
  let sent: { tokens: string[]; message: PushMessage }[];
  let invalidTokens: string[];

  beforeEach(async () => {
    devices = [];
    sent = [];
    invalidTokens = [];
    const repository = {
      upsert: (row: { userId: string; token: string; platform: string }) => {
        devices = [...devices.filter((d) => d.token !== row.token), row];
        return Promise.resolve();
      },
      delete: (where: {
        userId?: string;
        token: string | { _value: string[] };
      }) => {
        const tokens =
          typeof where.token === 'string' ? [where.token] : where.token._value;
        devices = devices.filter(
          (d) =>
            !(
              tokens.includes(d.token) &&
              (where.userId === undefined || d.userId === where.userId)
            ),
        );
        return Promise.resolve();
      },
      find: ({ where }: { where: { userId: string } }) =>
        Promise.resolve(devices.filter((d) => d.userId === where.userId)),
    };
    const sender: PushSender = {
      enabled: true,
      send: (tokens, message) => {
        sent.push({ tokens, message });
        return Promise.resolve({ sent: tokens.length, invalidTokens });
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
        FakeDatabaseModule.with(
          {},
          {
            query: (_sql: string, [id]: string[]) =>
              Promise.resolve(
                id === RESERVATION_ID
                  ? [
                      {
                        dinerId: DINER_ID,
                        restaurantName: 'Casa 72',
                        tableIdentifier: 'Mesa 4',
                        // 12:45 in Bogotá.
                        expiresAt: new Date('2026-11-12T17:45:00Z'),
                      },
                    ]
                  : [],
              ),
          },
        ),
        EventEmitterModule.forRoot(),
        NotificationsModule,
      ],
    })
      .overrideProvider(FIREBASE_AUTH)
      .useValue(() => fakeFirebaseAuth)
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepository(testUsers(RESTAURANT_ID)))
      .overrideProvider(getRepositoryToken(PushDevice))
      .useValue(repository)
      .overrideProvider(PushSender)
      .useValue(sender)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const register = (token: string, body: object) =>
    http()
      .put('/v1/notifications/devices')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  // The listener is asynchronous (async: true): it runs after the emit, like
  // after a commit. Waiting a few ticks lets it finish.
  const emit = async (name: string, payload: object) => {
    app.get(EventEmitter2).emit(name, payload);
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  it('registers the phone for the diner of the session (204), and again only refreshes it', async () => {
    await register('diner', { token: PHONE, platform: 'android' }).expect(204);
    await register('diner', { token: PHONE, platform: 'android' }).expect(204);

    expect(devices).toEqual([
      { userId: DINER_ID, token: PHONE, platform: 'android' },
    ]);
  });

  it.each([
    [{ platform: 'android' }, PUSH_TOKEN_INVALID],
    [{ token: '', platform: 'android' }, PUSH_TOKEN_INVALID],
    [{ token: PHONE, platform: 'web' }, PUSH_PLATFORM_INVALID],
  ])('rejects %j with 400', async (body, message) => {
    const res = await register('diner', body).expect(400);

    expect(res.body.message).toContain(message);
    expect(devices).toEqual([]);
  });

  it('a field that is not in the contract (userId) is a 400: the diner comes from the session', async () => {
    await register('diner', {
      token: PHONE,
      platform: 'android',
      userId: 'someone-else',
    }).expect(400);
  });

  it('is only for diners: a restaurant gets RESTAURANT_ACCOUNT and no session 401', async () => {
    const res = await register('owner', {
      token: PHONE,
      platform: 'android',
    }).expect(403);

    expect(res.body.errorCode).toBe('RESTAURANT_ACCOUNT');
    await http()
      .put('/v1/notifications/devices')
      .send({ token: PHONE, platform: 'android' })
      .expect(401);
  });

  it('forgets the phone on sign-out (204)', async () => {
    await register('diner', { token: PHONE, platform: 'android' }).expect(204);
    await http()
      .delete('/v1/notifications/devices')
      .set('Authorization', 'Bearer diner')
      .send({ token: PHONE })
      .expect(204);

    expect(devices).toEqual([]);
  });

  it('a check-in sends one notification to the phones of the diner, without the code', async () => {
    await register('diner', { token: PHONE, platform: 'android' }).expect(204);
    await emit(RESERVATION_CHECKED_IN, {
      reservationId: RESERVATION_ID,
      restaurantId: RESTAURANT_ID,
      dinerId: DINER_ID,
      status: 'completed',
      tableId: 'table',
      at: '2026-11-12T17:40:00Z',
    });

    expect(sent).toEqual([
      {
        tokens: [PHONE],
        message: {
          title: 'Check-in confirmado',
          body: 'Tu Mesa 04 en Casa 72 te espera. Buen provecho.',
          data: { type: 'checked_in', reservationId: RESERVATION_ID },
        },
      },
    ]);
  });

  it('a new reservation says until when the table is kept, in Bogotá time', async () => {
    await register('diner', { token: PHONE, platform: 'android' }).expect(204);
    await emit(RESERVATION_CREATED, {
      restaurantId: RESTAURANT_ID,
      reservation: { id: RESERVATION_ID },
    });

    expect(sent[0].message.body).toBe(
      'Te guardamos la Mesa 04 hasta las 12:45. Muestra tu código al llegar.',
    );
  });

  it('a diner without phones gets nothing, and a token FCM no longer knows is forgotten', async () => {
    await emit(RESERVATION_CREATED, {
      restaurantId: RESTAURANT_ID,
      reservation: { id: RESERVATION_ID },
    });
    expect(sent).toEqual([]);

    await register('diner', { token: PHONE, platform: 'android' }).expect(204);
    invalidTokens = [PHONE];
    await emit(RESERVATION_CREATED, {
      restaurantId: RESTAURANT_ID,
      reservation: { id: RESERVATION_ID },
    });
    expect(devices).toEqual([]);
  });
});
