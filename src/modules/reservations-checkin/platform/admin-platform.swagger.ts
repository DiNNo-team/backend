import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  ADMIN_ENDPOINT_ACCOUNT_EXAMPLES,
  SESSION_UNAUTHORIZED_RESPONSE,
} from '../../identity-access/index.js';
import {
  RESTAURANT_NOT_FOUND_CODE,
  RESTAURANT_NOT_FOUND_MESSAGE,
} from '../../restaurant-operations/index.js';
import { BILLING_MONTH_MESSAGES } from '../billing/billing-month.js';
import {
  BILLING_ERRORS,
  type BillingErrorCode,
} from '../billing/billing-errors.js';

// Swagger común de los controladores del panel del administrador en este
// módulo: el tag, el token y los 401 y 403 de cuenta.
export function AdminPlatformDocs() {
  return applyDecorators(
    ApiTags('admin'),
    ApiBearerAuth(),
    ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE),
    ApiForbiddenResponse({
      description:
        'La cuenta no es de administrador de DiNNo: es de restaurante (errorCode: RESTAURANT_ACCOUNT, también si su restaurante está pendiente, rechazado o suspendido), de comensal (DINER_ACCOUNT) o no tiene perfil (ACCOUNT_NOT_ENABLED).',
      type: ErrorResponseDto,
      examples: ADMIN_ENDPOINT_ACCOUNT_EXAMPLES,
    }),
  );
}

export const MONTH_BAD_REQUEST = {
  description:
    'month no tiene el formato AAAA-MM, es anterior a 2026-01 o posterior al mes en curso; page o pageSize fuera de rango; o llega un parámetro que no existe. message es una lista.',
  type: ErrorResponseDto,
  example: {
    statusCode: 400,
    message: [BILLING_MONTH_MESSAGES.IN_FUTURE],
    error: 'Bad Request',
  },
};

export const RESTAURANT_NOT_FOUND_RESPONSE = {
  description: 'El id no es un UUID válido o el restaurante no existe.',
  type: ErrorResponseDto,
  example: {
    statusCode: 404,
    message: RESTAURANT_NOT_FOUND_MESSAGE,
    error: 'Not Found',
    errorCode: RESTAURANT_NOT_FOUND_CODE,
  },
};

export function billingConflictResponse(
  description: string,
  codes: BillingErrorCode[],
) {
  return {
    description,
    type: ErrorResponseDto,
    examples: Object.fromEntries(
      codes.map((code) => [
        code,
        {
          summary: code,
          value: {
            statusCode: 409,
            message: BILLING_ERRORS[code],
            error: 'Conflict',
            errorCode: code,
          },
        },
      ]),
    ),
  };
}
