import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
  type CurrentUserData,
} from '../../identity-access/index.js';
import {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
} from '../shared/restaurant-required.js';
import { RegisterRestaurantDto } from './dto/register-restaurant.dto.js';
import { RestaurantProfileResponseDto } from './dto/restaurant-profile-response.dto.js';
import {
  ALREADY_REGISTERED_MESSAGE,
  RestaurantRegistrationService,
} from './restaurant-registration.service.js';

@ApiTags('restaurants')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'No hay una sesión activa.',
  type: ErrorResponseDto,
})
@UseGuards(CurrentUserGuard)
@Controller('restaurants')
export class RestaurantRegistrationController {
  constructor(
    private readonly registrationService: RestaurantRegistrationService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Registrar el restaurante del usuario',
    description:
      'Crea el restaurante del usuario de la sesión con su nombre, categoría, dirección y horarios, y lo asocia a ese usuario. Un usuario solo tiene un restaurante. Cualquier campo que no esté en el DTO (restaurantId, id…) se rechaza con 400.',
  })
  @ApiCreatedResponse({
    description: 'Restaurante registrado, con sus horarios.',
    type: RestaurantProfileResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos (nombre o dirección vacíos o muy largos, categoría fuera de la lista, ningún día abierto, un día repetido, horas que no están en HH:MM o iguales, horas en un día de 24 horas) o campos no permitidos. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [
        'Escribe la dirección de tu restaurante.',
        'El lunes: escribe la hora de apertura en formato HH:MM, por ejemplo 09:30.',
      ],
      error: 'Bad Request',
    },
  })
  @ApiConflictResponse({
    description:
      'El usuario ya tiene un restaurante registrado: no se crea otro. Conviene llevarlo a la pantalla de mesas.',
    type: ErrorResponseDto,
    example: {
      statusCode: 409,
      message: ALREADY_REGISTERED_MESSAGE,
      error: 'Conflict',
    },
  })
  async register(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: RegisterRestaurantDto,
  ): Promise<RestaurantProfileResponseDto> {
    const { restaurant, schedules } = await this.registrationService.register(
      user,
      dto,
    );
    return RestaurantProfileResponseDto.fromEntities(restaurant, schedules);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Consultar el restaurante del usuario',
    description:
      'Devuelve el restaurante del usuario de la sesión con sus horarios. Mismos campos que PATCH /restaurants/me, más schedules.',
  })
  @ApiOkResponse({
    description: 'Restaurante del usuario, con sus horarios.',
    type: RestaurantProfileResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'El usuario todavía no registra su restaurante (errorCode: RESTAURANT_REQUIRED): hay que llevarlo al registro del restaurante.',
    type: ErrorResponseDto,
    example: {
      statusCode: 403,
      message: RESTAURANT_REQUIRED_MESSAGE,
      error: 'Forbidden',
      errorCode: RESTAURANT_REQUIRED_CODE,
    },
  })
  async findMine(
    @CurrentUser() user: CurrentUserData,
  ): Promise<RestaurantProfileResponseDto> {
    const { restaurant, schedules } = await this.registrationService.findMine(
      user.restaurantId,
    );
    return RestaurantProfileResponseDto.fromEntities(restaurant, schedules);
  }
}
