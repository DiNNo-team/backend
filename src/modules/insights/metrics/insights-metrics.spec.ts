import {
  emptyActivity,
  INSIGHTS_DAYS,
  summaryWith,
} from '../../../../test/support/insights-data.js';
import {
  buildInsightsMetrics,
  buildPreviousMetrics,
  dataSufficiency,
} from './insights-metrics.js';

describe('buildInsightsMetrics', () => {
  const summary = summaryWith(
    { created: 42, completed: 26, cancelled: 4, expired: 10, active: 2 },
    { averagePartySize: 2.8 },
  );

  it('tasas sobre las resueltas, con 4 decimales', () => {
    const metrics = buildInsightsMetrics(
      summaryWith({ created: 3, completed: 1, cancelled: 1, expired: 1 }),
      emptyActivity(),
      INSIGHTS_DAYS,
    );
    // 3 resueltas: datos insuficientes, sin tasas.
    expect(metrics.checkInRate).toBeNull();

    const enough = buildInsightsMetrics(
      summary,
      emptyActivity(),
      INSIGHTS_DAYS,
    );
    expect(enough).toMatchObject({
      reservationsCreated: 42,
      active: 2,
      resolved: 40,
      checkIns: 26,
      checkInRate: 0.65,
      noShowRate: 0.25,
      cancellationRate: 0.1,
      averagePartySize: 2.8,
    });
  });

  it('con 10 resueltas ya hay datos suficientes; con 9, no', () => {
    expect(dataSufficiency(10)).toBe('enough');
    expect(dataSufficiency(9)).toBe('insufficient');
    const nine = buildInsightsMetrics(
      summaryWith({ created: 9, completed: 9 }),
      emptyActivity(),
      INSIGHTS_DAYS,
    );
    expect(nine.checkInRate).toBeNull();
    expect(nine.noShowRate).toBeNull();
    expect(nine.cancellationRate).toBeNull();
  });

  it('las tasas se redondean a 4 decimales', () => {
    const metrics = buildInsightsMetrics(
      summaryWith({ created: 12, completed: 7, cancelled: 2, expired: 3 }),
      emptyActivity(),
      INSIGHTS_DAYS,
    );
    expect(metrics.checkInRate).toBe(0.5833);
    expect(metrics.noShowRate).toBe(0.25);
    expect(metrics.cancellationRate).toBe(0.1667);
  });

  it('un elemento por día del periodo, con 0 en los días sin datos', () => {
    const metrics = buildInsightsMetrics(
      summary,
      {
        ...emptyActivity(),
        daily: [
          {
            date: '2026-11-13',
            created: 5,
            completed: 3,
            cancelled: 1,
            expired: 1,
          },
        ],
        manualUpdatesByDay: [
          { date: '2026-11-13', updates: 4 },
          { date: '2026-11-17', updates: 2 },
        ],
      },
      INSIGHTS_DAYS,
    );

    expect(metrics.daily).toHaveLength(7);
    expect(metrics.daily[0]).toEqual({
      date: '2026-11-11',
      created: 0,
      completed: 0,
      cancelled: 0,
      expired: 0,
      manualUpdates: 0,
    });
    expect(metrics.daily[2]).toEqual({
      date: '2026-11-13',
      created: 5,
      completed: 3,
      cancelled: 1,
      expired: 1,
      manualUpdates: 4,
    });
    expect(metrics).toMatchObject({
      manualUpdates: 6,
      manualUpdatesPerDay: 0.9,
      daysWithManualUpdates: 2,
      daysWithoutManualUpdates: 5,
    });
  });

  it('mediana con 1 decimal, o null sin check-ins', () => {
    const withMedian = buildInsightsMetrics(
      summary,
      { ...emptyActivity(), medianMinutesToCheckIn: 9.4666 },
      INSIGHTS_DAYS,
    );
    expect(withMedian.medianMinutesToCheckIn).toBe(9.5);

    const without = buildInsightsMetrics(
      summary,
      emptyActivity(),
      INSIGHTS_DAYS,
    );
    expect(without.medianMinutesToCheckIn).toBeNull();
  });

  it('pasa las franjas tal como llegan (ya ordenadas por la consulta)', () => {
    const topSlots = [{ dayOfWeek: 5, hour: 13, reservations: 6 }];
    const metrics = buildInsightsMetrics(
      summary,
      { ...emptyActivity(), topSlots },
      INSIGHTS_DAYS,
    );
    expect(metrics.topSlots).toEqual(topSlots);
  });
});

describe('buildPreviousMetrics', () => {
  it('compara la tasa solo si la semana anterior tuvo datos suficientes', () => {
    expect(
      buildPreviousMetrics(
        summaryWith({ created: 35, completed: 19, cancelled: 4, expired: 10 }),
      ),
    ).toEqual({ reservationsCreated: 35, resolved: 33, checkInRate: 0.5758 });

    expect(
      buildPreviousMetrics(summaryWith({ created: 4, completed: 4 })),
    ).toEqual({ reservationsCreated: 4, resolved: 4, checkInRate: null });
  });
});
