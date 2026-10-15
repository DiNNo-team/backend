import { UnauthorizedException } from '@nestjs/common';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';

// 401s of the session, shared by the Firebase resolver and the diner sign-up.
export const SESSION_EXPIRED_MESSAGE =
  'Tu sesión terminó. Inicia sesión de nuevo.';
export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED';
export const EMAIL_NOT_VERIFIED_MESSAGE = 'Verifica tu correo para continuar.';

export function sessionExpired(): UnauthorizedException {
  return new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
}

export function emailNotVerified(): UnauthorizedException {
  return new UnauthorizedException(EMAIL_NOT_VERIFIED_MESSAGE, {
    errorCode: EMAIL_NOT_VERIFIED_CODE,
  });
}

// Swagger of the 401 every route with CurrentUserGuard can answer. Use it as
// @ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE); spread it to change
// only the description.
export const SESSION_UNAUTHORIZED_RESPONSE = {
  description:
    'No hay una sesión activa o el correo no está verificado (errorCode: EMAIL_NOT_VERIFIED).',
  type: ErrorResponseDto,
  example: {
    statusCode: 401,
    message: EMAIL_NOT_VERIFIED_MESSAGE,
    error: 'Unauthorized',
    errorCode: EMAIL_NOT_VERIFIED_CODE,
  },
};
