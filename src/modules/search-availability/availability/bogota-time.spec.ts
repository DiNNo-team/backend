import { formatBogotaClock, toBogotaTime } from './bogota-time.js';

describe('formatBogotaClock', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it.each([
    // Cerca de la medianoche UTC: en Bogotá sigue siendo el día anterior.
    ['2026-11-06T04:41:00Z', '23:41'],
    ['2026-11-06T00:05:00Z', '19:05'],
    // Medianoche en Bogotá en formato de 24 h: 00, nunca 24.
    ['2026-11-06T05:00:00Z', '00:00'],
    ['2026-11-06T05:07:00Z', '00:07'],
    ['2026-11-05T17:41:00Z', '12:41'],
  ])('%s se muestra como %s', (instant, expected) => {
    expect(formatBogotaClock(new Date(instant))).toBe(expected);
  });

  it.each(['UTC', 'Asia/Tokyo', 'America/Bogota'])(
    'no depende de la zona de la máquina (TZ=%s)',
    (timeZone) => {
      process.env.TZ = timeZone;

      expect(formatBogotaClock(new Date('2026-11-06T04:41:00Z'))).toBe('23:41');
    },
  );
});

// Bogotá is UTC-5 all year (no daylight saving time).
describe('toBogotaTime', () => {
  it('turns an instant into the day and minute of a clock in Bogotá', () => {
    // Friday 2026-10-16 12:00 in Bogotá.
    expect(toBogotaTime(new Date('2026-10-16T17:00:00Z'))).toEqual({
      dayOfWeek: 5,
      minuteOfDay: 12 * 60,
    });
  });

  it('keeps the previous day while UTC is already in the next one', () => {
    // Thursday 2026-10-15 22:30 in Bogotá (Friday 03:30 in UTC).
    expect(toBogotaTime(new Date('2026-10-16T03:30:00Z'))).toEqual({
      dayOfWeek: 4,
      minuteOfDay: 22 * 60 + 30,
    });
  });

  it('counts midnight as minute 0 and 23:59 as minute 1439', () => {
    // Saturday 2026-10-17 00:00 in Bogotá.
    expect(toBogotaTime(new Date('2026-10-17T05:00:00Z'))).toEqual({
      dayOfWeek: 6,
      minuteOfDay: 0,
    });
    // Sunday 2026-10-18 23:59 in Bogotá.
    expect(toBogotaTime(new Date('2026-10-19T04:59:00Z'))).toEqual({
      dayOfWeek: 7,
      minuteOfDay: 1439,
    });
  });

  it('numbers the days like ISO 8601: Sunday is 7 and Monday is 1', () => {
    // Monday 2026-10-19 00:00 in Bogotá.
    expect(toBogotaTime(new Date('2026-10-19T05:00:00Z')).dayOfWeek).toBe(1);
  });

  describe('does not depend on the time zone of the server', () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    });

    it.each(['UTC', 'Asia/Tokyo', 'America/Bogota'])(
      'gives the same Bogotá time with TZ=%s',
      (timeZone) => {
        process.env.TZ = timeZone;
        // Thursday 2026-10-15 22:30 in Bogotá.
        const instant = new Date('2026-10-16T03:30:00Z');

        expect(toBogotaTime(instant)).toEqual({
          dayOfWeek: 4,
          minuteOfDay: 22 * 60 + 30,
        });
      },
    );

    it('really changes the local time of the process (so the test above is meaningful)', () => {
      const instant = new Date('2026-10-16T03:30:00Z');
      process.env.TZ = 'UTC';
      const utcHour = instant.getHours();
      process.env.TZ = 'Asia/Tokyo';
      const tokyoHour = instant.getHours();

      expect([utcHour, tokyoHour]).toEqual([3, 12]);
    });
  });
});
