import { ApiProperty } from '@nestjs/swagger';
import { REPORT_TIMEZONE } from '../report-period.js';

export class ReportPeriodDto {
  @ApiProperty({
    description: 'Primer día (AAAA-MM-DD), inclusivo.',
    example: '2026-11-01',
  })
  from: string;

  @ApiProperty({
    description: 'Último día (AAAA-MM-DD), inclusivo.',
    example: '2026-11-15',
  })
  to: string;

  @ApiProperty({ enum: [REPORT_TIMEZONE], example: REPORT_TIMEZONE })
  timezone: typeof REPORT_TIMEZONE;
}

// ---- Estado de cuenta: GET /v1/restaurants/me/billing/check-ins ----

export class BillingItemDto {
  @ApiProperty({ format: 'uuid' })
  checkInId: string;

  @ApiProperty({ format: 'uuid' })
  reservationId: string;

  @ApiProperty({
    description: 'ISO 8601 UTC.',
    example: '2026-11-15T17:05:00.000Z',
  })
  checkedInAt: string;

  @ApiProperty({ type: 'integer', example: 4 })
  partySize: number;

  @ApiProperty({
    description: 'Identificador actual de la mesa.',
    example: '04',
  })
  tableIdentifier: string;

  @ApiProperty({
    description:
      'Tarifa cobrada por este check-in, en pesos colombianos: la vigente cuando se hizo (no cambia aunque cambie la tarifa).',
    type: 'integer',
    example: 2000,
  })
  feeCop: number;
}

export class BillingStatementResponseDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({
    description: 'Check-ins del periodo completo (todas las páginas).',
    type: 'integer',
    example: 12,
  })
  totalCheckIns: number;

  @ApiProperty({
    description: 'Suma de feeCop del periodo completo, en COP.',
    type: 'integer',
    example: 24000,
  })
  amountCop: number;

  @ApiProperty({
    type: [BillingItemDto],
    description: 'El check-in más reciente primero.',
  })
  items: BillingItemDto[];

  @ApiProperty({ type: 'integer', example: 1 })
  page: number;

  @ApiProperty({ type: 'integer', example: 50 })
  pageSize: number;

  @ApiProperty({
    description: 'Hora del servidor (ISO 8601 UTC).',
    example: '2026-11-15T17:30:00.000Z',
  })
  serverTime: string;
}
