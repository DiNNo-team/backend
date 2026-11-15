// API pública de reservations-checkin: otros módulos importan solo de aquí.
export { ReservationsCheckinModule } from './reservations-checkin.module.js';
export { ReservationExpiryModule } from './reservation-expiry.module.js';
export {
  RESERVATION_CODE_ALPHABET,
  RESERVATION_STATUSES,
  type ReservationStatus,
} from './reservations/reservation.constants.js';
// Agregaciones del resumen del restaurante (CLAUDE.md §11, "Resumen y KPIs"),
// sin HTTP: las reutiliza el informe de IA del Sprint 4.
export {
  RestaurantMetricsService,
  type RestaurantMetrics,
} from './reports/restaurant-metrics.service.js';
export {
  parseReportPeriod,
  REPORT_MAX_DAYS,
  REPORT_TIMEZONE,
  type ReportPeriod,
  type ReportPeriodQuery,
} from './reports/report-period.js';
