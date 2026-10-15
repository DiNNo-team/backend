import type { ScheduleSnapshot } from './availability.types.js';
import { isOpenNow, parseTimeOfDay } from './opening-hours.js';

// Week of the tests (Bogotá, UTC-5): Thursday 2026-10-15, Friday 16,
// Saturday 17, Sunday 18, Monday 19. Each instant is written in UTC with its
// Bogotá time in the comment.
const MONDAY = 1;
const FRIDAY = 5;
const SATURDAY = 6;
const SUNDAY = 7;

function hours(
  dayOfWeek: number,
  opensAt: string,
  closesAt: string,
): ScheduleSnapshot {
  return { dayOfWeek, isOpen24h: false, opensAt, closesAt };
}

function allDay(dayOfWeek: number): ScheduleSnapshot {
  return { dayOfWeek, isOpen24h: true, opensAt: null, closesAt: null };
}

function openAt(schedules: ScheduleSnapshot[], utc: string): boolean {
  return isOpenNow({ isOpen: true, schedules }, new Date(utc));
}

describe('parseTimeOfDay', () => {
  it.each([
    ['00:00', 0],
    ['12:00', 720],
    ['12:00:00', 720],
    ['23:59', 1439],
    ['02:30:59', 150],
  ])('reads %s as minute %i', (time, minute) => {
    expect(parseTimeOfDay(time)).toBe(minute);
  });

  it('fails loudly on a value that is not a time', () => {
    expect(() => parseTimeOfDay('9:00')).toThrow('Invalid time of day: 9:00');
  });
});

describe('isOpenNow', () => {
  describe('regular hours (Friday 12:00-22:00)', () => {
    const friday = [hours(FRIDAY, '12:00', '22:00')];

    it.each([
      ['2026-10-16T16:59:00Z', 'Friday 11:59', false],
      ['2026-10-16T17:00:00Z', 'Friday 12:00, opening inclusive', true],
      ['2026-10-17T02:59:00Z', 'Friday 21:59', true],
      ['2026-10-17T03:00:00Z', 'Friday 22:00, closing exclusive', false],
    ])('%s (%s) → open: %s', (utc, _bogota, expected) => {
      expect(openAt(friday, utc)).toBe(expected);
    });

    it('reads times with seconds like times without them', () => {
      const withSeconds = [hours(FRIDAY, '12:00:00', '22:00:00')];

      // Friday 12:00 and 22:00.
      expect(openAt(withSeconds, '2026-10-16T17:00:00Z')).toBe(true);
      expect(openAt(withSeconds, '2026-10-17T03:00:00Z')).toBe(false);
    });
  });

  describe('closing the next day (Friday 18:00-02:00)', () => {
    const fridayNight = [hours(FRIDAY, '18:00', '02:00')];

    it.each([
      ['2026-10-16T22:59:00Z', 'Friday 17:59', false],
      ['2026-10-16T23:00:00Z', 'Friday 18:00', true],
      ['2026-10-17T04:59:00Z', 'Friday 23:59', true],
      ['2026-10-17T05:00:00Z', 'Saturday 00:00', true],
      ['2026-10-17T06:59:00Z', 'Saturday 01:59', true],
      ['2026-10-17T07:00:00Z', 'Saturday 02:00, closing exclusive', false],
    ])('%s (%s) → open: %s', (utc, _bogota, expected) => {
      expect(openAt(fridayNight, utc)).toBe(expected);
    });

    it('stays open on Saturday 01:00 with no row for Saturday', () => {
      // Saturday 01:00: only the Friday row covers it.
      expect(openAt(fridayNight, '2026-10-17T06:00:00Z')).toBe(true);
    });

    it('crosses from Sunday (7) to Monday (1)', () => {
      const sundayNight = [hours(SUNDAY, '18:00', '02:00')];

      // Monday 01:00.
      expect(openAt(sundayNight, '2026-10-19T06:00:00Z')).toBe(true);
    });

    it('does not carry Friday night into Saturday afternoon', () => {
      // Saturday 18:30: the Friday row only covers until 02:00.
      expect(openAt(fridayNight, '2026-10-17T23:30:00Z')).toBe(false);
    });

    it('uses both rows when Saturday also has its own hours', () => {
      const weekend = [...fridayNight, hours(SATURDAY, '12:00', '22:00')];

      // Saturday 01:00 (Friday row) and Saturday 13:00 (Saturday row).
      expect(openAt(weekend, '2026-10-17T06:00:00Z')).toBe(true);
      expect(openAt(weekend, '2026-10-17T18:00:00Z')).toBe(true);
      // Saturday 05:00: neither row.
      expect(openAt(weekend, '2026-10-17T10:00:00Z')).toBe(false);
    });
  });

  describe('closing at midnight (Friday 18:00-00:00)', () => {
    const untilMidnight = [hours(FRIDAY, '18:00', '00:00')];

    it('is open until 23:59 and closed from 00:00', () => {
      // Friday 23:59.
      expect(openAt(untilMidnight, '2026-10-17T04:59:00Z')).toBe(true);
      // Saturday 00:00.
      expect(openAt(untilMidnight, '2026-10-17T05:00:00Z')).toBe(false);
    });
  });

  describe('open 24 hours (Friday)', () => {
    const friday24h = [allDay(FRIDAY)];

    it.each([
      ['2026-10-16T05:00:00Z', 'Friday 00:00'],
      ['2026-10-16T17:00:00Z', 'Friday 12:00'],
      ['2026-10-17T04:59:00Z', 'Friday 23:59'],
    ])('%s (%s) → open', (utc) => {
      expect(openAt(friday24h, utc)).toBe(true);
    });

    it('does not reach the next day when it has no row', () => {
      // Saturday 00:00.
      expect(openAt(friday24h, '2026-10-17T05:00:00Z')).toBe(false);
    });
  });

  describe('closed', () => {
    it('on a day without hours', () => {
      // Monday 13:00, with hours only on Friday.
      expect(
        openAt([hours(FRIDAY, '12:00', '22:00')], '2026-10-19T18:00:00Z'),
      ).toBe(false);
    });

    it('for a row that is not 24 hours and has no times', () => {
      // The database check CHK_restaurant_schedules_hours does not allow it;
      // if such a row ever arrives, it never opens. Friday 13:00.
      const noTimes: ScheduleSnapshot = {
        dayOfWeek: FRIDAY,
        isOpen24h: false,
        opensAt: null,
        closesAt: null,
      };

      expect(openAt([noTimes], '2026-10-16T18:00:00Z')).toBe(false);
      // Saturday 01:00: it does not count as yesterday's schedule either.
      expect(openAt([noTimes], '2026-10-17T06:00:00Z')).toBe(false);
    });

    it('for a restaurant without any hours', () => {
      // Friday 13:00.
      expect(openAt([], '2026-10-16T18:00:00Z')).toBe(false);
    });

    it('when the restaurant is switched to Cerrado, even inside its hours', () => {
      // Friday 13:00, inside Friday 12:00-22:00 and Monday 24 hours.
      expect(
        isOpenNow(
          {
            isOpen: false,
            schedules: [hours(FRIDAY, '12:00', '22:00'), allDay(MONDAY)],
          },
          new Date('2026-10-16T18:00:00Z'),
        ),
      ).toBe(false);
    });
  });
});
