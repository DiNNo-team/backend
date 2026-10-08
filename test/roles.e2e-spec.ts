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
  Roles,
  type CurrentUserData,
  UserRole,
} from './../src/modules/identity-access/index.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';

@Roles(UserRole.RESTAURANT_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('roles-probe')
class RolesProbeController {
  @Get()
  getCurrentUser(@CurrentUser() user: CurrentUserData): CurrentUserData {
    return user;
  }
}

@Module({
  imports: [IdentityAccessModule],
  controllers: [RolesProbeController],
})
class RolesProbeModule {}

async function createApp(devUserEnabled: boolean): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            DEV_USER_ENABLED: String(devUserEnabled),
            DEV_USER_ID: USER_ID,
            FIREBASE_PROJECT_ID: 'test-project',
          }),
        ],
      }),
      RolesProbeModule,
    ],
  })
    .overrideProvider(getRepositoryToken(User))
    .useValue({
      findOneBy: ({ id }: { id: string }) =>
        Promise.resolve(
          id === USER_ID
            ? { id, role: 'unknown-role', restaurantId: null }
            : null,
        ),
    })
    .compile();

  const app = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

describe('Roles (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createApp(true);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 with the exact role message and no errorCode', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/roles-probe')
      .expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'No tienes acceso a esta sección.',
    });
  });

  it('returns 401 without a session before checking roles', async () => {
    await app.close();
    app = await createApp(false);

    await request(app.getHttpServer()).get('/v1/roles-probe').expect(401);
  });
});