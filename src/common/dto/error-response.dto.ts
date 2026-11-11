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
      'Motivo del error, solo cuando el front tiene que actuar distinto según el motivo. Los demás errores no lo traen. Valores: EMAIL_NOT_VERIFIED (401: verifica tu correo para continuar), ACCOUNT_NOT_ENABLED (403: la cuenta no está habilitada como restaurante), PROFILE_REQUIRED (403: la cuenta todavía no tiene perfil; la app llama a POST /v1/diners/me y reintenta), DINER_ACCOUNT (403: cuenta de comensal en un endpoint de restaurante), RESTAURANT_ACCOUNT (403: cuenta de restaurante en un endpoint de comensal), ADMIN_ACCOUNT (403: cuenta de administrador de DiNNo en un endpoint de restaurante o de comensal; usa el panel de administración), ACCOUNT_PENDING_APPROVAL (403: el restaurante está en revisión; solo puede ver su cuenta y su restaurante), ACCOUNT_REJECTED (403: el restaurante no fue aprobado; muestra el motivo), RESTAURANT_REQUIRED (403: el usuario todavía no registra su restaurante; llévalo al registro), RESTAURANT_NOT_FOUND (404: el restaurante del detalle público no existe, el id no es válido o no tiene ubicación), ADDRESS_NOT_FOUND (404: GET /v1/geocode no encontró la dirección en Bogotá; mueve el pin), GEOCODING_UNAVAILABLE (503: el servicio de mapas no está disponible; mueve el pin), NO_TABLE_AVAILABLE (409: POST /v1/reservations, no queda una mesa libre; prueba con otro restaurante), ACTIVE_RESERVATION_EXISTS (409: el comensal ya tiene una reserva activa; ofrece ver mi reserva), RESTAURANT_CLOSED (409: el restaurante acaba de cerrar), RESERVATION_NOT_FOUND (404: la reserva no existe o es de otro comensal; la app vuelve a la búsqueda), TABLE_HAS_ACTIVE_RESERVATION (409: la mesa tiene una reserva de DiNNo en curso; no se puede cambiar su estado, desactivarla ni bajar su capacidad por debajo de la reserva), TABLE_NOT_AVAILABLE_TO_DEACTIVATE (409: solo se desactiva una mesa Disponible; primero se marca como Disponible), RESERVATION_NOT_ACTIVE (409: POST /v1/reservations/:id/cancel, la reserva ya no está activa; la app consulta GET /v1/reservations/:id y muestra el estado real), RESERVATION_CODE_NOT_FOUND (404: POST /v1/restaurants/me/check-ins, no hay una reserva con ese código en el restaurante), RESERVATION_EXPIRED (409: check-in de una reserva vencida; message trae la hora y se muestra tal cual), RESERVATION_ALREADY_USED (409: check-in de un código ya usado; message trae la hora y se muestra tal cual), RESERVATION_CANCELLED (409: check-in de una reserva que el comensal canceló).',
    enum: [
      'EMAIL_NOT_VERIFIED',
      'ACCOUNT_NOT_ENABLED',
      'PROFILE_REQUIRED',
      'DINER_ACCOUNT',
      'RESTAURANT_ACCOUNT',
      'ADMIN_ACCOUNT',
      'ACCOUNT_PENDING_APPROVAL',
      'ACCOUNT_REJECTED',
      'RESTAURANT_REQUIRED',
      'RESTAURANT_NOT_FOUND',
      'ADDRESS_NOT_FOUND',
      'GEOCODING_UNAVAILABLE',
      'NO_TABLE_AVAILABLE',
      'ACTIVE_RESERVATION_EXISTS',
      'RESTAURANT_CLOSED',
      'RESERVATION_NOT_FOUND',
      'TABLE_HAS_ACTIVE_RESERVATION',
      'TABLE_NOT_AVAILABLE_TO_DEACTIVATE',
      'RESERVATION_NOT_ACTIVE',
      'RESERVATION_CODE_NOT_FOUND',
      'RESERVATION_EXPIRED',
      'RESERVATION_ALREADY_USED',
      'RESERVATION_CANCELLED',
    ],
  })
  errorCode?: string;
}
