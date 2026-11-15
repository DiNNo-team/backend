import {
  bogotaDay,
  parseReportPeriod,
  REPORT_PERIOD_MESSAGES as M,
  type ReportPeriod,
} from './report-period.js';

// 2026-11-15 09:30 en Bogotá.
const NOW = new Date('2026-11-15T14:30:00Z');

function periodOf(
  query: { from?: string; to?: string },
  now = NOW,
): ReportPeriod {
  const result = parseReportPeriod(query, now);
  if (!result.ok) {
    throw new Error(result.errors.join(' | '));
  }
  return result.period;
}

function errorsOf(query: { from?: string; to?: string }, now = NOW): string[] {
  const result = parseReportPeriod(query, now);
  return result.ok ? [] : result.errors;
}

describe('parseReportPeriod', () => {
  it('without parameters: from the 1st of the current month to today, in Bogotá', () => {
    expect(periodOf({})).toEqual({
      from: '2026-11-01',
      to: '2026-11-15',
      timezone: 'America/Bogota',
      // 2026-11-01 00:00 en Bogotá = 05:00 UTC.
      startsAt: new Date('2026-11-01T05:00:00Z'),
      // Fin exclusivo: 2026-11-16 00:00 en Bogotá.
      endsBefore: new Date('2026-11-16T05:00:00Z'),
    });
  });

  it('uses the Bogotá day near midnight UTC, not the UTC day', () => {
    // 2026-12-01 03:00 UTC = 2026-11-30 22:00 en Bogotá: todavía noviembre.
    expect(periodOf({}, new Date('2026-12-01T03:00:00Z'))).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    // 2026-12-01 05:00 UTC = 00:00 en Bogotá: ya es diciembre.
    expect(periodOf({}, new Date('2026-12-01T05:00:00Z'))).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-01',
    });
  });

  it('a single day covers its 24 Bogotá hours', () => {
    expect(periodOf({ from: '2026-11-10', to: '2026-11-10' })).toMatchObject({
      startsAt: new Date('2026-11-10T05:00:00Z'),
      endsBefore: new Date('2026-11-11T05:00:00Z'),
    });
  });

  it('with only to: from the 1st of that month', () => {
    expect(periodOf({ to: '2026-10-20' })).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-20',
    });
  });

  it('with only from: until today', () => {
    expect(periodOf({ from: '2026-09-15' })).toMatchObject({
      from: '2026-09-15',
      to: '2026-11-15',
    });
  });

  it('accepts exactly 366 days and rejects 367', () => {
    expect(periodOf({ from: '2025-11-15', to: '2026-11-15' })).toMatchObject({
      from: '2025-11-15',
    });
    expect(errorsOf({ from: '2025-11-14', to: '2026-11-15' })).toEqual([
      M.TOO_LONG,
    ]);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-1-5', '15/11/2026', '', 'hoy'])(
    'rejects the date %j',
    (text) => {
      expect(errorsOf({ from: text })).toEqual([M.FROM_INVALID]);
      expect(errorsOf({ to: text })).toEqual([M.TO_INVALID]);
    },
  );

  it('reports both format errors at once', () => {
    expect(errorsOf({ from: 'x', to: 'y' })).toEqual([
      M.FROM_INVALID,
      M.TO_INVALID,
    ]);
  });

  it('rejects from after to', () => {
    expect(errorsOf({ from: '2026-11-10', to: '2026-11-09' })).toEqual([
      M.FROM_AFTER_TO,
    ]);
  });

  it('rejects to after today, in Bogotá', () => {
    expect(errorsOf({ to: '2026-11-16' })).toEqual([M.TO_IN_FUTURE]);
    // 04:59 UTC del 16 es todavía el 15 en Bogotá.
    expect(
      errorsOf({ to: '2026-11-16' }, new Date('2026-11-16T04:59:00Z')),
    ).toEqual([M.TO_IN_FUTURE]);
    expect(
      errorsOf({ to: '2026-11-16' }, new Date('2026-11-16T05:00:00Z')),
    ).toEqual([]);
  });

  it('accepts a leap day', () => {
    expect(
      periodOf(
        { from: '2028-02-29', to: '2028-02-29' },
        new Date('2028-03-01T12:00:00Z'),
      ),
    ).toMatchObject({ from: '2028-02-29' });
  });
});

describe('bogotaDay', () => {
  it('matches Intl America/Bogota on both sides of midnight', () => {
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    for (const iso of [
      '2026-01-01T04:59:59Z',
      '2026-01-01T05:00:00Z',
      '2026-06-30T23:00:00Z',
      '2026-07-01T04:00:00Z',
      '2027-03-14T12:00:00Z',
    ]) {
      const instant = new Date(iso);
      expect(new Date(bogotaDay(instant)).toISOString().slice(0, 10)).toBe(
        format.format(instant),
      );
    }
  });
});
