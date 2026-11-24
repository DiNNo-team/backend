import { ApiProperty } from '@nestjs/swagger';
import {
  RESTAURANT_APPROVAL_STATUSES,
  type RestaurantApprovalStatus,
} from '../../../identity-access/index.js';
import {
  RESTAURANT_CATEGORIES,
  type RestaurantCategory,
} from '../../../restaurant-operations/index.js';
import {
  ReportPeriodDto,
  SummaryRatesDto,
  SummaryReservationsDto,
} from '../../reports/dto/report-response.dto.js';

// Respuestas del panel del administrador de DiNNo (Sprint 4). Solo datos de
// negocio de los restaurantes: nunca correos, nombres de comensales, diner_id,
// códigos de reserva ni la bitácora de mesas (lo fijan las pruebas de claves).

export const MONTH_STATUSES = ['in_progress', 'closed'] as const;
export type MonthStatus = (typeof MONTH_STATUSES)[number];

export const BILLING_STATUSES = ['in_progress', 'pending', 'paid'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

const MONTH_EXAMPLE = '2026-11';

export class MonthTotalsDto {
  @ApiProperty({ description: 'Mes (AAAA-MM, Bogotá).', example: '2026-10' })
  month: string;

  @ApiProperty({
    description: 'Suma de la tarifa guardada en cada check-in del mes (COP).',
    type: 'integer',
    example: 48000,
  })
  revenueCop: number;

  @ApiProperty({ type: 'integer', example: 24 })
  checkIns: number;
}

export class RestaurantStatusCountsDto {
  @ApiProperty({ type: 'integer', example: 2 })
  pending: number;

  @ApiProperty({ type: 'integer', example: 15 })
  approved: number;

  @ApiProperty({ type: 'integer', example: 1 })
  suspended: number;

  @ApiProperty({ type: 'integer', example: 0 })
  rejected: number;
}

export class AdminOverviewDto {
  @ApiProperty({ example: MONTH_EXAMPLE })
  month: string;

  @ApiProperty({
    enum: MONTH_STATUSES,
    description:
      'in_progress = el mes en curso en Bogotá; closed = ya terminó.',
  })
  monthStatus: MonthStatus;

  @ApiProperty({ type: 'integer', example: 52000 })
  revenueCop: number;

  @ApiProperty({ type: 'integer', example: 26 })
  checkIns: number;

  @ApiProperty({ example: '2026-10' })
  previousMonth: string;

  @ApiProperty({ type: 'integer', example: 48000 })
  previousRevenueCop: number;

  @ApiProperty({
    description:
      'Los 12 meses que terminan en month, del más antiguo al más reciente, también los meses en 0.',
    type: [MonthTotalsDto],
  })
  monthly: MonthTotalsDto[];

  @ApiProperty({
    description:
      'Cobrado: suma de los montos guardados al marcar como cobrados los meses cerrados (desde 2026-01) de los restaurantes aprobados y suspendidos.',
    type: 'integer',
    example: 96000,
  })
  collectedCop: number;

  @ApiProperty({
    description:
      'Pendiente: monto recalculado de los meses cerrados (desde 2026-01) que no están marcados como cobrados, de los restaurantes aprobados y suspendidos.',
    type: 'integer',
    example: 48000,
  })
  pendingCop: number;

  @ApiProperty({ type: RestaurantStatusCountsDto })
  restaurants: RestaurantStatusCountsDto;

  @ApiProperty({
    description:
      'Tarifa por comensal vigente hoy (CHECKIN_FEE_PER_GUEST_COP), en COP. Es informativa: el monto de cada check-in es el que se guardó al hacerlo.',
    type: 'integer',
    example: 1500,
  })
  currentFeePerGuestCop: number;

  @ApiProperty({ example: '2026-11-17T15:00:00.000Z' })
  serverTime: string;
}

export class BillingTotalsDto {
  @ApiProperty({ type: 'integer', example: 26 })
  checkIns: number;

  @ApiProperty({ type: 'integer', example: 52000 })
  amountCop: number;

  @ApiProperty({
    description:
      'Suma de los montos guardados de los restaurantes marcados como cobrados en el mes (0 en el mes en curso).',
    type: 'integer',
    example: 20000,
  })
  paidCop: number;

  @ApiProperty({
    description:
      'Monto recalculado de los restaurantes sin marcar como cobrados (0 en el mes en curso: todavía no se cobra).',
    type: 'integer',
    example: 32000,
  })
  pendingCop: number;
}

export class AdminBillingItemDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId: string;

  @ApiProperty({ example: 'Casa 72' })
  name: string;

  @ApiProperty({ enum: RESTAURANT_APPROVAL_STATUSES, example: 'approved' })
  approvalStatus: RestaurantApprovalStatus;

  @ApiProperty({ type: 'integer', example: 12 })
  checkIns: number;

  @ApiProperty({ type: 'integer', example: 24000 })
  amountCop: number;

  @ApiProperty({
    enum: BILLING_STATUSES,
    description:
      'in_progress = mes en curso (no se puede marcar); pending = mes cerrado sin cobrar; paid = marcado como cobrado.',
  })
  status: BillingStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cuándo se marcó como cobrado (ISO 8601 UTC); null si no.',
    example: null,
  })
  paidAt: string | null;
}

export class AdminBillingPageDto {
  @ApiProperty({ example: MONTH_EXAMPLE })
  month: string;

  @ApiProperty({ enum: MONTH_STATUSES })
  monthStatus: MonthStatus;

  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ type: BillingTotalsDto })
  totals: BillingTotalsDto;

  @ApiProperty({
    description:
      'Restaurantes aprobados y suspendidos, también con 0 check-ins, de mayor a menor monto.',
    type: [AdminBillingItemDto],
  })
  items: AdminBillingItemDto[];

  @ApiProperty({ type: 'integer', example: 16 })
  total: number;

  @ApiProperty({ type: 'integer', example: 1 })
  page: number;

  @ApiProperty({ type: 'integer', example: 20 })
  pageSize: number;

  @ApiProperty({ example: '2026-11-17T15:00:00.000Z' })
  serverTime: string;
}

export class BillingRestaurantDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Casa 72' })
  name: string;

  @ApiProperty({ enum: RESTAURANT_APPROVAL_STATUSES, example: 'approved' })
  approvalStatus: RestaurantApprovalStatus;
}

export class BillingSnapshotDto {
  @ApiProperty({ type: 'integer', example: 24000 })
  amountCop: number;

  @ApiProperty({ type: 'integer', example: 12 })
  checkIns: number;
}

export class AdminBillingCheckInDto {
  @ApiProperty({ format: 'uuid' })
  checkInId: string;

  @ApiProperty({ example: '2026-10-14T22:05:00.000Z' })
  checkedInAt: string;

  @ApiProperty({ type: 'integer', example: 4 })
  partySize: number;

  @ApiProperty({
    description:
      'Total cobrado por este check-in, en COP (partySize × la tarifa por comensal de ese momento; los anteriores al cobro por comensal conservan su monto).',
    type: 'integer',
    example: 6000,
  })
  feeCop: number;
}

export class AdminBillingDetailDto {
  @ApiProperty({ type: BillingRestaurantDto })
  restaurant: BillingRestaurantDto;

  @ApiProperty({ example: '2026-10' })
  month: string;

  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ enum: BILLING_STATUSES })
  status: BillingStatus;

  @ApiProperty({ type: 'integer', example: 12 })
  totalCheckIns: number;

  @ApiProperty({
    description: 'Monto recalculado del mes: SUM(fee_cop).',
    type: 'integer',
    example: 24000,
  })
  amountCop: number;

  @ApiProperty({ type: String, nullable: true, example: null })
  paidAt: string | null;

  @ApiProperty({
    description:
      'Lo que se guardó al marcarlo como cobrado; null si no está cobrado.',
    type: BillingSnapshotDto,
    nullable: true,
  })
  snapshot: BillingSnapshotDto | null;

  @ApiProperty({
    description:
      'true solo si está cobrado y el monto o los check-ins recalculados no coinciden con el snapshot. No debería pasar; no se corrige solo.',
    example: false,
  })
  amountMismatch: boolean;

  @ApiProperty({
    description: 'Una página de check-ins, el más reciente primero.',
    type: [AdminBillingCheckInDto],
  })
  items: AdminBillingCheckInDto[];

  @ApiProperty({ type: 'integer', example: 1 })
  page: number;

  @ApiProperty({ type: 'integer', example: 50 })
  pageSize: number;

  @ApiProperty({ example: '2026-11-17T15:00:00.000Z' })
  serverTime: string;
}

export class AdminActivityItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Casa 72' })
  name: string;

  @ApiProperty({ enum: RESTAURANT_CATEGORIES, nullable: true })
  category: RestaurantCategory | null;

  @ApiProperty({ enum: RESTAURANT_APPROVAL_STATUSES, example: 'approved' })
  approvalStatus: RestaurantApprovalStatus;

  @ApiProperty({ description: 'true = Abierto, false = Cerrado.' })
  isOpen: boolean;

  @ApiProperty({
    description:
      'Cuándo lo aprobó un administrador de DiNNo (ISO 8601 UTC); null si lo aprobó el equipo o la migración. Usa createdAt en ese caso.',
    type: String,
    nullable: true,
    example: '2026-11-02T15:00:00.000Z',
  })
  approvedAt: string | null;

  @ApiProperty({ example: '2026-10-01T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ type: 'integer', example: 12 })
  checkIns: number;

  @ApiProperty({ type: 'integer', example: 24000 })
  amountCop: number;

  @ApiProperty({
    description:
      'Último cambio registrado en la bitácora de sus mesas (cualquier origen); null si nunca hubo.',
    type: String,
    nullable: true,
    example: '2026-11-16T23:10:00.000Z',
  })
  lastTableActivityAt: string | null;
}

export class AdminActivityPageDto {
  @ApiProperty({ example: MONTH_EXAMPLE })
  month: string;

  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({
    description: 'Restaurantes aprobados y suspendidos, por nombre.',
    type: [AdminActivityItemDto],
  })
  items: AdminActivityItemDto[];

  @ApiProperty({ type: 'integer', example: 16 })
  total: number;

  @ApiProperty({ type: 'integer', example: 1 })
  page: number;

  @ApiProperty({ type: 'integer', example: 20 })
  pageSize: number;

  @ApiProperty({ example: '2026-11-17T15:00:00.000Z' })
  serverTime: string;
}

export class HourDistributionDto {
  @ApiProperty({ description: 'Hora de Bogotá, de 0 a 23.', example: 13 })
  hour: number;

  @ApiProperty({ type: 'integer', example: 5 })
  reservations: number;
}

export class DayDistributionDto {
  @ApiProperty({ description: '1 = lunes … 7 = domingo.', example: 5 })
  dayOfWeek: number;

  @ApiProperty({ type: 'integer', example: 9 })
  reservations: number;
}

export class DateDistributionDto {
  @ApiProperty({
    description: 'Día de Bogotá (AAAA-MM-DD).',
    example: '2026-11-17',
  })
  date: string;

  @ApiProperty({ type: 'integer', example: 4 })
  reservations: number;
}

export class DayHourDistributionDto {
  @ApiProperty({ description: '1 = lunes … 7 = domingo.', example: 5 })
  dayOfWeek: number;

  @ApiProperty({ description: 'Hora de Bogotá, de 0 a 23.', example: 13 })
  hour: number;

  @ApiProperty({ type: 'integer', example: 2 })
  reservations: number;
}

export const METRICS_BASIS = 'reservations_created_at';

export class PlatformMetricsDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({
    enum: [METRICS_BASIS],
    description:
      'Todo se cuenta sobre las reservas CREADAS en el periodo (created_at, Bogotá), por su estado actual.',
  })
  basis: typeof METRICS_BASIS;

  @ApiProperty({ type: SummaryReservationsDto })
  reservations: SummaryReservationsDto;

  @ApiProperty({ type: SummaryRatesDto })
  rates: SummaryRatesDto;

  @ApiProperty({ type: Number, nullable: true, example: 2.88 })
  averagePartySize: number | null;

  @ApiProperty({
    description:
      'Siempre 24 entradas, de 0 a 23, con 0 en las horas sin reservas.',
    type: [HourDistributionDto],
  })
  peakHours: HourDistributionDto[];

  @ApiProperty({
    description: 'Siempre 7 entradas, de lunes (1) a domingo (7).',
    type: [DayDistributionDto],
  })
  byDayOfWeek: DayDistributionDto[];

  @ApiProperty({
    description:
      'Una entrada por CADA día del periodo, en orden, con 0 en los días sin reservas (hasta 366). La suma es reservations.created.',
    type: [DateDistributionDto],
  })
  byDate: DateDistributionDto[];

  @ApiProperty({
    description:
      'Siempre 168 entradas (7 días × 24 horas): de lunes (1) a domingo (7) y, dentro de cada día, de la hora 0 a la 23, con ceros incluidos. La suma es reservations.created.',
    type: [DayHourDistributionDto],
  })
  byDayHour: DayHourDistributionDto[];

  @ApiProperty({ example: '2026-11-17T15:00:00.000Z' })
  serverTime: string;
}
