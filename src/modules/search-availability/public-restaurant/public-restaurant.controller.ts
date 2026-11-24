import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
  CurrentUserGuard,
  DINER_ENDPOINT_ACCOUNT_EXAMPLES,
  Roles,
  SESSION_UNAUTHORIZED_RESPONSE,
  UserRole,
} from '../../identity-access/index.js';
import { LOCATION_MESSAGES } from '../location/location-fields.js';
import {
  PublicRestaurantQueryDto,
  PublicRestaurantResponseDto,
} from './dto/public-restaurant.dto.js';
import { PublicRestaurantService } from './public-restaurant.service.js';
import {
  RESTAURANT_NOT_FOUND_CODE,
  RESTAURANT_NOT_FOUND_MESSAGE,
  restaurantNotFound,
} from './restaurant-not-found.js';

// A malformed id is a 404 like an unknown one, not a 400: the app only
// handles the 404. Checked before the query, since Postgres rejects a
// malformed uuid with a 500.
const PublicRestaurantIdParam = () =>
  Param('id', new ParseUUIDPipe({ exceptionFactory: restaurantNotFound }));

// Lives under /restaurants next to the restaurant-operations routes
// (/restaurants, /restaurants/me, /restaurants/me/status): none of them has
// three segments ending in /public, so the paths never overlap.
@ApiTags('search')
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
@Controller('restaurants')
export class PublicRestaurantController {
  constructor(private readonly publicRestaurants: PublicRestaurantService) {}

  @Get(':id/public')
  @ApiOperation({
    summary: 'Consultar el detalle público de un restaurante',
    description:
      'Datos, horarios y disponibilidad de un restaurante para el comensal. Responde aunque esté cerrado: isOpenNow false y availability closed. Con lat y lng agrega distanceKm. Nunca se expone cuántas mesas hay ni cuántas están libres.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id del restaurante (el de la búsqueda).',
    example: '55bb0482-be1e-490b-9ba8-7533335d958b',
  })
  @ApiOkResponse({
    description: 'Detalle del restaurante.',
    type: PublicRestaurantResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Llega solo lat o solo lng, o una coordenada no es un número decimal en rango, o llega un parámetro que no existe. message es una lista.',
    type: ErrorResponseDto,
    examples: {
      incompleteLocation: {
        summary: 'Solo lat o solo lng',
        value: {
          statusCode: 400,
          message: [LOCATION_MESSAGES.INCOMPLETE_LOCATION],
          error: 'Bad Request',
        },
      },
      invalidLatitude: {
        summary: 'Latitud inválida',
        value: {
          statusCode: 400,
          message: [LOCATION_MESSAGES.LAT_INVALID],
          error: 'Bad Request',
        },
      },
    },
  })
  @ApiNotFoundResponse({
    description:
      'El id no es un UUID válido, el restaurante no existe o no tiene ubicación. La app muestra el mensaje con la opción de volver.',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      message: RESTAURANT_NOT_FOUND_MESSAGE,
      error: 'Not Found',
      errorCode: RESTAURANT_NOT_FOUND_CODE,
    },
  })
  findOne(
    @PublicRestaurantIdParam() id: string,
    @Query() query: PublicRestaurantQueryDto,
  ): Promise<PublicRestaurantResponseDto> {
    const origin =
      query.lat === undefined || query.lng === undefined
        ? undefined
        : { latitude: query.lat, longitude: query.lng };
    return this.publicRestaurants.getById(id, origin);
  }
}
