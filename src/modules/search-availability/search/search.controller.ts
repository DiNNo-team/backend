import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
  CurrentUserGuard,
  DINER_ENDPOINT_ACCOUNT_EXAMPLES,
  Roles,
  SESSION_UNAUTHORIZED_RESPONSE,
  UserRole,
} from '../../identity-access/index.js';
import {
  SEARCH_MESSAGES,
  SearchRestaurantsQueryDto,
} from './dto/search-restaurants-query.dto.js';
import {
  SearchResultDto,
  ZoneResponseDto,
} from './dto/search-responses.dto.js';
import {
  RestaurantSearchService,
  SEARCH_RESULTS_LIMIT,
} from './restaurant-search.service.js';
import { listZones } from './zones.js';

function badRequestExample(summary: string, message: string) {
  return {
    summary,
    value: { statusCode: 400, message: [message], error: 'Bad Request' },
  };
}

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
@Controller('search')
export class SearchController {
  constructor(private readonly search: RestaurantSearchService) {}

  @Get('zones')
  @ApiOperation({
    summary: 'Listar las zonas de búsqueda',
    description:
      'Las 20 zonas de Bogotá en las que el comensal puede buscar sin compartir su ubicación, ordenadas por nombre. Cada una trae su punto central aproximado.',
  })
  @ApiOkResponse({
    description: 'Zonas ordenadas por nombre.',
    type: ZoneResponseDto,
    isArray: true,
  })
  zones(): ZoneResponseDto[] {
    return listZones().map((zone) => ZoneResponseDto.fromZone(zone));
  }

  @Get('restaurants')
  @ApiOperation({
    summary: 'Buscar restaurantes por ubicación o por zona, con filtros',
    description: `Restaurantes dentro del radio (por defecto 2 km) alrededor de la ubicación del comensal (lat y lng) o del centro de una zona (zone), nunca las dos. Solo aparecen los que tienen ubicación, están abiertos ahora (hora de Bogotá) y tienen al menos una mesa activa. Filtros opcionales y combinables: category (una categoría) y partySize (solo los que tienen una mesa libre y activa para todo el grupo). Ordenados por distancia, máximo ${SEARCH_RESULTS_LIMIT}. Sin resultados, []. Nunca se expone cuántas mesas hay ni cuántas están libres.`,
  })
  @ApiOkResponse({
    description: `Restaurantes del más cercano al más lejano, máximo ${SEARCH_RESULTS_LIMIT}.`,
    type: SearchResultDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description:
      'Faltan lat y lng o zone, llegan los dos modos, llega solo lat o solo lng, una coordenada no es válida, la zona no existe, radiusKm no es 1, 2, 5 ni 10, category no es de la lista, partySize no es un entero de 1 a 20, o llega un parámetro que no existe. message es una lista.',
    type: ErrorResponseDto,
    examples: {
      bothOrigins: badRequestExample(
        'Ubicación y zona a la vez',
        SEARCH_MESSAGES.BOTH_ORIGINS,
      ),
      noOrigin: badRequestExample(
        'Sin ubicación ni zona',
        SEARCH_MESSAGES.NO_ORIGIN,
      ),
      incompleteLocation: badRequestExample(
        'Solo lat o solo lng',
        SEARCH_MESSAGES.INCOMPLETE_LOCATION,
      ),
      unknownZone: badRequestExample(
        'Zona desconocida',
        SEARCH_MESSAGES.ZONE_UNKNOWN,
      ),
      invalidRadius: badRequestExample(
        'Radio fuera de la lista',
        SEARCH_MESSAGES.RADIUS_INVALID,
      ),
      invalidCategory: badRequestExample(
        'Categoría fuera de la lista',
        SEARCH_MESSAGES.CATEGORY_INVALID,
      ),
      invalidPartySize: badRequestExample(
        'Número de personas inválido',
        SEARCH_MESSAGES.PARTY_SIZE_INVALID,
      ),
    },
  })
  restaurants(
    @Query() query: SearchRestaurantsQueryDto,
  ): Promise<SearchResultDto[]> {
    return this.search.search(query);
  }
}
