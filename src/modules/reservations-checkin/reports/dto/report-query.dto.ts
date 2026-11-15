import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PageField, PageSizeField } from '../../../../common/dto/page-query.js';
import { REPORT_PERIOD_MESSAGES } from '../report-period.js';

export const BILLING_PAGE_SIZE_MAX = 200;
export const BILLING_PAGE_SIZE_DEFAULT = 50;

// Periodo de un reporte (from y to, días de Bogotá). El formato y el rango los
// revisa parseReportPeriod, que conoce la fecha de hoy; aquí solo que sean texto
// (un parámetro repetido llega como lista y da 400). Cualquier otro parámetro,
// también restaurantId, da 400: el restaurante sale de la sesión.
export class ReportPeriodQueryDto {
  @ApiPropertyOptional({
    description:
      'Primer día del periodo (AAAA-MM-DD, hora de Bogotá), inclusivo. Por defecto, el día 1 del mes de to.',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsString({ message: REPORT_PERIOD_MESSAGES.FROM_INVALID })
  from?: string;

  @ApiPropertyOptional({
    description:
      'Último día del periodo (AAAA-MM-DD, hora de Bogotá), inclusivo. Por defecto, hoy. No puede ser posterior a hoy; el periodo tiene como máximo 366 días.',
    example: '2026-11-15',
  })
  @IsOptional()
  @IsString({ message: REPORT_PERIOD_MESSAGES.TO_INVALID })
  to?: string;
}

export class BillingQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @PageField()
  page?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: BILLING_PAGE_SIZE_MAX,
    default: BILLING_PAGE_SIZE_DEFAULT,
  })
  @PageSizeField(BILLING_PAGE_SIZE_MAX)
  pageSize?: number;
}
