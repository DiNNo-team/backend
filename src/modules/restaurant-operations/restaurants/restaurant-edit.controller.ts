import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
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
import { RestaurantResponseDto } from './dto/restaurant-response.dto.js';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto.js';
import {
  NO_CHANGES_MESSAGE,
  RestaurantEditService,
} from './restaurant-edit.service.js';

@ApiTags('restaurants')
@ApiBearerAuth()
@Roles(UserRole.RESTAURANT_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('restaurants')
export class RestaurantEditController {
  constructor(private readonly restaurantEditService: RestaurantEditService) {}

  @Patch('me')
  @ApiOperation({
    summary: 'Editar los datos del restaurante del usuario',
    description:
      'Actualiza solo los campos que se envían; los demás no cambian. Todos son opcionales, pero hay que enviar al menos uno. Hoy solo existe name: los demás datos del restaurante (categoría, dirección, horarios) se podrán editar aquí cuando existan, sin cambiar la ruta. Cualquier campo que no esté en el DTO se rechaza con 400. El restaurante es siempre el del usuario de la sesión.',
  })
  @ApiOkResponse({
    description: 'Restaurante con sus datos actualizados.',
    type: RestaurantResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Body vacío (nada que actualizar), un campo inválido (por ejemplo, nombre vacío o de más de 120 caracteres) o un campo que no existe. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [NO_CHANGES_MESSAGE],
      error: 'Bad Request',
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'No hay una sesión activa o el correo no está verificado (errorCode: EMAIL_NOT_VERIFIED).',
    type: ErrorResponseDto,
    example: {
      statusCode: 401,
      message: 'Verifica tu correo para continuar.',
      error: 'Unauthorized',
      errorCode: 'EMAIL_NOT_VERIFIED',
    },
  })
  @ApiForbiddenResponse({
    description:
      'El usuario no tiene acceso por rol, o todavía no registra su restaurante (errorCode: RESTAURANT_REQUIRED).',
    type: ErrorResponseDto,
    examples: {
      insufficientRole: {
        summary: 'El rol no permite editar el restaurante',
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
  })
  async update(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateRestaurantDto,
  ): Promise<RestaurantResponseDto> {
    const restaurant = await this.restaurantEditService.update(
      user.restaurantId,
      dto,
    );
    return RestaurantResponseDto.fromEntity(restaurant);
  }
}
