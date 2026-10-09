import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  CurrentUser,
  CurrentUserGuard,
  Roles,
  type CurrentUserData,
  UserRole,
} from '../../identity-access/index.js';
import {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
} from '../shared/restaurant-required.js';
import { RestaurantStatusResponseDto } from './dto/restaurant-status-response.dto.js';
import {
  IS_OPEN_INVALID,
  UpdateRestaurantStatusDto,
} from './dto/update-restaurant-status.dto.js';
import { RestaurantStatusService } from './restaurant-status.service.js';

const UNAUTHORIZED_RESPONSE = {
  description:
    'No hay una sesión activa o el correo no está verificado (errorCode: EMAIL_NOT_VERIFIED).',
  type: ErrorResponseDto,
  example: {
    statusCode: 401,
    message: 'Verifica tu correo para continuar.',
    error: 'Unauthorized',
    errorCode: 'EMAIL_NOT_VERIFIED',
  },
};

const FORBIDDEN_RESPONSE = {
  description:
    'El usuario no tiene acceso por rol, o todavía no registra su restaurante (errorCode: RESTAURANT_REQUIRED): en ese caso hay que llevarlo al registro del restaurante.',
  type: ErrorResponseDto,
  examples: {
    insufficientRole: {
      summary: 'El rol no permite abrir ni cerrar el restaurante',
      value: {
        statusCode: 403,
        message: 'No tienes acceso a esta sección.',
        error: 'Forbidden',
      },
    },
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
};

@ApiTags('restaurants')
@ApiBearerAuth()
@Roles(UserRole.RESTAURANT_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('restaurants')
export class RestaurantStatusController {
  constructor(
    private readonly restaurantStatusService: RestaurantStatusService,
  ) {}

  @Get('me/status')
  @ApiOperation({
    summary: 'Consultar si el restaurante del usuario está abierto o cerrado',
    description:
      'El restaurante es siempre el del usuario de la sesión. Un restaurante nuevo empieza abierto.',
  })
  @ApiOkResponse({
    description: 'Estado actual del restaurante.',
    type: RestaurantStatusResponseDto,
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED_RESPONSE)
  @ApiForbiddenResponse(FORBIDDEN_RESPONSE)
  async get(
    @CurrentUser() user: CurrentUserData,
  ): Promise<RestaurantStatusResponseDto> {
    const restaurant = await this.restaurantStatusService.get(
      user.restaurantId,
    );
    return RestaurantStatusResponseDto.fromEntity(restaurant);
  }

  @Patch('me/status')
  @ApiOperation({
    summary: 'Abrir o cerrar el restaurante del usuario',
    description:
      'Cambio manual: no depende de los horarios. Enviar el estado que ya tiene responde 200 sin cambiar nada. El restaurante es siempre el del usuario de la sesión; cualquier campo que no sea isOpen se rechaza con 400. La confirmación de cerrar con mesas reservadas la hace la web: este endpoint no la pide.',
  })
  @ApiOkResponse({
    description: 'Estado del restaurante después del cambio.',
    type: RestaurantStatusResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'isOpen falta o no es booleano (por ejemplo, "true" como texto), o el body trae un campo que no existe. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [IS_OPEN_INVALID],
      error: 'Bad Request',
    },
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED_RESPONSE)
  @ApiForbiddenResponse(FORBIDDEN_RESPONSE)
  async update(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateRestaurantStatusDto,
  ): Promise<RestaurantStatusResponseDto> {
    const restaurant = await this.restaurantStatusService.update(
      user.restaurantId,
      dto.isOpen,
    );
    return RestaurantStatusResponseDto.fromEntity(restaurant);
  }
}
