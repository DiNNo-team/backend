import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Body of every error response in the API (Nest's default exception format).
// Shared by all modules for their Swagger docs: reuse it, do not duplicate it.
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description:
      'Mensaje en español para mostrar al usuario. En los 400 de validación es una lista, un mensaje por problema; en los demás errores es un texto.',
    example: ['El campo "status" no se permite. Quítalo de la solicitud.'],
  })
  message: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  // Native Nest 12 option (HttpExceptionOptions.errorCode), only where the
  // front has to branch on the reason; see CLAUDE.md, "API".
  @ApiPropertyOptional({
    description:
      'Motivo del error, solo cuando el front tiene que actuar distinto según el motivo. Los demás errores no lo traen. Valores: EMAIL_NOT_VERIFIED (401: verifica tu correo para continuar), ACCOUNT_NOT_ENABLED (403: la cuenta no está habilitada como restaurante), PROFILE_REQUIRED (403: la cuenta todavía no tiene perfil; la app llama a POST /v1/diners/me y reintenta), DINER_ACCOUNT (403: cuenta de comensal en un endpoint de restaurante), RESTAURANT_ACCOUNT (403: cuenta de restaurante en un endpoint de comensal), RESTAURANT_REQUIRED (403: el usuario todavía no registra su restaurante; llévalo al registro).',
    enum: [
      'EMAIL_NOT_VERIFIED',
      'ACCOUNT_NOT_ENABLED',
      'PROFILE_REQUIRED',
      'DINER_ACCOUNT',
      'RESTAURANT_ACCOUNT',
      'RESTAURANT_REQUIRED',
    ],
  })
  errorCode?: string;
}
