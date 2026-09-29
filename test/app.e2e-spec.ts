import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppController } from './../src/app.controller.js';
import { AppService } from './../src/app.service.js';
import { configureApp } from './../src/app.setup.js';

// Prueba la capa HTTP (prefijo, CORS, Swagger) sin PostgreSQL ni Redis.
describe('HTTP (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ CORS_ORIGINS: 'http://localhost:5173' })],
        }),
      ],
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('allows the configured CORS origin', () => {
    return request(app.getHttpServer())
      .get('/v1/health')
      .set('Origin', 'http://localhost:5173')
      .expect('Access-Control-Allow-Origin', 'http://localhost:5173');
  });

  it('rejects an unknown CORS origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/health')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('/docs-json exposes the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(res.body.paths).toHaveProperty('/v1/health');
  });

  afterEach(async () => {
    await app.close();
  });
});
