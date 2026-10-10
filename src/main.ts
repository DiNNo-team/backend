import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp, resolveListenHost } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  // Render asigna el puerto en PORT; 3000 es el valor por defecto en local.
  await app.listen(
    process.env.PORT ?? 3000,
    resolveListenHost(app.get(ConfigService)),
  );
}
await bootstrap();
