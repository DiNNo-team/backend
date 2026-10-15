import { toBogotaTime } from './bogota-time.js';

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
