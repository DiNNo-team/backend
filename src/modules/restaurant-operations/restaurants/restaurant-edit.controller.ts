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
import { RestaurantProfileResponseDto } from './dto/restaurant-profile-response.dto.js';
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
      'Actualiza solo los campos que se envían; los demás no cambian. Todos son opcionales, pero hay que enviar al menos uno. Se pueden editar el nombre, la categoría, la dirección y los horarios. schedules reemplaza todos los horarios guardados, con las mismas reglas que el registro; si no se envía, los horarios no cambian. Todo se guarda en una sola transacción. Cualquier campo que no esté en el DTO se rechaza con 400. El restaurante es siempre el del usuario de la sesión. Responde lo mismo que GET /restaurants/me.',
  })
  @ApiOkResponse({
    description:
      'Restaurante con sus datos y sus horarios ya actualizados, igual que GET /restaurants/me.',
    type: RestaurantProfileResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Body vacío (nada que actualizar), un campo inválido (nombre vacío o de más de 120 caracteres, categoría fuera de la lista, dirección vacía o de más de 255 caracteres, o cualquiera de ellos en null), horarios inválidos (null, lista vacía, un día repetido, más de 7 elementos, horas que no están en HH:MM o iguales, horas en un día de 24 horas, campos de más dentro de un día) o un campo que no existe (por ejemplo, restaurantId). message es una lista.',
    type: ErrorResponseDto,
    examples: {
      noChanges: {
        summary: 'Body vacío',
        value: {
          statusCode: 400,
          message: [NO_CHANGES_MESSAGE],
          error: 'Bad Request',
        },
      },
      invalidSchedules: {
        summary: 'Horarios inválidos',
        value: {
          statusCode: 400,
          message: [
            'Cada día de la semana va una sola vez en los horarios.',
            'El lunes: escribe la hora de apertura en formato HH:MM, por ejemplo 09:30.',
          ],
          error: 'Bad Request',
        },
      },
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
  ): Promise<RestaurantProfileResponseDto> {
    const { restaurant, schedules } = await this.restaurantEditService.update(
      user.restaurantId,
      dto,
    );
    return RestaurantProfileResponseDto.fromEntities(restaurant, schedules);
  }
}
