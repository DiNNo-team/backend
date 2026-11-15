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

// ---- Resumen: GET /v1/restaurants/me/summary ----

export class SummaryBillingDto {
  @ApiProperty({
    description: 'Check-ins con checked_in_at dentro del periodo.',
    type: 'integer',
    example: 12,
  })
  checkIns: number;

  @ApiProperty({
    description: 'Suma de la tarifa guardada en esos check-ins, en COP.',
    type: 'integer',
    example: 24000,
  })
  amountCop: number;

  @ApiProperty({
    description: 'Tarifa vigente hoy por check-in (CHECKIN_FEE_COP), en COP.',
    type: 'integer',
    example: 2000,
  })
  currentFeeCop: number;
}

export class SummaryReservationsDto {
  @ApiProperty({
    description: 'Reservas creadas en el periodo (hora de Bogotá).',
    type: 'integer',
    example: 20,
  })
  created: number;

  @ApiProperty({
    description: 'De las creadas, las cumplidas (check-in).',
    type: 'integer',
    example: 12,
  })
  completed: number;

  @ApiProperty({
    description: 'De las creadas, las canceladas por el comensal.',
    type: 'integer',
    example: 4,
  })
  cancelled: number;

  @ApiProperty({
    description: 'De las creadas, las vencidas sin llegar (no-show).',
    type: 'integer',
    example: 3,
  })
  expired: number;

  @ApiProperty({
    description: 'De las creadas, las que siguen activas ahora.',
    type: 'integer',
    example: 1,
  })
  active: number;
}

export class SummaryRatesDto {
  @ApiProperty({
    description:
      'completed / created, con 4 decimales; null sin reservas creadas.',
    type: Number,
    nullable: true,
    example: 0.6,
  })
  conversion: number | null;

  @ApiProperty({
    description:
      'expired / (completed + expired), con 4 decimales; null si no hay ni cumplidas ni vencidas.',
    type: Number,
    nullable: true,
    example: 0.2,
  })
  noShow: number | null;

  @ApiProperty({
    description:
      'cancelled / created, con 4 decimales; null sin reservas creadas.',
    type: Number,
    nullable: true,
    example: 0.2,
  })
  cancellation: number | null;
}

export class PeakHourDto {
  @ApiProperty({
    description: 'Hora del día en Bogotá, de 0 a 23.',
    type: 'integer',
    example: 13,
  })
  hour: number;

  @ApiProperty({ type: 'integer', example: 6 })
  reservations: number;
}

export class DayOfWeekDto {
  @ApiProperty({
    description: '1 = lunes … 7 = domingo (Bogotá).',
    type: 'integer',
    example: 5,
  })
  dayOfWeek: number;

  @ApiProperty({ type: 'integer', example: 7 })
  reservations: number;
}

export class RestaurantSummaryResponseDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ type: SummaryBillingDto })
  billing: SummaryBillingDto;

  @ApiProperty({ type: SummaryReservationsDto })
  reservations: SummaryReservationsDto;

  @ApiProperty({ type: SummaryRatesDto })
  rates: SummaryRatesDto;

  @ApiProperty({
    description:
      'Promedio de personas de las reservas creadas, con 2 decimales; null si no hay.',
    type: Number,
    nullable: true,
    example: 2.75,
  })
  averagePartySize: number | null;

  @ApiProperty({
    description:
      'Las 3 horas (Bogotá) con más reservas creadas, de mayor a menor; a igual cantidad, la hora menor primero. Vacío si no hay reservas.',
    type: [PeakHourDto],
  })
  peakHours: PeakHourDto[];

  @ApiProperty({
    description:
      'Siempre 7 entradas, de lunes a domingo, con 0 en los días sin reservas.',
    type: [DayOfWeekDto],
  })
  byDayOfWeek: DayOfWeekDto[];

  @ApiProperty({
    description: 'Hora del servidor (ISO 8601 UTC).',
    example: '2026-11-15T17:30:00.000Z',
  })
  serverTime: string;
}
