import { insightsPeriods, periodDays } from './insights-period.js';

describe('insightsPeriods', () => {
  it('los últimos 7 días de Bogotá con hoy incluido, y los 7 anteriores', () => {
    // Martes 2026-11-17 09:00 en Bogotá.
    const { current, previous } = insightsPeriods(
      new Date('2026-11-17T14:00:00Z'),
    );

    expect(current).toMatchObject({
      from: '2026-11-11',
      to: '2026-11-17',
      timezone: 'America/Bogota',
      startsAt: new Date('2026-11-11T05:00:00Z'),
      endsBefore: new Date('2026-11-18T05:00:00Z'),
    });
    expect(previous).toMatchObject({
      from: '2026-11-04',
      to: '2026-11-10',
      startsAt: new Date('2026-11-04T05:00:00Z'),
      endsBefore: new Date('2026-11-11T05:00:00Z'),
    });
  });

  it('usa el día de Bogotá aunque en UTC ya sea el día siguiente', () => {
    // 2026-11-18 03:00 UTC = martes 2026-11-17 22:00 en Bogotá.
    const { current } = insightsPeriods(new Date('2026-11-18T03:00:00Z'));

    expect(current.to).toBe('2026-11-17');
  });

  it('cruza el cambio de mes y de año', () => {
    // 2027-01-02 12:00 en Bogotá.
    const { current, previous } = insightsPeriods(
      new Date('2027-01-02T17:00:00Z'),
    );

    expect([current.from, current.to]).toEqual(['2026-12-27', '2027-01-02']);
    expect([previous.from, previous.to]).toEqual(['2026-12-20', '2026-12-26']);
  });
});

describe('periodDays', () => {
  it('lista cada día del periodo en orden', () => {
    const { current } = insightsPeriods(new Date('2026-11-17T14:00:00Z'));

    expect(periodDays(current)).toEqual([
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
    ]);
  });
});
