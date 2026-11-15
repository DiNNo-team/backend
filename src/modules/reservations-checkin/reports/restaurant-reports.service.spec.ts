import { BadRequestException } from '@nestjs/common';
import type { BillingStatementService } from '../billing/billing-statement.service.js';
import type { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import { REPORT_PERIOD_MESSAGES } from './report-period.js';
import type { RestaurantMetricsService } from './restaurant-metrics.service.js';
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
  };
  const service = new RestaurantReportsService(
    metrics as unknown as RestaurantMetricsService,
    {} as BillingStatementService,
    expiration as unknown as ReservationExpirationService,
    { feeCop: 2500 },
    { now: () => NOW },
  );
  return { service, calls, metrics, expiration };
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
      currentFeeCop: 2500,
    });
    expect(summary.serverTime).toBe(NOW.toISOString());
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
