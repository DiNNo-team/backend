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
  SEARCH_ALL_RESULTS_LIMIT,
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
    summary: 'Buscar restaurantes, con o sin ubicación, con filtros',
    description: `Sin radiusKm: todos los restaurantes que se pueden reservar (máximo ${SEARCH_ALL_RESULTS_LIMIT}). Con radiusKm: los que están dentro del radio alrededor de la ubicación del comensal (lat y lng) o del centro de una zona (zone), máximo ${SEARCH_RESULTS_LIMIT}. Ubicación y zona son opcionales y nunca van juntas; el radio necesita una de las dos. Solo aparecen los que tienen ubicación, están abiertos ahora (hora de Bogotá) y tienen al menos una mesa activa. Filtros opcionales y combinables: category (una categoría) y partySize (solo los que tienen una mesa libre y activa para todo el grupo). Con ubicación o zona se ordenan por distancia y traen distanceKm; sin ellas, por nombre y con distanceKm null. Sin resultados, []. Nunca se expone cuántas mesas hay ni cuántas están libres.`,
  })
  @ApiOkResponse({
    description: `Del más cercano al más lejano (o por nombre sin ubicación), máximo ${SEARCH_RESULTS_LIMIT} con radio y ${SEARCH_ALL_RESULTS_LIMIT} sin radio.`,
    type: SearchResultDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description:
      'Llegan ubicación y zona a la vez, llega solo lat o solo lng, llega radiusKm sin ubicación ni zona, una coordenada no es válida, la zona no existe, radiusKm no es 1, 2, 5 ni 10, category no es de la lista, partySize no es un entero de 1 a 20, o llega un parámetro que no existe. message es una lista.',
    type: ErrorResponseDto,
    examples: {
      bothOrigins: badRequestExample(
        'Ubicación y zona a la vez',
        SEARCH_MESSAGES.BOTH_ORIGINS,
      ),
      radiusWithoutOrigin: badRequestExample(
        'Radio sin ubicación ni zona',
        SEARCH_MESSAGES.RADIUS_WITHOUT_ORIGIN,
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
