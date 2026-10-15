import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  CurrentUserGuard,
  RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
  Roles,
  SESSION_UNAUTHORIZED_RESPONSE,
  UserRole,
} from '../../identity-access/index.js';
import {
  GEOCODE_QUERY_MESSAGES,
  GeocodeQueryDto,
  GeocodeResponseDto,
} from './dto/geocode.dto.js';
import { Geocoder } from './geocoder.js';
import {
  addressNotFound,
  GEOCODING_ERROR_MESSAGES,
  geocodingUnavailable,
} from './geocoding-errors.js';

// Address → coordinates for the restaurant location form. It does not call
// requireRestaurant on purpose: the registration form uses it before the
// restaurant exists, so it never answers RESTAURANT_REQUIRED.
@ApiTags('geocode')
@ApiBearerAuth()
@ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE)
@Roles(UserRole.RESTAURANT_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('geocode')
export class GeocodeController {
  constructor(private readonly geocoder: Geocoder) {}

  @Get()
  @ApiOperation({
    summary: 'Ubicar una dirección de Bogotá',
    description:
      'Convierte una dirección en coordenadas con Google Geocoding, restringido a Bogotá. Solo para restaurantes; no exige tener el restaurante registrado (lo usa el formulario de registro). Si no encuentra la dirección (404) o el servicio no responde (503), la web muestra el mapa centrado en Bogotá para mover el pin.',
  })
  @ApiOkResponse({
    description: 'Coordenadas dentro de Bogotá, con 6 decimales.',
    type: GeocodeResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Falta address, tiene menos de 3 o más de 255 caracteres, incluye caracteres invisibles o saltos de línea, o llega un parámetro que no existe. message es una lista.',
    type: ErrorResponseDto,
    examples: {
      tooShort: {
        summary: 'Dirección muy corta',
        value: {
          statusCode: 400,
          message: [GEOCODE_QUERY_MESSAGES.ADDRESS_TOO_SHORT],
          error: 'Bad Request',
        },
      },
      missing: {
        summary: 'Sin dirección',
        value: {
          statusCode: 400,
          message: [GEOCODE_QUERY_MESSAGES.ADDRESS_REQUIRED],
          error: 'Bad Request',
        },
      },
    },
  })
  @ApiForbiddenResponse({
    description:
      'La cuenta no está habilitada como restaurante (errorCode: ACCOUNT_NOT_ENABLED) o es de comensal (DINER_ACCOUNT). Nunca responde RESTAURANT_REQUIRED.',
    type: ErrorResponseDto,
    examples: RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
  })
  @ApiNotFoundResponse({
    description:
      'No hay un resultado para la dirección dentro de Bogotá. La web muestra el mapa centrado en Bogotá para mover el pin.',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      message: GEOCODING_ERROR_MESSAGES.ADDRESS_NOT_FOUND,
      error: 'Not Found',
      errorCode: 'ADDRESS_NOT_FOUND',
    },
  })
  @ApiServiceUnavailableResponse({
    description:
      'El servicio de mapas no está disponible: sin llave configurada, cuota agotada, error de Google o tiempo de espera (5 s). La web muestra el mapa centrado en Bogotá para mover el pin.',
    type: ErrorResponseDto,
    example: {
      statusCode: 503,
      message: GEOCODING_ERROR_MESSAGES.GEOCODING_UNAVAILABLE,
      error: 'Service Unavailable',
      errorCode: 'GEOCODING_UNAVAILABLE',
    },
  })
  async geocode(@Query() query: GeocodeQueryDto): Promise<GeocodeResponseDto> {
    const result = await this.geocoder.geocode(query.address);
    switch (result.kind) {
      case 'found':
        return {
          latitude: result.latitude,
          longitude: result.longitude,
          formattedAddress: result.formattedAddress,
        };
      case 'not_found':
        throw addressNotFound();
      case 'unavailable':
        throw geocodingUnavailable();
    }
  }
}
