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
import { DEFAULT_PAGE } from '../../../common/dto/page-query.js';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  AllowSuspendedRestaurant,
  CurrentUser,
  CurrentUserGuard,
  RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
  Roles,
  SESSION_UNAUTHORIZED_RESPONSE,
  UserRole,
  type CurrentUserData,
} from '../../identity-access/index.js';
import {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
  requireRestaurant,
} from '../../restaurant-operations/index.js';
import {
  BILLING_PAGE_SIZE_DEFAULT,
  BillingQueryDto,
  ReportPeriodQueryDto,
} from './dto/report-query.dto.js';
import {
  BillingStatementResponseDto,
  RestaurantSummaryResponseDto,
} from './dto/report-response.dto.js';
import { REPORT_PERIOD_MESSAGES } from './report-period.js';
import { RestaurantReportsService } from './restaurant-reports.service.js';

const PERIOD_BAD_REQUEST = {
  description:
    'from o to no tienen el formato AAAA-MM-DD o no son fechas reales, from es posterior a to, to es posterior a hoy (Bogotá), el periodo pasa de 366 días, page o pageSize fuera de rango, o llega un parámetro que no existe. message es una lista.',
  type: ErrorResponseDto,
  example: {
    statusCode: 400,
    message: [REPORT_PERIOD_MESSAGES.FROM_AFTER_TO],
    error: 'Bad Request',
  },
};

// Reportes del restaurante de la sesión: estado de cuenta y resumen (KPIs).
// Solo un restaurante aprobado: pendiente o rechazado reciben 403 (§11).
@ApiTags('restaurant-reports')
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
export class RestaurantReportsController {
  constructor(private readonly reports: RestaurantReportsService) {}

  @Get('summary')
  // Solo lectura para un suspendido: ve lo que se le cobra.
  @AllowSuspendedRestaurant()
  @ApiOperation({
    summary: 'Resumen del restaurante: cobro y KPIs de un periodo',
    description:
      'Periodo en días de Bogotá, inclusivo (from..to, AAAA-MM-DD); por defecto, del día 1 del mes en curso hasta hoy; máximo 366 días. Antes de calcular vence las reservas debidas del restaurante. reservations: reservas con created_at dentro del periodo, por estado actual. billing: check-ins con checked_in_at dentro del periodo, amountCop = suma del total guardado en cada uno (feeCop), currentFeePerGuestCop = tarifa por comensal vigente (informativa). rates: conversion = completed / created, noShow = expired / (completed + expired), cancellation = cancelled / created, con 4 decimales y null si el denominador es 0. averagePartySize sobre las creadas (2 decimales; null si no hay). peakHours: las 3 horas con más reservas creadas (desempate por hora menor). byDayOfWeek: 7 entradas (1 = lunes … 7 = domingo) con 0 si no hay datos. Para la pantalla Resumen agrega: billing.guests (personas de los check-ins), previousComparable (el mismo tramo del periodo anterior), byDate (una entrada por día, con ceros), byDayHour (168 celdas), monthly (6 meses de comensales) y payment (estado de pago del mes del periodo y del mes anterior). Contrato completo: docs/restaurant-summary-contract.md. Nunca trae datos de los comensales.',
  })
  @ApiOkResponse({ type: RestaurantSummaryResponseDto })
  @ApiBadRequestResponse(PERIOD_BAD_REQUEST)
  summary(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ReportPeriodQueryDto,
  ): Promise<RestaurantSummaryResponseDto> {
    return this.reports.summary(requireRestaurant(user.restaurantId), query);
  }

  @Get('billing/check-ins')
  @AllowSuspendedRestaurant()
  @ApiOperation({
    summary: 'Estado de cuenta: check-ins cobrados en un periodo',
    description:
      'Cada check-in válido es un evento facturable. feeCop es el total cobrado: personas de la reserva × la tarifa por comensal vigente cuando se hizo (los check-ins anteriores al cobro por comensal conservan su monto). partySize viene en cada fila. Periodo en días de Bogotá, inclusivo (from..to, AAAA-MM-DD); por defecto, del día 1 del mes en curso hasta hoy; máximo 366 días; filtrado por checked_in_at. totalCheckIns y amountCop son del periodo completo; items es una página (pageSize por defecto 50, máximo 200), el más reciente primero. Nunca trae datos del comensal.',
  })
  @ApiOkResponse({ type: BillingStatementResponseDto })
  @ApiBadRequestResponse(PERIOD_BAD_REQUEST)
  billing(
    @CurrentUser() user: CurrentUserData,
    @Query() query: BillingQueryDto,
  ): Promise<BillingStatementResponseDto> {
    return this.reports.billingStatement(requireRestaurant(user.restaurantId), {
      from: query.from,
      to: query.to,
      page: query.page ?? DEFAULT_PAGE,
      pageSize: query.pageSize ?? BILLING_PAGE_SIZE_DEFAULT,
    });
  }
}
