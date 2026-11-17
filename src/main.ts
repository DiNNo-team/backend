import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp, resolveListenHost } from './app.setup.js';
import { SocketConnectionLimiter } from './common/rate-limit/socket-connection-limiter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app, {
    socketConnectionLimiter: app.get(SocketConnectionLimiter),
  });
  app.enableShutdownHooks();

  // Render asigna el puerto en PORT; 3000 es el valor por defecto en local.
  await app.listen(
    process.env.PORT ?? 3000,
    resolveListenHost(app.get(ConfigService)),
  );
}
await bootstrap();
