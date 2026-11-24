import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { UnhandledExceptionFilter } from './common/filters/unhandled-exception.filter.js';
import { parseTrustProxyHops } from './common/rate-limit/rate-limit.settings.js';
import type { SocketConnectionLimiter } from './common/rate-limit/socket-connection-limiter.js';
import { securityHeaders } from './common/security/security-headers.js';
import { CorsIoAdapter } from './config/socket-io.adapter.js';
import type { SocketIoAdapterConstructor } from './config/socket-io-redis.js';
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

export interface AppSetupOptions {
  // Solo la app real (main.ts) lo pasa: las e2e montan módulos sueltos, sin
  // RateLimitModule.
  socketConnectionLimiter?: SocketConnectionLimiter;
  // Adaptador de Redis de Socket.IO (salas compartidas entre réplicas). Solo
  // lo pasa main.ts; null o sin definir: el adaptador en memoria.
  socketIoAdapter?: SocketIoAdapterConstructor | null;
}

// Configuración HTTP compartida por main.ts y las pruebas e2e.
export function configureApp(
  app: INestApplication,
  options: AppSetupOptions = {},
): void {
  const config = app.get(ConfigService);

  // La IP real del cliente detrás del ingress (X-Forwarded-For): la usan el
  // límite de peticiones y los logs. Desplegado, 1 proxy; en local, ninguno.
  (app as NestExpressApplication).set(
    'trust proxy',
    parseTrustProxyHops(
      config.get<string>('TRUST_PROXY_HOPS'),
      isDeployedEnvironment(config),
    ),
  );
  // Cabeceras de seguridad (Sprint 4, tarea 6.1.4), antes de cualquier ruta.
  app.use(securityHeaders(`/${DOCS_PATH}`));

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new UnhandledExceptionFilter(app.getHttpAdapter()));

  const corsOrigins = parseCorsOrigins(config.get<string>('CORS_ORIGINS'));
  app.enableCors({
    origin: corsOrigins,
    // Sin cookies/sesión por ahora (auth por token); activar si eso cambia.
    credentials: false,
  });
  // WebSocket (Socket.IO, /socket.io) con los mismos orígenes que la API.
  app.useWebSocketAdapter(
    new CorsIoAdapter(
      app,
      corsOrigins,
      options.socketConnectionLimiter,
      options.socketIoAdapter,
    ),
  );

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
