import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import { DEFAULT_PAGE } from '../../../common/dto/page-query.js';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator.js';
import {
  CurrentUserGuard,
  Roles,
  UserRole,
} from '../../identity-access/index.js';
import { ReportPeriodQueryDto } from '../reports/dto/report-query.dto.js';
import { REPORT_PERIOD_MESSAGES } from '../reports/report-period.js';
import {
  AdminPlatformDocs,
  MONTH_BAD_REQUEST,
} from './admin-platform.swagger.js';
import {
  ADMIN_LIST_PAGE_SIZE_DEFAULT,
  AdminMonthPageQueryDto,
  AdminMonthQueryDto,
} from './dto/admin-platform-query.dto.js';
import {
  AdminActivityPageDto,
  AdminOverviewDto,
  PlatformMetricsDto,
} from './dto/admin-platform-response.dto.js';
import { PlatformReportsService } from './platform-reports.service.js';

// Resumen, directorio y métricas de toda la plataforma (panel del
// administrador de DiNNo, Sprint 4). Solo datos de negocio de los
// restaurantes: nunca de los comensales.
@AdminPlatformDocs()
@Roles(UserRole.PLATFORM_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('admin')
export class AdminPlatformController {
  constructor(private readonly reports: PlatformReportsService) {}

  @Get('overview')
  @RateLimit('adminReports')
  @ApiOperation({
    summary: 'Resumen de la plataforma',
    description:
      'Ingresos (SUM de la tarifa guardada en cada check-in) y check-ins del mes, el mes anterior, los últimos 12 meses (también en 0), lo cobrado y lo pendiente de todos los meses cerrados desde 2026-01 (restaurantes aprobados y suspendidos) y cuántos restaurantes hay en cada estado. month por defecto, el mes en curso (Bogotá).',
  })
  @ApiOkResponse({ type: AdminOverviewDto })
  @ApiBadRequestResponse(MONTH_BAD_REQUEST)
  overview(@Query() query: AdminMonthQueryDto): Promise<AdminOverviewDto> {
    return this.reports.overview(this.reports.resolveMonth(query.month));
  }

  @Get('activity')
  @RateLimit('adminReports')
  @ApiOperation({
    summary: 'Directorio de restaurantes con su actividad',
    description:
      'Restaurantes aprobados y suspendidos, por nombre: estado, abierto o cerrado, cuándo se aprobó (approvedAt, o null si lo aprobó el equipo: usar createdAt), check-ins y monto del mes, y lastTableActivityAt (el último cambio en la bitácora de sus mesas, o null). month por defecto, el mes en curso.',
  })
  @ApiOkResponse({ type: AdminActivityPageDto })
  @ApiBadRequestResponse(MONTH_BAD_REQUEST)
  activity(
    @Query() query: AdminMonthPageQueryDto,
  ): Promise<AdminActivityPageDto> {
    return this.reports.activity(this.reports.resolveMonth(query.month), {
      page: query.page ?? DEFAULT_PAGE,
      pageSize: query.pageSize ?? ADMIN_LIST_PAGE_SIZE_DEFAULT,
    });
  }

  @Get('platform/metrics')
  @RateLimit('adminReports')
  @ApiOperation({
    summary: 'Métricas de reservas de toda la plataforma',
    description:
      'Periodo en días de Bogotá, inclusivo (from..to, AAAA-MM-DD); por defecto, del día 1 del mes en curso hasta hoy; máximo 366 días. Antes de contar vence todas las reservas debidas. Todo se cuenta sobre las reservas creadas en el periodo (basis: reservations_created_at), por estado actual, con las mismas fórmulas del resumen del restaurante. peakHours: las 24 horas (0 a 23); byDayOfWeek: 7 entradas; byDate: una entrada por cada día del periodo, con los días en 0; byDayHour: siempre 168 entradas (día de la semana × hora). Las sumas de byDate y byDayHour son reservations.created.',
  })
  @ApiOkResponse({ type: PlatformMetricsDto })
  @ApiBadRequestResponse({
    description:
      'from o to no tienen el formato AAAA-MM-DD o no son fechas reales, from es posterior a to, to es posterior a hoy (Bogotá), el periodo pasa de 366 días, o llega un parámetro que no existe. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [REPORT_PERIOD_MESSAGES.FROM_AFTER_TO],
      error: 'Bad Request',
    },
  })
  metrics(@Query() query: ReportPeriodQueryDto): Promise<PlatformMetricsDto> {
    return this.reports.platformMetrics(query);
  }
}
