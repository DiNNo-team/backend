import type {
  RestaurantSnapshot,
  ScheduleSnapshot,
} from './availability.types.js';
import { toBogotaTime } from './bogota-time.js';

const TIME_OF_DAY = /^(\d{2}):(\d{2})(?::\d{2})?$/;

// "HH:MM" or "HH:MM:SS" (how pg returns a time column) to minutes of the
// day. Seconds are ignored: the API only works with minutes.
export function parseTimeOfDay(time: string): number {
  const match = TIME_OF_DAY.exec(time);
  if (!match) {
    throw new Error(`Invalid time of day: ${time}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

interface Hours {
  opens: number;
  closes: number;
}

// null for a 24-hour day, and for a row without times (the database check
// CHK_restaurant_schedules_hours does not allow it, so it never opens).
function hoursOf(schedule: ScheduleSnapshot): Hours | null {
  if (schedule.isOpen24h || !schedule.opensAt || !schedule.closesAt) {
    return null;
  }
  return {
    opens: parseTimeOfDay(schedule.opensAt),
    closes: parseTimeOfDay(schedule.closesAt),
  };
}

// closesAt earlier than opensAt: it closes the next day. "00:00" is the
// case of closing at midnight, which leaves nothing after midnight.
function closesNextDay({ opens, closes }: Hours): boolean {
  return closes < opens;
}

// The row of today: opening inclusive, closing exclusive.
function coversToday(schedule: ScheduleSnapshot, minute: number): boolean {
  if (schedule.isOpen24h) {
    return true;
  }
  const hours = hoursOf(schedule);
  if (!hours) {
    return false;
  }
  return closesNextDay(hours)
    ? minute >= hours.opens
    : hours.opens <= minute && minute < hours.closes;
}

// The row of yesterday, only for the part after midnight of a schedule that
// closes the next day. A 24-hour day ends at 24:00: it does not reach today.
function coversAfterMidnight(
  schedule: ScheduleSnapshot,
  minute: number,
): boolean {
  const hours = hoursOf(schedule);
  return hours !== null && closesNextDay(hours) && minute < hours.closes;
}

function previousDay(dayOfWeek: number): number {
  return dayOfWeek === 1 ? 7 : dayOfWeek - 1;
}

// Open now = the Abierto switch on and the Bogotá time inside the schedule
// (CLAUDE.md, section 10, "Disponibilidad").
export function isOpenNow(
  restaurant: Pick<RestaurantSnapshot, 'isOpen' | 'schedules'>,
  instant: Date,
): boolean {
  if (!restaurant.isOpen) {
    return false;
  }
  const { dayOfWeek, minuteOfDay } = toBogotaTime(instant);
  const yesterday = previousDay(dayOfWeek);
  return restaurant.schedules.some(
    (schedule) =>
      (schedule.dayOfWeek === dayOfWeek &&
        coversToday(schedule, minuteOfDay)) ||
      (schedule.dayOfWeek === yesterday &&
        coversAfterMidnight(schedule, minuteOfDay)),
  );
}
