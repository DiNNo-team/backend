import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityAccessModule } from '../identity-access/index.js';
import {
  RestaurantOperationsModule,
  TableReservations,
} from '../restaurant-operations/index.js';
import { SearchAvailabilityModule } from '../search-availability/index.js';
import { BillingPeriodsService } from './billing/billing-periods.service.js';
import { BillingStatementService } from './billing/billing-statement.service.js';
import { checkInFeeConfigProvider } from './billing/checkin-fee.config.js';
import { CheckIn } from './check-ins/check-in.entity.js';
import { CheckInService } from './check-ins/check-in.service.js';
import { CheckInsController } from './check-ins/check-ins.controller.js';
import { ReservationLabelsReader } from './check-ins/reservation-labels.reader.js';
import { RestaurantReservationsService } from './check-ins/restaurant-reservations.service.js';
import { CreateReservationService } from './reservations/create-reservation.service.js';
import {
  CodeGenerator,
  RandomCodeGenerator,
} from './reservations/reservation-code.js';
import { ReservationCancellationService } from './reservations/reservation-cancellation.service.js';
import { ReservationExpirationService } from './reservations/reservation-expiration.service.js';
import { ReservationQueryService } from './reservations/reservation-query.service.js';
import { Reservation } from './reservations/reservation.entity.js';
import { ReservationViewReader } from './reservations/reservation-view.reader.js';
import { ReservationsController } from './reservations/reservations.controller.js';
import { ReservationsForTables } from './reservations/reservations-for-tables.js';
import { AdminBillingController } from './platform/admin-billing.controller.js';
import { AdminPlatformController } from './platform/admin-platform.controller.js';
import { PlatformBillingReader } from './platform/platform-billing.reader.js';
import { PlatformReportsService } from './platform/platform-reports.service.js';
import { RestaurantReportsController } from './reports/restaurant-reports.controller.js';
import { RestaurantMetricsService } from './reports/restaurant-metrics.service.js';
import { RestaurantReportsService } from './reports/restaurant-reports.service.js';
import { RestaurantSummaryReader } from './reports/restaurant-summary.reader.js';

// Microreservas y check-in (Sprint 3), el cobro por check-in y, desde el
// Sprint 4, los reportes de plataforma del administrador (son dueños de
// check_ins, reservations y billing_periods). Depende de search-availability
// (AvailabilityService y Clock) y de restaurant-operations (el puerto de la
// bitácora); ninguno depende de este módulo. ReservationConfig (el TTL) llega
// exportada por SearchAvailabilityModule, que la valida al arrancar.
@Module({
  imports: [
    // billing_periods (BillingPeriod) is read and written with raw SQL only
    // (PlatformBillingReader, BillingPeriodsService): it is not registered here,
    // so the e2e tests that mount this module need no extra repository
    // override. data-source.ts loads it by glob for the migrations.
    TypeOrmModule.forFeature([Reservation, CheckIn]),
    IdentityAccessModule,
    SearchAvailabilityModule,
    RestaurantOperationsModule,
  ],
  controllers: [
    ReservationsController,
    CheckInsController,
    RestaurantReportsController,
    // Panel del administrador de DiNNo (Sprint 4): cobro, resumen, directorio
    // y métricas de toda la plataforma.
    AdminBillingController,
    AdminPlatformController,
  ],
  providers: [
    // Tarifa por comensal (CHECKIN_FEE_PER_GUEST_COP): la valida al crear el módulo.
    checkInFeeConfigProvider,
    BillingStatementService,
    RestaurantMetricsService,
    RestaurantReportsService,
    RestaurantSummaryReader,
    PlatformBillingReader,
    PlatformReportsService,
    BillingPeriodsService,
    CheckInService,
    RestaurantReservationsService,
    ReservationLabelsReader,
    CreateReservationService,
    ReservationExpirationService,
    ReservationCancellationService,
    ReservationQueryService,
    ReservationViewReader,
    // Puerto que restaurant-operations declara para proteger las mesas con
    // reserva activa (§12.2); se encuentra por su token sin importar este módulo.
    { provide: TableReservations, useClass: ReservationsForTables },
    { provide: CodeGenerator, useClass: RandomCodeGenerator },
  ],
  // Para ReservationExpiryModule, el proceso periódico.
  // RestaurantMetricsService: las agregaciones del resumen, para el informe de
  // IA del Sprint 4.
  exports: [ReservationExpirationService, RestaurantMetricsService],
})
export class ReservationsCheckinModule {}
