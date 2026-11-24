import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  HttpException,
  HttpServer,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import type { ErrorResponseDto } from '../dto/error-response.dto.js';

export const UNHANDLED_ERROR_MESSAGE =
  'No pudimos completar la acción. Intenta de nuevo en un momento.';
export const INVALID_JSON_MESSAGE =
  'El cuerpo de la solicitud no es un JSON válido.';
export const PAYLOAD_TOO_LARGE_MESSAGE = 'La solicitud es demasiado grande.';
export const ROUTE_NOT_FOUND_MESSAGE = 'Ruta no encontrada.';

// HttpExceptions keep Nest's default handling untouched, except three that
// Express and Nest raise before our code runs (malformed JSON, body too large,
// unknown route): they are rewritten with our body and a Spanish message.
// Unexpected errors change too: the client gets a Spanish 500 without any
// detail, and the full error goes to the server log, because a custom
// @Catch() replaces the logging Nest would otherwise do.
@Catch()
export class UnhandledExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(UnhandledExceptionFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    super.catch(this.translateFrameworkError(exception, request), host);
  }

  override handleUnknownError(
    exception: unknown,
    host: ArgumentsHost,
    applicationRef: HttpServer,
  ): void {
    if (this.isHttpError(exception)) {
      super.handleUnknownError(exception, host, applicationRef);
      return;
    }

    const request = host.switchToHttp().getRequest<Request>();
    this.logger.error(
      `${request.method} ${request.originalUrl}: ${describe(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    const response = host.getArgByIndex<unknown>(1);
    if (applicationRef.isHeadersSent(response)) {
      applicationRef.end(response);
      return;
    }
    const body: ErrorResponseDto = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: UNHANDLED_ERROR_MESSAGE,
      error: 'Internal Server Error',
    };
    applicationRef.reply(response, body, body.statusCode);
  }

  private translateFrameworkError(
    exception: unknown,
    request: Request,
  ): unknown {
    if (isInvalidJsonBody(exception, request)) {
      return new BadRequestException(INVALID_JSON_MESSAGE);
    }
    // The body parser rejects it with an http-errors 413, not an HttpException.
    if (
      this.isHttpError(exception) &&
      exception.statusCode === HttpStatus.PAYLOAD_TOO_LARGE
    ) {
      return new PayloadTooLargeException(PAYLOAD_TOO_LARGE_MESSAGE);
    }
    // Nest's handler for unknown routes uses exactly this text; a 404 thrown
    // by our code (e.g. a missing table) never does.
    if (
      exception instanceof NotFoundException &&
      exception.message === `Cannot ${request.method} ${request.originalUrl}`
    ) {
      return new NotFoundException(ROUTE_NOT_FOUND_MESSAGE);
    }
    return exception;
  }
}

// Nest turns the JSON parser's SyntaxError into a 400 whose message is a text
// (ours always carry a list), and the parser leaves req.body undefined when
// the request had a JSON body it could not parse.
function isInvalidJsonBody(exception: unknown, request: Request): boolean {
  if (!(exception instanceof HttpException)) {
    return false;
  }
  const { message } = exception.getResponse() as { message?: unknown };
  return (
    exception.getStatus() === HttpStatus.BAD_REQUEST &&
    typeof message === 'string' &&
    request.body === undefined &&
    typeof request.is('json') === 'string'
  );
}

function describe(exception: unknown): string {
  if (exception instanceof Error) {
    return `${exception.name}: ${exception.message}`;
  }
  return `Non-error value thrown: ${String(exception)}`;
}
