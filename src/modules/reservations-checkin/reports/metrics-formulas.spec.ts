import {
  byDayOfWeek,
  hourlyDistribution,
  peakHours,
  ratio,
  reservationRates,
  roundAverage,
} from './metrics-formulas.js';

describe('ratio', () => {
  it('rounds to 4 decimals', () => {
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(2, 3)).toBe(0.6667);
    expect(ratio(3, 3)).toBe(1);
    expect(ratio(0, 5)).toBe(0);
  });

  it('is null when the denominator is 0', () => {
    expect(ratio(0, 0)).toBeNull();
  });
});

describe('reservationRates', () => {
  it('conversion and cancellation over created; no-show over completed + expired', () => {
    expect(
      reservationRates({
        created: 10,
        completed: 4,
        cancelled: 3,
        expired: 2,
        active: 1,
      }),
    ).toEqual({ conversion: 0.4, noShow: 0.3333, cancellation: 0.3 });
  });

  it('without reservations every rate is null', () => {
    expect(
      reservationRates({
        created: 0,
        completed: 0,
        cancelled: 0,
        expired: 0,
        active: 0,
      }),
    ).toEqual({ conversion: null, noShow: null, cancellation: null });
  });

  it('only active or cancelled ones: no-show is null, the rest are 0', () => {
    expect(
      reservationRates({
        created: 2,
        completed: 0,
        cancelled: 1,
        expired: 0,
        active: 1,
      }),
    ).toEqual({ conversion: 0, noShow: null, cancellation: 0.5 });
  });
});

describe('roundAverage', () => {
  it('rounds to 2 decimals and keeps null', () => {
    expect(roundAverage(2.66666)).toBe(2.67);
    expect(roundAverage(null)).toBeNull();
  });
});

describe('peakHours', () => {
  it('the three hours with more reservations, ties broken by the earlier hour', () => {
    expect(
      peakHours([
        { hour: 20, reservations: 5 },
        { hour: 13, reservations: 5 },
        { hour: 9, reservations: 2 },
        { hour: 12, reservations: 7 },
        { hour: 7, reservations: 2 },
      ]),
    ).toEqual([
      { hour: 12, reservations: 7 },
      { hour: 13, reservations: 5 },
      { hour: 20, reservations: 5 },
    ]);
  });

  it('fewer than three hours with data: only those; none: empty', () => {
    expect(peakHours([{ hour: 0, reservations: 1 }])).toEqual([
      { hour: 0, reservations: 1 },
    ]);
    expect(peakHours([])).toEqual([]);
    expect(peakHours([{ hour: 5, reservations: 0 }])).toEqual([]);
  });
});

describe('byDayOfWeek', () => {
  it('always seven days, Monday first, with 0 when there is no data', () => {
    expect(
      byDayOfWeek([
        { dayOfWeek: 7, reservations: 4 },
        { dayOfWeek: 2, reservations: 1 },
      ]),
    ).toEqual([
      { dayOfWeek: 1, reservations: 0 },
      { dayOfWeek: 2, reservations: 1 },
      { dayOfWeek: 3, reservations: 0 },
      { dayOfWeek: 4, reservations: 0 },
      { dayOfWeek: 5, reservations: 0 },
      { dayOfWeek: 6, reservations: 0 },
      { dayOfWeek: 7, reservations: 4 },
    ]);
  });

  it('empty input gives seven zeros', () => {
    expect(byDayOfWeek([]).every((day) => day.reservations === 0)).toBe(true);
  });
});

describe('hourlyDistribution', () => {
  it('always has the 24 hours in order, with 0 where there is nothing', () => {
    const hours = hourlyDistribution([
      { hour: 13, reservations: 3 },
      { hour: 0, reservations: 1 },
      { hour: 23, reservations: 2 },
    ]);

    expect(hours).toHaveLength(24);
    expect(hours.map((entry) => entry.hour)).toEqual(
      Array.from({ length: 24 }, (_, hour) => hour),
    );
    expect(hours[0]).toEqual({ hour: 0, reservations: 1 });
    expect(hours[13]).toEqual({ hour: 13, reservations: 3 });
    expect(hours[23]).toEqual({ hour: 23, reservations: 2 });
    expect(hours[12]).toEqual({ hour: 12, reservations: 0 });
  });

  it('with no data is 24 zeros, never an empty list', () => {
    expect(
      hourlyDistribution([]).every((entry) => entry.reservations === 0),
    ).toBe(true);
  });
});
