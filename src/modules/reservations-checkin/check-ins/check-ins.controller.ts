import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  CurrentUser,
  CurrentUserGuard,
  RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
  Roles,
  SESSION_UNAUTHORIZED_RESPONSE,
  UserRole,
  type CurrentUserData,
} from '../../identity-access/index.js';
import {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
} from '../../restaurant-operations/index.js';
import {
  RESERVATION_ALREADY_USED_CODE,
  RESERVATION_CANCELLED_CODE,
  RESERVATION_CANCELLED_MESSAGE,
  RESERVATION_CODE_NOT_FOUND_CODE,
  RESERVATION_CODE_NOT_FOUND_MESSAGE,
  RESERVATION_EXPIRED_CODE,
} from './check-in-errors.js';
import { CheckInService } from './check-in.service.js';
import { CheckInResponseDto } from './dto/check-in-response.dto.js';
import { CHECK_IN_CODE_REQUIRED, CheckInDto } from './dto/check-in.dto.js';
import { RestaurantReservationResponseDto } from './dto/restaurant-reservation-response.dto.js';
import {
  RESERVATION_STATUS_INVALID,
  RestaurantReservationsQueryDto,
} from './dto/restaurant-reservations-query.dto.js';
import { RestaurantReservationsService } from './restaurant-reservations.service.js';

const conflict = (message: string, errorCode: string) => ({
  value: { statusCode: 409, message, error: 'Conflict', errorCode },
});

// Rutas de reservas del restaurante. El restaurante sale siempre de la sesión.
@ApiTags('restaurant-reservations')
@ApiBearerAuth()
@ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE)
@ApiForbiddenResponse({
  description:
    'La cuenta no está habilitada como restaurante (errorCode: ACCOUNT_NOT_ENABLED), es de comensal (DINER_ACCOUNT) o todavía no registra su restaurante (RESTAURANT_REQUIRED).',
  type: ErrorResponseDto,
  examples: {
    ...RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
    restaurantRequired: {
      summary: 'El usuario todavía no registra su restaurante',
      value: {
        statusCode: 403,
        message: RESTAURANT_REQUIRED_MESSAGE,
        error: 'Forbidden',
        errorCode: RESTAURANT_REQUIRED_CODE,
      },
    },
  },
})
@Roles(UserRole.RESTAURANT_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('restaurants/me')
export class CheckInsController {
  constructor(
    private readonly checkIns: CheckInService,
    private readonly reservations: RestaurantReservationsService,
  ) {}

  @Post('check-ins')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hacer el check-in con el código del comensal',
    description:
      'Valida el código que muestra el comensal, solo entre las reservas del restaurante de la sesión. Si la reserva está activa y vigente, en una sola transacción: la reserva queda completed, la mesa pasa a Ocupada (con su registro en la bitácora) y se crea el evento facturable, único por reserva. Una activa que ya pasó su hora de vencimiento se vence en ese momento y responde RESERVATION_EXPIRED.',
  })
  @ApiOkResponse({
    description: 'Check-in confirmado.',
    type: CheckInResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Falta code, no es un texto o llega un campo que no existe. message es una lista. Un texto con otro formato no es un 400: responde 404.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [CHECK_IN_CODE_REQUIRED],
      error: 'Bad Request',
    },
  })
  @ApiNotFoundResponse({
    description:
      'El código no existe, no tiene el formato o es de otro restaurante (el mismo mensaje en los tres casos: no se revela que existe).',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      message: RESERVATION_CODE_NOT_FOUND_MESSAGE,
      error: 'Not Found',
      errorCode: RESERVATION_CODE_NOT_FOUND_CODE,
    },
  })
  @ApiConflictResponse({
    description:
      'La reserva está vencida (RESERVATION_EXPIRED), ya se usó (RESERVATION_ALREADY_USED) o el comensal la canceló (RESERVATION_CANCELLED). En RESERVATION_EXPIRED y RESERVATION_ALREADY_USED, message trae la hora de Bogotá y la web lo muestra tal cual.',
    type: ErrorResponseDto,
    examples: {
      expired: {
        summary: 'Reserva vencida',
        ...conflict(
          'Esta reserva se venció a las 12:41. La mesa ya se liberó.',
          RESERVATION_EXPIRED_CODE,
        ),
      },
      alreadyUsed: {
        summary: 'Código ya usado',
        ...conflict(
          'Este código ya se usó a las 12:35.',
          RESERVATION_ALREADY_USED_CODE,
        ),
      },
      cancelled: {
        summary: 'Reserva cancelada',
        ...conflict(RESERVATION_CANCELLED_MESSAGE, RESERVATION_CANCELLED_CODE),
      },
    },
  })
  checkIn(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CheckInDto,
  ): Promise<CheckInResponseDto> {
    return this.checkIns.checkIn(user, dto.code);
  }

  @Get('reservations')
  @ApiOperation({
    summary: 'Consultar las reservas de mi restaurante',
    description:
      'Reservas del restaurante de la sesión en un estado (por defecto, active), la más próxima a vencer primero. Las que ya pasaron su hora de vencimiento se vencen antes de responder. Nunca trae el código: el comensal lo muestra al llegar.',
  })
  @ApiOkResponse({
    description:
      'Reservas ordenadas por expiresAt ascendente. Sin reservas, [].',
    type: RestaurantReservationResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description:
      'status no es un estado válido o la consulta trae un parámetro que no existe. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [RESERVATION_STATUS_INVALID],
      error: 'Bad Request',
    },
  })
  list(
    @CurrentUser() user: CurrentUserData,
    @Query() query: RestaurantReservationsQueryDto,
  ): Promise<RestaurantReservationResponseDto[]> {
    return this.reservations.list(user, query.status);
  }
}
