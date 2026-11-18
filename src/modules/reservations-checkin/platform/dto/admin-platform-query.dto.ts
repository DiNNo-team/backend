import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PageField, PageSizeField } from '../../../../common/dto/page-query.js';
import { BILLING_MONTH_MESSAGES } from '../../billing/billing-month.js';
import {
  BILLING_PAGE_SIZE_DEFAULT,
  BILLING_PAGE_SIZE_MAX,
} from '../../reports/dto/report-query.dto.js';

export const ADMIN_LIST_PAGE_SIZE_MAX = 100;
export const ADMIN_LIST_PAGE_SIZE_DEFAULT = 20;

// Mes de los reportes del administrador (AAAA-MM, Bogotá). El formato y el rango
// los revisa parseBillingMonth, que conoce el mes en curso; aquí solo que sea
// texto (un parámetro repetido llega como lista y da 400). Cualquier otro
// parámetro da 400.
export class AdminMonthQueryDto {
  @ApiPropertyOptional({
    description:
      'Mes (AAAA-MM, hora de Bogotá), desde 2026-01 hasta el mes en curso. Por defecto, el mes en curso.',
    example: '2026-11',
  })
  @IsOptional()
  @IsString({ message: BILLING_MONTH_MESSAGES.INVALID })
  month?: string;
}

// Mes más paginación de las listas por restaurante (cobro y directorio).
export class AdminMonthPageQueryDto extends AdminMonthQueryDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @PageField()
  page?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: ADMIN_LIST_PAGE_SIZE_MAX,
    default: ADMIN_LIST_PAGE_SIZE_DEFAULT,
  })
  @PageSizeField(ADMIN_LIST_PAGE_SIZE_MAX)
  pageSize?: number;
}

// Mes más paginación de los check-ins de un restaurante (mismos límites que el
// estado de cuenta del restaurante).
export class AdminBillingDetailQueryDto extends AdminMonthQueryDto {
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
