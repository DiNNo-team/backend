import { BadRequestException } from '@nestjs/common';
import type { BillingStatementService } from '../billing/billing-statement.service.js';
import type { PlatformBillingReader } from '../platform/platform-billing.reader.js';
import type { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import { REPORT_PERIOD_MESSAGES } from './report-period.js';
import type { RestaurantMetricsService } from './restaurant-metrics.service.js';
import type { RestaurantSummaryReader } from './restaurant-summary.reader.js';
import { RestaurantReportsService } from './restaurant-reports.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const NOW = new Date('2026-11-15T14:30:00Z');

function createService() {
  const calls: string[] = [];
  const expiration = {
    expireDueForRestaurant: vi.fn(() => {
      calls.push('vencer');
      return Promise.resolve(0);
    }),
  };
  const metrics = {
    forRestaurant: vi.fn(() => {
      calls.push('contar');
      return Promise.resolve({
        billing: { checkIns: 1, amountCop: 2000 },
        reservations: {
          created: 1,
          completed: 1,
          cancelled: 0,
          expired: 0,
          active: 0,
        },
        rates: { conversion: 1, noShow: 0, cancellation: 0 },
        averagePartySize: 2,
        peakHours: [{ hour: 12, reservations: 1 }],
        byDayOfWeek: [],
      });
    }),
    dayHourForRestaurant: vi.fn(() => Promise.resolve([])),
  };
  const reader = {
    daily: vi.fn(() => Promise.resolve([])),
    totals: vi.fn((_id: string, period: { startsAt: Date }) =>
      Promise.resolve(
        period.startsAt.getUTCMonth() === 9
          ? { reservationsCreated: 15, checkIns: 4, guests: 9, amountCop: 8000 }
          : {
              reservationsCreated: 18,
              checkIns: 6,
              guests: 13,
              amountCop: 12000,
            },
      ),
    ),
    monthly: vi.fn(() =>
      Promise.resolve([
        { month: '2026-10', guests: 11, checkIns: 5 },
        { month: '2026-11', guests: 13, checkIns: 6 },
      ]),
    ),
  };
  const billing = {
    totals: vi.fn(() => Promise.resolve({ checkIns: 4, amountCop: 8000 })),
  };
  const periods = {
    billingPeriod: vi.fn(() =>
      Promise.resolve({
        status: 'paid',
        amountCopSnapshot: 7500,
        checkInsSnapshot: 4,
        markedPaidAt: null,
      }),
    ),
  };
  const service = new RestaurantReportsService(
    metrics as unknown as RestaurantMetricsService,
    billing as unknown as BillingStatementService,
    expiration as unknown as ReservationExpirationService,
    { feeCop: 2500 },
    { now: () => NOW },
    reader as unknown as RestaurantSummaryReader,
    periods as unknown as PlatformBillingReader,
  );
  return { service, calls, metrics, expiration, reader, periods };
}

describe('RestaurantReportsService.summary', () => {
  it('vence las reservas debidas del restaurante y después cuenta', async () => {
    const { service, calls, expiration } = createService();

    await service.summary(RESTAURANT_ID, {});

    expect(calls).toEqual(['vencer', 'contar']);
    expect(expiration.expireDueForRestaurant).toHaveBeenCalledWith(
      RESTAURANT_ID,
    );
  });

  it('agrega el periodo, la tarifa vigente y la hora del servidor', async () => {
    const { service } = createService();

    const summary = await service.summary(RESTAURANT_ID, {});

    expect(summary.period).toEqual({
      from: '2026-11-01',
      to: '2026-11-15',
      timezone: 'America/Bogota',
    });
    expect(summary.billing).toEqual({
      checkIns: 1,
      amountCop: 2000,
      guests: 13,
      currentFeeCop: 2500,
    });
    expect(summary.serverTime).toBe(NOW.toISOString());
  });

  it('compara con el mismo tramo del mes anterior', async () => {
    const { service } = createService();

    const summary = await service.summary(RESTAURANT_ID, {});

    // Hoy es 15 nov: 1–15 nov contra 1–15 oct.
    expect(summary.previousComparable).toEqual({
      period: {
        from: '2026-10-01',
        to: '2026-10-15',
        timezone: 'America/Bogota',
      },
      reservationsCreated: 15,
      checkIns: 4,
      guests: 9,
      amountCop: 8000,
    });
  });

  it('marca el mes en curso en los últimos meses', async () => {
    const { service, reader } = createService();

    const summary = await service.summary(RESTAURANT_ID, {});

    expect(reader.monthly).toHaveBeenCalledWith(RESTAURANT_ID, '2026-11', 6);
    expect(summary.monthly).toEqual([
      { month: '2026-10', guests: 11, checkIns: 5, inProgress: false },
      { month: '2026-11', guests: 13, checkIns: 6, inProgress: true },
    ]);
  });

  it('da el estado de pago del mes del periodo y del mes anterior', async () => {
    const { service } = createService();

    const summary = await service.summary(RESTAURANT_ID, {});

    // El mes en curso nunca está pagado: va recalculado.
    expect(summary.payment.period).toMatchObject({
      month: '2026-11',
      status: 'in_progress',
      amountCop: 8000,
    });
    // Octubre está cerrado y marcado: el valor guardado al marcarlo.
    expect(summary.payment.previousMonth).toEqual({
      month: '2026-10',
      status: 'paid',
      checkIns: 4,
      amountCop: 7500,
    });
  });

  it('un periodo de varios meses no trae el estado de pago del periodo', async () => {
    const { service } = createService();

    const summary = await service.summary(RESTAURANT_ID, {
      from: '2026-09-15',
      to: '2026-11-10',
    });

    expect(summary.payment.period).toBeNull();
    expect(summary.payment.previousMonth?.month).toBe('2026-10');
  });

  it('antes de 2026-01 no hay mes anterior de cobro', async () => {
    const { service } = createService();

    const summary = await service.summary(RESTAURANT_ID, {
      from: '2026-01-01',
      to: '2026-01-10',
    });

    expect(summary.payment.previousMonth).toBeNull();
    expect(summary.payment.period?.month).toBe('2026-01');
  });

  it('un periodo inválido es 400 con la lista de mensajes, sin vencer ni contar', async () => {
    const { service, calls } = createService();

    const error = await service
      .summary(RESTAURANT_ID, { from: '2026-11-10', to: '2026-11-09' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      message: [REPORT_PERIOD_MESSAGES.FROM_AFTER_TO],
      error: 'Bad Request',
    });
    expect(calls).toEqual([]);
  });
});
