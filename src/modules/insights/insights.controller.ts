import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import {
  CurrentUser,
  CurrentUserGuard,
  RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
  Roles,
  SESSION_UNAUTHORIZED_RESPONSE,
  UserRole,
  type CurrentUserData,
} from '../identity-access/index.js';
import {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
  requireRestaurant,
} from '../restaurant-operations/index.js';
import { InsightsQueryDto } from './dto/insights-query.dto.js';
import { RestaurantInsightsResponseDto } from './dto/insights-response.dto.js';
import { InsightsService } from './insights.service.js';

// Informe inteligente del restaurante de la sesión (Sprint 4, Feature 2;
// docs/ia-diseno.md). Solo un restaurante aprobado: pendiente o rechazado
// reciben su 403, como los demás reportes.
@ApiTags('insights')
@ApiBearerAuth()
@ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE)
@ApiForbiddenResponse({
  description:
    'La cuenta no está habilitada como restaurante (ACCOUNT_NOT_ENABLED), es de comensal (DINER_ACCOUNT) o de administrador (ADMIN_ACCOUNT), el restaurante está en revisión o rechazado (ACCOUNT_PENDING_APPROVAL, ACCOUNT_REJECTED) o todavía no registra su restaurante (RESTAURANT_REQUIRED).',
  type: ErrorResponseDto,
  examples: {
    ...RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
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
@Roles(UserRole.RESTAURANT_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('restaurants/me')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('insights')
  @RateLimit('ai')
  @ApiOperation({
    summary: 'Informe inteligente del restaurante (IA)',
    description:
      'Métricas de los últimos 7 días de Bogotá (hoy incluido) comparadas con los 7 anteriores, un indicador de confiabilidad de la disponibilidad y 2 o 3 recomendaciones en español. El texto lo redacta un modelo de lenguaje solo a partir de números agregados (nunca recibe datos de comensales ni el nombre del restaurante); si no hay llave, falla, tarda o el texto no pasa la validación, sale de plantillas (narrative.source = template) y la respuesta sigue siendo 200. Con menos de 10 reservas resueltas, tasas y nivel llegan en null. El informe se guarda una hora (5 minutos si salió de plantillas); refresh=true lo genera de nuevo. Solo lectura: nunca cambia reservas ni mesas.',
  })
  @ApiOkResponse({ type: RestaurantInsightsResponseDto })
  @ApiBadRequestResponse({
    description:
      'refresh no es true ni false, o llega un parámetro que no existe.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: ['refresh debe ser true o false.'],
      error: 'Bad Request',
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'Más de 10 informes por minuto para la misma cuenta.',
    type: ErrorResponseDto,
  })
  insightsReport(
    @CurrentUser() user: CurrentUserData,
    @Query() query: InsightsQueryDto,
  ): Promise<RestaurantInsightsResponseDto> {
    return this.insights.forRestaurant(requireRestaurant(user.restaurantId), {
      refresh: query.refresh === 'true',
    });
  }
}
