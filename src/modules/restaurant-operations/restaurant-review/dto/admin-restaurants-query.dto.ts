import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PageField, PageSizeField } from '../../../../common/dto/page-query.js';
import {
  RESTAURANT_APPROVAL_STATUSES,
  type RestaurantApprovalStatus,
} from '../../../identity-access/index.js';

export const ADMIN_PAGE_SIZE_MAX = 100;
export const ADMIN_PAGE_SIZE_DEFAULT = 20;

export const APPROVAL_STATUS_INVALID = `El estado de la solicitud (status) debe ser uno de estos: ${RESTAURANT_APPROVAL_STATUSES.join(', ')}.`;

// Query de GET /v1/admin/restaurants. Cualquier otro parámetro da 400.
export class AdminRestaurantsQueryDto {
  @ApiPropertyOptional({
    enum: RESTAURANT_APPROVAL_STATUSES,
    default: 'pending',
    description: 'Estado de las solicitudes que se quieren ver.',
  })
  @IsOptional()
  @IsIn(RESTAURANT_APPROVAL_STATUSES, { message: APPROVAL_STATUS_INVALID })
  status?: RestaurantApprovalStatus;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @PageField()
  page?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: ADMIN_PAGE_SIZE_MAX,
    default: ADMIN_PAGE_SIZE_DEFAULT,
  })
  @PageSizeField(ADMIN_PAGE_SIZE_MAX)
  pageSize?: number;
}
