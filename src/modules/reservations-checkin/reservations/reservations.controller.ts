import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  CurrentUser,
  CurrentUserGuard,
  DINER_ENDPOINT_ACCOUNT_EXAMPLES,
  Roles,
  SESSION_UNAUTHORIZED_RESPONSE,
  UserRole,
  type CurrentUserData,
} from '../../identity-access/index.js';
import {
  RESTAURANT_NOT_FOUND_CODE,
  RESTAURANT_NOT_FOUND_MESSAGE,
} from '../../search-availability/index.js';
import { CreateReservationService } from './create-reservation.service.js';
import {
  CreateReservationDto,
  PARTY_SIZE_RANGE,
} from './dto/create-reservation.dto.js';
import { ReservationResponseDto } from './dto/reservation-response.dto.js';
import {
  ACTIVE_RESERVATION_EXISTS_CODE,
  ACTIVE_RESERVATION_EXISTS_MESSAGE,
  NO_TABLE_AVAILABLE_CODE,
  NO_TABLE_AVAILABLE_MESSAGE,
  RESTAURANT_CLOSED_CODE,
  RESTAURANT_CLOSED_MESSAGE,
} from './reservation-errors.js';

const conflict = (message: string, errorCode: string) => ({
  value: { statusCode: 409, message, error: 'Conflict', errorCode },
});

// Rutas de reserva del comensal. El comensal sale de la sesión.
@ApiTags('reservations')
@ApiBearerAuth()
@ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE)
@ApiForbiddenResponse({
  description:
    'La cuenta todavía no tiene perfil (errorCode: PROFILE_REQUIRED: la app llama a POST /v1/diners/me y reintenta) o es de restaurante (RESTAURANT_ACCOUNT).',
  type: ErrorResponseDto,
  examples: DINER_ENDPOINT_ACCOUNT_EXAMPLES,
})
@Roles(UserRole.DINER)
@UseGuards(CurrentUserGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly creation: CreateReservationService) {}

  @Post()
  @ApiOperation({
    summary: 'Reservar una mesa por unos minutos',
    description:
      'Crea una microreserva: asigna la mesa libre más pequeña que alcance para las personas (a igual capacidad, la de identificador menor), la pasa a Reservada y devuelve un código y la hora de vencimiento. Solo si el restaurante está abierto ahora y el comensal no tiene otra reserva activa. El código solo viene mientras la reserva está activa. La app cuenta hacia atrás con expiresAt y serverTime.',
  })
  @ApiCreatedResponse({
    description: 'Reserva creada.',
    type: ReservationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'restaurantId no es un UUID, partySize no es un entero de 1 a 20, o llega un campo que no existe. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [PARTY_SIZE_RANGE],
      error: 'Bad Request',
    },
  })
  @ApiNotFoundResponse({
    description:
      'El restaurante no existe o no es visible (no tiene ubicación), igual que en el detalle público.',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      message: RESTAURANT_NOT_FOUND_MESSAGE,
      error: 'Not Found',
      errorCode: RESTAURANT_NOT_FOUND_CODE,
    },
  })
  @ApiConflictResponse({
    description:
      'RESTAURANT_CLOSED (el restaurante no está abierto ahora), ACTIVE_RESERVATION_EXISTS (el comensal ya tiene una reserva activa) o NO_TABLE_AVAILABLE (no queda una mesa libre para el grupo, o alguien la tomó primero). Se evalúan en ese orden.',
    type: ErrorResponseDto,
    examples: {
      restaurantClosed: {
        summary: 'Restaurante cerrado',
        ...conflict(RESTAURANT_CLOSED_MESSAGE, RESTAURANT_CLOSED_CODE),
      },
      activeReservation: {
        summary: 'Ya tiene una reserva activa',
        ...conflict(
          ACTIVE_RESERVATION_EXISTS_MESSAGE,
          ACTIVE_RESERVATION_EXISTS_CODE,
        ),
      },
      noTable: {
        summary: 'Sin mesa libre',
        ...conflict(NO_TABLE_AVAILABLE_MESSAGE, NO_TABLE_AVAILABLE_CODE),
      },
    },
  })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateReservationDto,
  ): Promise<ReservationResponseDto> {
    return this.creation.create(user, dto);
  }
}
