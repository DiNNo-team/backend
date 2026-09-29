import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const API_PREFIX = 'v1';
export const DOCS_PATH = 'docs';
const DEFAULT_CORS_ORIGINS = 'http://localhost:5173';

export function parseCorsOrigins(value: string | undefined): string[] {
  return (value || DEFAULT_CORS_ORIGINS)
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// Configuración HTTP compartida por main.ts y las pruebas e2e.
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.setGlobalPrefix(API_PREFIX);

  app.enableCors({
    origin: parseCorsOrigins(config.get<string>('CORS_ORIGINS')),
    // Sin cookies/sesión por ahora (auth por token); activar si eso cambia.
    credentials: false,
  });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('DiNNo API')
      .setDescription(
        'Contrato de la API de DiNNo entre backend, plataforma web y app móvil.',
      )
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup(DOCS_PATH, app, document);
}
