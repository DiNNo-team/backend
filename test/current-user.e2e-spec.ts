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

const users = [
  { id: 1, role: 'restaurant_admin', restaurantId: 72 },
  { id: 2, role: 'restaurant_admin', restaurantId: null },
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
          load: [() => ({ DEV_USER_ENABLED: 'true', DEV_USER_ID: '1' })],
        }),
        ProbeModule,
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        findOneBy: ({ id }: { id: number }) =>
          Promise.resolve(users.find((user) => user.id === id) ?? null),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('resolves the default dev user', () => {
    return request(app.getHttpServer())
      .get('/v1/probe')
      .expect(200)
      .expect({ userId: 1, restaurantId: 72, role: 'restaurant_admin' });
  });

  it('switches user with x-dev-user-id and keeps a null restaurantId', () => {
    return request(app.getHttpServer())
      .get('/v1/probe')
      .set('x-dev-user-id', '2')
      .expect(200)
      .expect({ userId: 2, restaurantId: null, role: 'restaurant_admin' });
  });

  it('returns 401 with a clear message for an unknown user', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/probe')
      .set('x-dev-user-id', '99')
      .expect(401);
    expect(res.body.message).toContain('No existe el usuario de desarrollo');
  });

  afterEach(async () => {
    await app.close();
  });
});
