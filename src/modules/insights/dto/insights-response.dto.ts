import { ApiProperty } from '@nestjs/swagger';
import { REPORT_TIMEZONE } from '../../reservations-checkin/index.js';
import { INSIGHTS_MIN_RESOLVED } from '../insights.constants.js';

export class InsightsPeriodDto {
  @ApiProperty({
    description: 'Primer día (AAAA-MM-DD, Bogotá), inclusivo.',
    example: '2026-11-11',
  })
  from: string;

  @ApiProperty({
    description: 'Último día (AAAA-MM-DD, Bogotá), inclusivo.',
    example: '2026-11-17',
  })
  to: string;

  @ApiProperty({ enum: [REPORT_TIMEZONE], example: REPORT_TIMEZONE })
  timezone: typeof REPORT_TIMEZONE;
}

export class InsightsTopSlotDto {
  @ApiProperty({
    description: 'Día de la semana ISO: 1 = lunes … 7 = domingo (Bogotá).',
    type: 'integer',
    example: 5,
  })
  dayOfWeek: number;

  @ApiProperty({
    description: 'Hora de 0 a 23 (Bogotá).',
    type: 'integer',
    example: 13,
  })
  hour: number;

  @ApiProperty({ type: 'integer', example: 6 })
  reservations: number;
}

export class InsightsDailyDto {
  @ApiProperty({
    description: 'Día de Bogotá (AAAA-MM-DD).',
    example: '2026-11-15',
  })
  date: string;

  @ApiProperty({
    description:
      'Reservas creadas ese día (por su estado actual en los tres campos siguientes).',
    type: 'integer',
    example: 7,
  })
  created: number;

  @ApiProperty({ type: 'integer', example: 5 })
  completed: number;

  @ApiProperty({ type: 'integer', example: 1 })
  cancelled: number;

  @ApiProperty({ type: 'integer', example: 1 })
  expired: number;

  @ApiProperty({
    description:
      'Cambios de estado de mesas hechos a mano ese día (bitácora, source = manual).',
    type: 'integer',
    example: 4,
  })
  manualUpdates: number;
}

export class InsightsMetricsDto {
  @ApiProperty({
    description: 'Reservas creadas en el periodo.',
    type: 'integer',
    example: 42,
  })
  reservationsCreated: number;

  @ApiProperty({
    description: 'De las creadas, las que siguen activas.',
    type: 'integer',
    example: 2,
  })
  active: number;

  @ApiProperty({
    description:
      'De las creadas, las que ya terminaron: completed + cancelled + expired.',
    type: 'integer',
    example: 40,
  })
  resolved: number;

  @ApiProperty({ description: 'Con check-in.', type: 'integer', example: 26 })
  completed: number;

  @ApiProperty({ type: 'integer', example: 4 })
  cancelled: number;

  @ApiProperty({
    description: 'Vencidas sin check-in.',
    type: 'integer',
    example: 10,
  })
  expired: number;

  @ApiProperty({
    description:
      'Check-ins hechos en el periodo (los mismos del estado de cuenta).',
    type: 'integer',
    example: 26,
  })
  checkIns: number;

  @ApiProperty({
    description:
      'completed / resolved, 4 decimales. null con datos insuficientes.',
    type: 'number',
    nullable: true,
    example: 0.65,
  })
  checkInRate: number | null;

  @ApiProperty({
    description:
      'expired / resolved, 4 decimales. null con datos insuficientes.',
    type: 'number',
    nullable: true,
    example: 0.25,
  })
  noShowRate: number | null;

  @ApiProperty({
    description:
      'cancelled / resolved, 4 decimales. null con datos insuficientes.',
    type: 'number',
    nullable: true,
    example: 0.1,
  })
  cancellationRate: number | null;

  @ApiProperty({
    description:
      'Mediana de minutos entre crear la reserva y el check-in, 1 decimal. null sin check-ins.',
    type: 'number',
    nullable: true,
    example: 9.5,
  })
  medianMinutesToCheckIn: number | null;

  @ApiProperty({
    description:
      'Promedio de personas de las creadas, 2 decimales. null sin reservas.',
    type: 'number',
    nullable: true,
    example: 2.8,
  })
  averagePartySize: number | null;

  @ApiProperty({
    description:
      'Hasta 3 franjas (día y hora) con más reservas creadas, de mayor a menor.',
    type: [InsightsTopSlotDto],
  })
  topSlots: InsightsTopSlotDto[];

  @ApiProperty({
    description:
      'Siempre un elemento por día del periodo, del más antiguo a hoy (para gráficos).',
    type: [InsightsDailyDto],
  })
  daily: InsightsDailyDto[];

  @ApiProperty({
    description: 'Cambios manuales de mesas en el periodo.',
    type: 'integer',
    example: 24,
  })
  manualUpdates: number;

  @ApiProperty({
    description: 'Promedio por día, 1 decimal.',
    type: 'number',
    example: 3.4,
  })
  manualUpdatesPerDay: number;

  @ApiProperty({ type: 'integer', example: 6 })
  daysWithManualUpdates: number;

  @ApiProperty({ type: 'integer', example: 1 })
  daysWithoutManualUpdates: number;
}

export class InsightsPreviousDto {
  @ApiProperty({ type: 'integer', example: 35 })
  reservationsCreated: number;

  @ApiProperty({ type: 'integer', example: 33 })
  resolved: number;

  @ApiProperty({
    description: `Tasa de check-in de la semana anterior; null si tuvo menos de ${INSIGHTS_MIN_RESOLVED} resueltas.`,
    type: 'number',
    nullable: true,
    example: 0.58,
  })
  checkInRate: number | null;
}

export class InsightsReliabilityDto {
  @ApiProperty({
    description:
      'Confiabilidad de la disponibilidad del restaurante. null con datos insuficientes.',
    enum: ['high', 'medium', 'low'],
    nullable: true,
    example: 'medium',
  })
  level: 'high' | 'medium' | 'low' | null;

  @ApiProperty({
    description:
      'Motivos del nivel, en español. Vacío con datos insuficientes.',
    type: [String],
    example: [
      'Tasa de check-in del 65 %',
      'Actualizaste tus mesas a mano en 6 de 7 días',
    ],
  })
  reasons: string[];
}

export class InsightsNarrativeDto {
  @ApiProperty({
    description:
      '2 o 3 recomendaciones en español, máximo 600 caracteres. Generado automáticamente: la web lo marca así.',
    example:
      'El 25 % de tus reservas resueltas venció sin check-in. Revisa si validas el código cuando llega el comensal.',
  })
  text: string;

  @ApiProperty({
    description:
      'llm = lo redactó el modelo de lenguaje; template = plantillas (respaldo).',
    enum: ['llm', 'template'],
    example: 'llm',
  })
  source: 'llm' | 'template';

  @ApiProperty({
    description:
      'Por qué se usaron plantillas; null si lo redactó el modelo. insufficient_data: pocas reservas resueltas · llm_disabled: no hay llave del modelo · llm_unavailable: el modelo falló, tardó o se negó · llm_invalid: el texto del modelo no pasó la validación.',
    enum: [
      'insufficient_data',
      'llm_disabled',
      'llm_unavailable',
      'llm_invalid',
    ],
    nullable: true,
    example: null,
  })
  fallback:
    | 'insufficient_data'
    | 'llm_disabled'
    | 'llm_unavailable'
    | 'llm_invalid'
    | null;
}

export class RestaurantInsightsResponseDto {
  @ApiProperty({
    type: InsightsPeriodDto,
    description: 'Los últimos 7 días, hoy incluido.',
  })
  period: InsightsPeriodDto;

  @ApiProperty({
    type: InsightsPeriodDto,
    description: 'Los 7 días anteriores, para comparar.',
  })
  previousPeriod: InsightsPeriodDto;

  @ApiProperty({
    description:
      'Cuándo se generó el informe (ISO 8601 UTC). Puede venir de la caché.',
    example: '2026-11-17T14:02:11.000Z',
  })
  generatedAt: string;

  @ApiProperty({
    description: `enough si hay al menos ${INSIGHTS_MIN_RESOLVED} reservas resueltas en el periodo; si no, insufficient (tasas y nivel en null).`,
    enum: ['enough', 'insufficient'],
    example: 'enough',
  })
  dataSufficiency: 'enough' | 'insufficient';

  @ApiProperty({
    description:
      'Reservas resueltas necesarias para calcular tasas e indicador.',
    type: 'integer',
    example: INSIGHTS_MIN_RESOLVED,
  })
  minResolved: number;

  @ApiProperty({ type: InsightsMetricsDto })
  metrics: InsightsMetricsDto;

  @ApiProperty({ type: InsightsPreviousDto })
  previous: InsightsPreviousDto;

  @ApiProperty({ type: InsightsReliabilityDto })
  reliability: InsightsReliabilityDto;

  @ApiProperty({ type: InsightsNarrativeDto })
  narrative: InsightsNarrativeDto;
}
