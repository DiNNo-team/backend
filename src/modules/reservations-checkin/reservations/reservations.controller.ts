import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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
import { ActiveReservationResponseDto } from './dto/active-reservation-response.dto.js';
import {
  CreateReservationDto,
  PARTY_SIZE_RANGE,
} from './dto/create-reservation.dto.js';
import { ReservationResponseDto } from './dto/reservation-response.dto.js';
import { ReservationCancellationService } from './reservation-cancellation.service.js';
import { ReservationQueryService } from './reservation-query.service.js';
import {
  ACTIVE_RESERVATION_EXISTS_CODE,
  ACTIVE_RESERVATION_EXISTS_MESSAGE,
  NO_TABLE_AVAILABLE_CODE,
  NO_TABLE_AVAILABLE_MESSAGE,
  RESERVATION_NOT_ACTIVE_CODE,
  RESERVATION_NOT_ACTIVE_MESSAGE,
  RESERVATION_NOT_FOUND_CODE,
  RESERVATION_NOT_FOUND_MESSAGE,
  RESTAURANT_CLOSED_CODE,
  RESTAURANT_CLOSED_MESSAGE,
} from './reservation-errors.js';

export const RESERVATION_ID_INVALID =
  'El id de la reserva no es un UUID válido.';

// Un id mal formado es 400 (como en las rutas de mesas); el 404 es para un id
// válido que no existe o es de otro comensal.
const ReservationIdParam = () =>
  Param(
    'id',
    new ParseUUIDPipe({
      exceptionFactory: () => new BadRequestException([RESERVATION_ID_INVALID]),
    }),
  );

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
  constructor(
    private readonly creation: CreateReservationService,
    private readonly queries: ReservationQueryService,
    private readonly cancellation: ReservationCancellationService,
  ) {}

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

  // Antes que /:id: si no, "active" se leería como un id.
  @Get('active')
  @ApiOperation({
    summary: 'Consultar mi reserva activa',
    description:
      'Devuelve la reserva activa del comensal, o reservation null si no tiene (siempre 200, nunca 404). Si la reserva activa ya pasó su hora de vencimiento, se vence en ese momento y la respuesta trae reservation null. serverTime es la hora del servidor, la misma dentro y fuera de reservation.',
  })
  @ApiOkResponse({
    description: 'La reserva activa o null.',
    type: ActiveReservationResponseDto,
  })
  findActive(
    @CurrentUser() user: CurrentUserData,
  ): Promise<ActiveReservationResponseDto> {
    return this.queries.findActive(user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consultar una reserva mía',
    description:
      'Devuelve la reserva en cualquier estado (active, cancelled, expired o completed), para mostrar el estado final. Solo la del comensal de la sesión. El código solo viene cuando la reserva está activa. Si está activa y ya pasó su hora de vencimiento, se vence al leer y se devuelve como expired.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id de la reserva.',
    example: '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  })
  @ApiOkResponse({
    description: 'La reserva, en su estado actual.',
    type: ReservationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'El id no es un UUID válido. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [RESERVATION_ID_INVALID],
      error: 'Bad Request',
    },
  })
  @ApiNotFoundResponse({
    description:
      'La reserva no existe o es de otro comensal (el mismo mensaje en ambos casos). La app vuelve a la búsqueda.',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      message: RESERVATION_NOT_FOUND_MESSAGE,
      error: 'Not Found',
      errorCode: RESERVATION_NOT_FOUND_CODE,
    },
  })
  findOne(
    @CurrentUser() user: CurrentUserData,
    @ReservationIdParam() id: string,
  ): Promise<ReservationResponseDto> {
    return this.queries.findOne(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancelar mi reserva',
    description:
      'Cancela la reserva activa del comensal: la reserva queda cancelled (cancelledAt, sin código) y la mesa vuelve a Disponible, en la misma transacción. Si el restaurante cambió la mesa a mano mientras tanto, la mesa no se toca. Solo la reserva activa y vigente: una que ya venció se vence en ese momento y responde 409. Sin cuerpo.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id de la reserva.',
    example: '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  })
  @ApiOkResponse({
    description: 'La reserva cancelada.',
    type: ReservationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'El id no es un UUID válido. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [RESERVATION_ID_INVALID],
      error: 'Bad Request',
    },
  })
  @ApiNotFoundResponse({
    description:
      'La reserva no existe o es de otro comensal (el mismo mensaje en ambos casos). La app vuelve a la búsqueda.',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      message: RESERVATION_NOT_FOUND_MESSAGE,
      error: 'Not Found',
      errorCode: RESERVATION_NOT_FOUND_CODE,
    },
  })
  @ApiConflictResponse({
    description:
      'La reserva ya no está activa: estaba cancelada, vencida o cumplida (también si acaba de vencer). La app consulta GET /v1/reservations/:id y muestra el estado real.',
    type: ErrorResponseDto,
    example: {
      statusCode: 409,
      message: RESERVATION_NOT_ACTIVE_MESSAGE,
      error: 'Conflict',
      errorCode: RESERVATION_NOT_ACTIVE_CODE,
    },
  })
  cancel(
    @CurrentUser() user: CurrentUserData,
    @ReservationIdParam() id: string,
  ): Promise<ReservationResponseDto> {
    return this.cancellation.cancel(user, id);
  }
}
