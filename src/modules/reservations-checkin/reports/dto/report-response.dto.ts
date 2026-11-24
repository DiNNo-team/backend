import { ApiProperty } from '@nestjs/swagger';
import {
  BILLING_STATUSES,
  type BillingStatus,
} from '../../billing/billing-status.js';
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
      'Total cobrado por este check-in, en pesos colombianos. Desde el cobro por comensal es partySize × la tarifa por comensal vigente cuando se hizo; los check-ins anteriores conservan el monto que se les cobró entonces. No cambia aunque cambie la tarifa.',
    type: 'integer',
    example: 6000,
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
    example: 18000,
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
    description: 'Suma del total cobrado en esos check-ins (feeCop), en COP.',
    type: 'integer',
    example: 18000,
  })
  amountCop: number;

  @ApiProperty({
    description:
      'Tarifa por comensal vigente hoy (CHECKIN_FEE_PER_GUEST_COP), en COP. Es informativa: el monto de cada check-in es el que se guardó al hacerlo.',
    type: 'integer',
    example: 1500,
  })
  currentFeePerGuestCop: number;
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

export class SummaryBillingGuestsDto extends SummaryBillingDto {
  @ApiProperty({
    description:
      'Suma de las personas (party_size) de las reservas de esos check-ins: los comensales que llegaron.',
    type: 'integer',
    example: 13,
  })
  guests: number;
}

export class SummaryComparableDto {
  @ApiProperty({
    description:
      'El mismo tramo del periodo anterior. Si el periodo empieza el día 1 de un mes y no sale de él: del día 1 al mismo día del mes anterior (recortado a su último día; si el periodo llega al último día de su mes, el anterior también). Si no: los mismos N días justo antes.',
    type: ReportPeriodDto,
  })
  period: ReportPeriodDto;

  @ApiProperty({ type: 'integer', example: 15 })
  reservationsCreated: number;

  @ApiProperty({ type: 'integer', example: 4 })
  checkIns: number;

  @ApiProperty({ type: 'integer', example: 9 })
  guests: number;

  @ApiProperty({ type: 'integer', example: 8000 })
  amountCop: number;
}

export class SummaryDayDto {
  @ApiProperty({
    description: 'Día de Bogotá (AAAA-MM-DD).',
    example: '2026-11-08',
  })
  date: string;

  @ApiProperty({
    description: 'Reservas creadas ese día (hora de Bogotá).',
    type: 'integer',
    example: 4,
  })
  reservationsCreated: number;

  @ApiProperty({
    description: 'Check-ins hechos ese día (hora de Bogotá).',
    type: 'integer',
    example: 2,
  })
  checkIns: number;

  @ApiProperty({
    description: 'Personas de los check-ins hechos ese día.',
    type: 'integer',
    example: 4,
  })
  guests: number;

  @ApiProperty({
    description: 'De las reservas creadas ese día, las canceladas hoy.',
    type: 'integer',
    example: 1,
  })
  cancelled: number;

  @ApiProperty({
    description: 'De las reservas creadas ese día, las vencidas sin llegar.',
    type: 'integer',
    example: 1,
  })
  expired: number;
}

export class SummaryDayHourDto {
  @ApiProperty({
    description: '1 = lunes … 7 = domingo (Bogotá).',
    type: 'integer',
    example: 7,
  })
  dayOfWeek: number;

  @ApiProperty({
    description: 'Hora de 0 a 23 (Bogotá).',
    type: 'integer',
    example: 19,
  })
  hour: number;

  @ApiProperty({ type: 'integer', example: 3 })
  reservations: number;
}

export class SummaryMonthDto {
  @ApiProperty({ description: 'Mes de Bogotá (AAAA-MM).', example: '2026-11' })
  month: string;

  @ApiProperty({
    description: 'Comensales de los check-ins del mes.',
    type: 'integer',
    example: 13,
  })
  guests: number;

  @ApiProperty({ type: 'integer', example: 6 })
  checkIns: number;

  @ApiProperty({
    description: 'true para el mes en curso (todavía no termina).',
    example: true,
  })
  inProgress: boolean;
}

export class SummaryPaymentMonthDto {
  @ApiProperty({ description: 'Mes de Bogotá (AAAA-MM).', example: '2026-10' })
  month: string;

  @ApiProperty({
    description:
      'in_progress: el mes todavía no termina. pending: mes cerrado que el administrador no marcó como pagado. paid: marcado como pagado.',
    enum: BILLING_STATUSES,
    example: 'paid',
  })
  status: BillingStatus;

  @ApiProperty({ type: 'integer', example: 4 })
  checkIns: number;

  @ApiProperty({
    description:
      'Total del mes completo (hasta hoy si está en curso), en COP: la suma de la tarifa guardada en cada check-in. Si está pagado, el valor guardado al marcarlo.',
    type: 'integer',
    example: 8000,
  })
  amountCop: number;
}

export class SummaryPaymentDto {
  @ApiProperty({
    description:
      'El mes de `to`, solo si el periodo cae dentro de un único mes calendario y es de 2026-01 en adelante; si no, null.',
    type: SummaryPaymentMonthDto,
    nullable: true,
  })
  period: SummaryPaymentMonthDto | null;

  @ApiProperty({
    description: 'El mes anterior al mes de `to` (null antes de 2026-01).',
    type: SummaryPaymentMonthDto,
    nullable: true,
  })
  previousMonth: SummaryPaymentMonthDto | null;
}

export class RestaurantSummaryResponseDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ type: SummaryBillingGuestsDto })
  billing: SummaryBillingGuestsDto;

  @ApiProperty({ type: SummaryComparableDto })
  previousComparable: SummaryComparableDto;

  @ApiProperty({
    description:
      'Una entrada por cada día del periodo (también los días en 0), del más antiguo al más reciente.',
    type: [SummaryDayDto],
  })
  byDate: SummaryDayDto[];

  @ApiProperty({
    description: 'Siempre 168 celdas (7 días × 24 horas) de reservas creadas.',
    type: [SummaryDayHourDto],
  })
  byDayHour: SummaryDayHourDto[];

  @ApiProperty({
    description:
      'Los 6 meses que terminan en el mes de `to`, del más antiguo al más reciente (también los meses en 0).',
    type: [SummaryMonthDto],
  })
  monthly: SummaryMonthDto[];

  @ApiProperty({ type: SummaryPaymentDto })
  payment: SummaryPaymentDto;

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
