import {
  BILLING_MONTH_MESSAGES as M,
  bogotaMonthKey,
  monthsEndingAt,
  monthStartInstant,
  parseBillingMonth,
  shiftMonth,
} from './billing-month.js';

// 2026-11-17 10:00 en Bogotá.
const NOW = new Date('2026-11-17T15:00:00Z');

function monthOf(text: string | undefined, now = NOW) {
  const result = parseBillingMonth(text, now);
  if (!result.ok) {
    throw new Error(result.errors.join(' '));
  }
  return result.month;
}

describe('parseBillingMonth', () => {
  it('defaults to the month in progress, up to today', () => {
    expect(monthOf(undefined)).toEqual({
      key: '2026-11',
      firstDay: '2026-11-01',
      closed: false,
      period: {
        from: '2026-11-01',
        to: '2026-11-17',
        timezone: 'America/Bogota',
        startsAt: new Date('2026-11-01T05:00:00Z'),
        endsBefore: new Date('2026-11-18T05:00:00Z'),
      },
    });
  });

  it('a closed month is the whole month, in Bogotá instants', () => {
    expect(monthOf('2026-10')).toMatchObject({
      key: '2026-10',
      closed: true,
      period: {
        from: '2026-10-01',
        to: '2026-10-31',
        startsAt: new Date('2026-10-01T05:00:00Z'),
        endsBefore: new Date('2026-11-01T05:00:00Z'),
      },
    });
    expect(monthOf('2026-02').period.to).toBe('2026-02-28');
  });

  it('uses the Bogotá month, not the UTC one, at the edge of midnight', () => {
    // 2026-12-01 03:00 UTC = 2026-11-30 22:00 en Bogotá: todavía noviembre.
    const lateNovember = new Date('2026-12-01T03:00:00Z');
    expect(bogotaMonthKey(lateNovember)).toBe('2026-11');
    expect(monthOf(undefined, lateNovember).closed).toBe(false);
    expect(parseBillingMonth('2026-12', lateNovember)).toEqual({
      ok: false,
      errors: [M.IN_FUTURE],
    });
    // 2026-12-01 05:00 UTC = 00:00 en Bogotá: ya es diciembre y noviembre cerró.
    const december = new Date('2026-12-01T05:00:00Z');
    expect(monthOf('2026-11', december).closed).toBe(true);
  });

  it.each([
    '2026-13',
    '2026-00',
    '26-11',
    '2026-1',
    '2026/11',
    '',
    'abc',
    '2026-11-01',
  ])('rejects %j as not a month', (text) => {
    expect(parseBillingMonth(text, NOW)).toEqual({
      ok: false,
      errors: [M.INVALID],
    });
  });

  it('rejects a month before 2026-01 and a future month', () => {
    expect(parseBillingMonth('2025-12', NOW)).toEqual({
      ok: false,
      errors: [M.BEFORE_MIN],
    });
    expect(parseBillingMonth('2026-12', NOW)).toEqual({
      ok: false,
      errors: [M.IN_FUTURE],
    });
    expect(monthOf('2026-01').key).toBe('2026-01');
  });
});

describe('month helpers', () => {
  it('shifts across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('lists the months that end at a month, oldest first', () => {
    expect(monthsEndingAt('2026-02', 3)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(monthsEndingAt('2026-11', 12)).toHaveLength(12);
  });

  it('starts a month at Bogotá midnight', () => {
    expect(monthStartInstant('2026-11')).toEqual(
      new Date('2026-11-01T05:00:00Z'),
    );
  });
});
