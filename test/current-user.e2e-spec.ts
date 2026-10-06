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
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import {
  CurrentUser,
  CurrentUserGuard,
  IdentityAccessModule,
  type CurrentUserData,
} from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';

@Controller('probe')
class ProbeController {
  @UseGuards(CurrentUserGuard)
  @Get()
  whoAmI(@CurrentUser() user: CurrentUserData): CurrentUserData {
    return user;
  }
}

@Module({ imports: [IdentityAccessModule], controllers: [ProbeController] })
class ProbeModule {}

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';

const users = [
  { id: OWNER_ID, role: 'restaurant_admin', restaurantId: RESTAURANT_ID },
  { id: NEWCOMER_ID, role: 'restaurant_admin', restaurantId: null },
];

// Prueba el contrato de usuario actual desde otro módulo, sin PostgreSQL.
describe('CurrentUser (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ DEV_USER_ENABLED: 'true', DEV_USER_ID: OWNER_ID })],
        }),
        ProbeModule,
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        findOneBy: ({ id }: { id: string }) =>
          Promise.resolve(users.find((user) => user.id === id) ?? null),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('resolves the default dev user', () => {
    return request(app.getHttpServer()).get('/v1/probe').expect(200).expect({
      userId: OWNER_ID,
      restaurantId: RESTAURANT_ID,
      role: 'restaurant_admin',
    });
  });

  it('switches user with x-dev-user-id and keeps a null restaurantId', () => {
    return request(app.getHttpServer())
      .get('/v1/probe')
      .set('x-dev-user-id', NEWCOMER_ID)
      .expect(200)
      .expect({
        userId: NEWCOMER_ID,
        restaurantId: null,
        role: 'restaurant_admin',
      });
  });

  it('returns 401 with a clear message for an unknown user', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/probe')
      .set('x-dev-user-id', '00000000-0000-4000-8000-000000000000')
      .expect(401);
    expect(res.body.message).toContain('No existe el usuario de desarrollo');
  });

  afterEach(async () => {
    await app.close();
  });
});
