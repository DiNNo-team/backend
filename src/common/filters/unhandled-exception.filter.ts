import {
  type ArgumentsHost,
  Catch,
  HttpServer,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import type { ErrorResponseDto } from '../dto/error-response.dto.js';

export const UNHANDLED_ERROR_MESSAGE =
  'No pudimos completar la acción. Intenta de nuevo en un momento.';

// HttpExceptions and http-errors (e.g. malformed JSON) keep Nest's default
// handling untouched. Only unexpected errors change: the client gets a Spanish
// 500 without any detail, and the full error goes to the server log, because
// a custom @Catch() replaces the logging Nest would otherwise do.
@Catch()
export class UnhandledExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(UnhandledExceptionFilter.name);

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
}

function describe(exception: unknown): string {
  if (exception instanceof Error) {
    return `${exception.name}: ${exception.message}`;
  }
  return `Non-error value thrown: ${String(exception)}`;
}
