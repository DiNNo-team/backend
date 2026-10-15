import { ForbiddenException } from '@nestjs/common';

// 403s by account type (Sprint 2 contract, "Códigos de cuenta"). Single source
// of the codes and texts: the front branches on the code, never on the text.
export const ACCOUNT_ERROR_MESSAGES = {
  ACCOUNT_NOT_ENABLED:
    'Esta cuenta no está habilitada como restaurante. Si eres comensal, encuentra mesa desde la app DiNNo.',
  PROFILE_REQUIRED: 'Completa tu perfil para continuar.',
  DINER_ACCOUNT:
    'Esta es una cuenta de comensal. Para buscar mesa, usa la app DiNNo.',
  RESTAURANT_ACCOUNT:
    'Esta es una cuenta de restaurante. Administra tu restaurante desde la web.',
} as const;

export type AccountErrorCode = keyof typeof ACCOUNT_ERROR_MESSAGES;

export const ACCOUNT_ERROR_CODES = Object.keys(
  ACCOUNT_ERROR_MESSAGES,
) as AccountErrorCode[];

function swaggerExample(summary: string, code: AccountErrorCode) {
  return {
    summary,
    value: {
      statusCode: 403,
      message: ACCOUNT_ERROR_MESSAGES[code],
      error: 'Forbidden',
      errorCode: code,
    },
  };
}

// Swagger examples of the account 403s that every restaurant endpoint
// (@Roles(UserRole.RESTAURANT_ADMIN)) can answer.
export const RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES = {
  accountNotEnabled: swaggerExample(
    'La cuenta no está habilitada como restaurante',
    'ACCOUNT_NOT_ENABLED',
  ),
  dinerAccount: swaggerExample('Es una cuenta de comensal', 'DINER_ACCOUNT'),
};

// Swagger examples of the account 403s that every diner endpoint
// (@Roles(UserRole.DINER)) can answer.
export const DINER_ENDPOINT_ACCOUNT_EXAMPLES = {
  profileRequired: swaggerExample(
    'La cuenta todavía no tiene perfil',
    'PROFILE_REQUIRED',
  ),
  restaurantAccount: swaggerExample(
    'Es una cuenta de restaurante',
    'RESTAURANT_ACCOUNT',
  ),
};

export function accountForbidden(code: AccountErrorCode): ForbiddenException {
  return new ForbiddenException(ACCOUNT_ERROR_MESSAGES[code], {
    errorCode: code,
  });
}
