import type { RestaurantScheduleDto } from './dto/restaurant-schedule.dto.js';
import type { RestaurantSchedule } from './restaurant-schedule.entity.js';

// One restaurant_schedules row per open day, shared by registration and
// editing. A 24-hour day stores no times, whatever the client sent (the DTO
// rejects them).
export function toScheduleRow(
  restaurantId: string,
  day: RestaurantScheduleDto,
): Partial<RestaurantSchedule> {
  return {
    restaurantId,
    dayOfWeek: day.dayOfWeek,
    isOpen24h: day.isOpen24h,
    opensAt: day.isOpen24h ? null : (day.opensAt ?? null),
    closesAt: day.isOpen24h ? null : (day.closesAt ?? null),
  };
}
