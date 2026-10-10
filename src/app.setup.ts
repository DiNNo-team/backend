import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { UnhandledExceptionFilter } from './common/filters/unhandled-exception.filter.js';
import { isDeployedEnvironment } from './modules/identity-access/index.js';

export const API_PREFIX = 'v1';
export const DOCS_PATH = 'docs';
const DEFAULT_CORS_ORIGINS = 'http://localhost:5173';

// Render needs every interface. Locally the development user asks for no
// credentials and the database is the shared (production) one, so only this
// machine may reach the API, not the rest of the network.
export function resolveListenHost(config: ConfigService): string {
  return isDeployedEnvironment(config) ? '0.0.0.0' : '127.0.0.1';
}

export function parseCorsOrigins(value: string | undefined): string[] {
  return (value || DEFAULT_CORS_ORIGINS)
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// class-validator writes these two messages in English; the rest come from the DTOs.
function toUserMessage(
  error: ValidationError,
  [constraint, message]: [string, string],
): string {
  if (constraint === 'whitelistValidation') {
    return `El campo "${error.property}" no se permite. Quítalo de la solicitud.`;
  }
  if (constraint === 'unknownValue') {
    return 'La solicitud no tiene el formato esperado. Envía un objeto JSON.';
  }
  return message;
}

// Repeated messages are dropped per field only: several rules failing on one
// field give one message, but two fields with the same message give two.
function toUserMessages(error: ValidationError): string[] {
  const fieldMessages = new Set(
    Object.entries(error.constraints ?? {}).map((entry) =>
      toUserMessage(error, entry),
    ),
  );
  return [...fieldMessages, ...(error.children ?? []).flatMap(toUserMessages)];
}

// Same body as Nest's default 400 ({ statusCode, message: string[], error }).
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException(errors.flatMap(toUserMessages)),
  });
}

// Configuración HTTP compartida por main.ts y las pruebas e2e.
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new UnhandledExceptionFilter(app.getHttpAdapter()));

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
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup(DOCS_PATH, app, document);
}
