import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DEFAULT_PAGE } from '../../../common/dto/page-query.js';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  ADMIN_ENDPOINT_ACCOUNT_EXAMPLES,
  CurrentUser,
  CurrentUserGuard,
  PENDING,
  Roles,
  SESSION_UNAUTHORIZED_RESPONSE,
  UserRole,
  type CurrentUserData,
} from '../../identity-access/index.js';
import {
  RESTAURANT_NOT_FOUND_CODE,
  RESTAURANT_NOT_FOUND_MESSAGE,
  restaurantNotFound,
} from '../shared/restaurant-not-found.js';
import {
  AdminRestaurantDetailDto,
  AdminRestaurantPageDto,
} from './dto/admin-restaurant-response.dto.js';
import {
  ADMIN_PAGE_SIZE_DEFAULT,
  AdminRestaurantsQueryDto,
  APPROVAL_STATUS_INVALID,
} from './dto/admin-restaurants-query.dto.js';
import {
  REJECTION_REASON_INVALID,
  RejectRestaurantDto,
} from './dto/reject-restaurant.dto.js';
import { RestaurantReviewQueries } from './restaurant-review.queries.js';
import { RestaurantReviewService } from './restaurant-review.service.js';
import {
  SUSPENSION_REASON_INVALID,
  SuspendRestaurantDto,
} from './dto/suspend-restaurant.dto.js';
import {
  RESTAURANT_NOT_APPROVED_CODE,
  RESTAURANT_NOT_APPROVED_MESSAGE,
  RESTAURANT_NOT_PENDING_CODE,
  RESTAURANT_NOT_PENDING_MESSAGE,
  RESTAURANT_NOT_SUSPENDED_CODE,
  RESTAURANT_NOT_SUSPENDED_MESSAGE,
} from './review-errors.js';

// Un :id que no es UUID responde el mismo 404 que uno que no existe.
const RestaurantIdParam = () =>
  Param('id', new ParseUUIDPipe({ exceptionFactory: restaurantNotFound }));

const NOT_FOUND_RESPONSE = {
  description: 'El id no es un UUID válido o el restaurante no existe.',
  type: ErrorResponseDto,
  example: {
    statusCode: 404,
    message: RESTAURANT_NOT_FOUND_MESSAGE,
    error: 'Not Found',
    errorCode: RESTAURANT_NOT_FOUND_CODE,
  },
};

const NOT_PENDING_RESPONSE = {
  description:
    'La solicitud ya no está pendiente: ya se revisó, u otro administrador se adelantó. La web vuelve a consultar el detalle.',
  type: ErrorResponseDto,
  example: {
    statusCode: 409,
    message: RESTAURANT_NOT_PENDING_MESSAGE,
    error: 'Conflict',
    errorCode: RESTAURANT_NOT_PENDING_CODE,
  },
};

const NOT_APPROVED_RESPONSE = {
  description:
    'El restaurante no está aprobado: está pendiente, rechazado o ya suspendido (también si otro administrador se adelantó). La web vuelve a consultar el detalle.',
  type: ErrorResponseDto,
  example: {
    statusCode: 409,
    message: RESTAURANT_NOT_APPROVED_MESSAGE,
    error: 'Conflict',
    errorCode: RESTAURANT_NOT_APPROVED_CODE,
  },
};

const NOT_SUSPENDED_RESPONSE = {
  description:
    'El restaurante no está suspendido (también si otro administrador ya lo reactivó). La web vuelve a consultar el detalle.',
  type: ErrorResponseDto,
  example: {
    statusCode: 409,
    message: RESTAURANT_NOT_SUSPENDED_MESSAGE,
    error: 'Conflict',
    errorCode: RESTAURANT_NOT_SUSPENDED_CODE,
  },
};

const ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'Id del restaurante.',
};

// Panel del administrador de DiNNo (rol platform_admin, §11 "Administrador"):
// revisar las solicitudes de los restaurantes que se registran solos.
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE)
@ApiForbiddenResponse({
  description:
    'La cuenta no es de administrador de DiNNo: es de restaurante (errorCode: RESTAURANT_ACCOUNT, también si su restaurante está pendiente, rechazado o suspendido), de comensal (DINER_ACCOUNT) o no tiene perfil (ACCOUNT_NOT_ENABLED).',
  type: ErrorResponseDto,
  examples: ADMIN_ENDPOINT_ACCOUNT_EXAMPLES,
})
@Roles(UserRole.PLATFORM_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('admin/restaurants')
export class AdminRestaurantsController {
  constructor(
    private readonly queries: RestaurantReviewQueries,
    private readonly review: RestaurantReviewService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar las solicitudes de restaurantes por estado',
    description:
      'Paginada. status por defecto pending. Orden: las pendientes por submittedAt ascendente (la que más lleva esperando primero); las aprobadas y rechazadas por reviewedAt descendente (las aprobadas sin revisión, al final); las suspendidas por suspendedAt descendente. Cualquier otro parámetro da 400.',
  })
  @ApiOkResponse({ type: AdminRestaurantPageDto })
  @ApiBadRequestResponse({
    description:
      'status fuera de la lista, page menor que 1 o no entero, pageSize fuera de 1 a 100, o un parámetro que no existe. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [APPROVAL_STATUS_INVALID],
      error: 'Bad Request',
    },
  })
  list(
    @Query() query: AdminRestaurantsQueryDto,
  ): Promise<AdminRestaurantPageDto> {
    return this.queries.list({
      status: query.status ?? PENDING,
      page: query.page ?? DEFAULT_PAGE,
      pageSize: query.pageSize ?? ADMIN_PAGE_SIZE_DEFAULT,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver el detalle de una solicitud',
    description:
      'Datos del restaurante, ubicación, horarios, correo del dueño y auditoría de la revisión (rejectionReason, reviewedAt, reviewedByEmail). Responde en cualquier estado.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AdminRestaurantDetailDto })
  @ApiNotFoundResponse(NOT_FOUND_RESPONSE)
  detail(@RestaurantIdParam() id: string): Promise<AdminRestaurantDetailDto> {
    return this.queries.detail(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aprobar una solicitud pendiente',
    description:
      'Solo desde pending. Guarda quién y cuándo (reviewedBy, reviewedAt) y limpia el motivo. Desde ese momento el restaurante opera y, si cumple lo demás (ubicación, horario, mesas), aparece para los comensales (se emite availability.changed). Responde el detalle actualizado.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AdminRestaurantDetailDto })
  @ApiNotFoundResponse(NOT_FOUND_RESPONSE)
  @ApiConflictResponse(NOT_PENDING_RESPONSE)
  async approve(
    @CurrentUser() admin: CurrentUserData,
    @RestaurantIdParam() id: string,
  ): Promise<AdminRestaurantDetailDto> {
    await this.review.approve(admin.userId, id);
    return this.queries.detail(id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rechazar una solicitud pendiente',
    description:
      'Solo desde pending. reason es obligatorio (10 a 300 caracteres, sin contar espacios de los extremos) y es lo que verá el restaurante en rejectionReason. Guarda quién y cuándo. Responde el detalle actualizado.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AdminRestaurantDetailDto })
  @ApiBadRequestResponse({
    description:
      'reason falta, no es texto, tiene solo espacios o está fuera de 10 a 300 caracteres; o el body trae un campo que no existe. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [REJECTION_REASON_INVALID],
      error: 'Bad Request',
    },
  })
  @ApiNotFoundResponse(NOT_FOUND_RESPONSE)
  @ApiConflictResponse(NOT_PENDING_RESPONSE)
  async reject(
    @CurrentUser() admin: CurrentUserData,
    @RestaurantIdParam() id: string,
    @Body() dto: RejectRestaurantDto,
  ): Promise<AdminRestaurantDetailDto> {
    await this.review.reject(admin.userId, id, dto.reason);
    return this.queries.detail(id);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspender un restaurante aprobado',
    description:
      'Solo desde approved. reason es obligatorio (10 a 300 caracteres, sin contar espacios de los extremos) y es lo que verá el restaurante mientras esté suspendido. Guarda quién y cuándo (solo la última suspensión). Desde ese momento no aparece para los comensales (búsqueda, detalle y reserva responden como un restaurante no disponible) y su cuenta solo puede ver su restaurante, su cobro y hacer check-in de las reservas activas, que se respetan hasta su check-in o vencimiento. Responde el detalle actualizado.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AdminRestaurantDetailDto })
  @ApiBadRequestResponse({
    description:
      'reason falta, no es texto, tiene solo espacios o está fuera de 10 a 300 caracteres; o el body trae un campo que no existe. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [SUSPENSION_REASON_INVALID],
      error: 'Bad Request',
    },
  })
  @ApiNotFoundResponse(NOT_FOUND_RESPONSE)
  @ApiConflictResponse(NOT_APPROVED_RESPONSE)
  async suspend(
    @CurrentUser() admin: CurrentUserData,
    @RestaurantIdParam() id: string,
    @Body() dto: SuspendRestaurantDto,
  ): Promise<AdminRestaurantDetailDto> {
    await this.review.suspend(admin.userId, id, dto.reason);
    return this.queries.detail(id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivar un restaurante suspendido',
    description:
      'Solo desde suspended, sin body. Vuelve a approved: opera de nuevo y, si cumple lo demás, aparece para los comensales. Se conservan los datos de la última suspensión (el detalle los sigue mostrando). Responde el detalle actualizado.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AdminRestaurantDetailDto })
  @ApiNotFoundResponse(NOT_FOUND_RESPONSE)
  @ApiConflictResponse(NOT_SUSPENDED_RESPONSE)
  async reactivate(
    @RestaurantIdParam() id: string,
  ): Promise<AdminRestaurantDetailDto> {
    await this.review.reactivate(id);
    return this.queries.detail(id);
  }
}
