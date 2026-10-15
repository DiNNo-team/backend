export const BOGOTA_TIME_ZONE = 'America/Bogota';

export interface BogotaTime {
  // ISO 8601: 1 = Monday ... 7 = Sunday.
  dayOfWeek: number;
  // 0 (00:00) ... 1439 (23:59).
  minuteOfDay: number;
}

const WEEKDAY_NUMBERS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

// Fixed time zone and locale: the result depends only on the instant, never
// on the server's TZ (Render runs in UTC, the team's computers in Bogotá).
const bogotaFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BOGOTA_TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Day of the week and minute of the day of an instant, as a clock in Bogotá
// shows them.
export function toBogotaTime(instant: Date): BogotaTime {
  const parts = new Map(
    bogotaFormatter
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    dayOfWeek: WEEKDAY_NUMBERS[parts.get('weekday') ?? ''],
    minuteOfDay: Number(parts.get('hour')) * 60 + Number(parts.get('minute')),
  };
}
