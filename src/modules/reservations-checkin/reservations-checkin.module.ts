import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityAccessModule } from '../identity-access/index.js';
import {
  RestaurantOperationsModule,
  TableReservations,
} from '../restaurant-operations/index.js';
import { SearchAvailabilityModule } from '../search-availability/index.js';
import { CheckIn } from './check-ins/check-in.entity.js';
import { CreateReservationService } from './reservations/create-reservation.service.js';
import {
  CodeGenerator,
  RandomCodeGenerator,
} from './reservations/reservation-code.js';
import { reservationConfigProvider } from './reservations/reservation.config.js';
import { ReservationCancellationService } from './reservations/reservation-cancellation.service.js';
import { ReservationExpirationService } from './reservations/reservation-expiration.service.js';
import { ReservationQueryService } from './reservations/reservation-query.service.js';
import { Reservation } from './reservations/reservation.entity.js';
import { ReservationViewReader } from './reservations/reservation-view.reader.js';
import { ReservationsController } from './reservations/reservations.controller.js';
import { ReservationsForTables } from './reservations/reservations-for-tables.js';

// Microreservas y check-in (Sprint 3). Depende de search-availability
// (AvailabilityService y Clock) y de restaurant-operations (el puerto de la
// bitácora); ninguno depende de este módulo.
@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, CheckIn]),
    IdentityAccessModule,
    SearchAvailabilityModule,
    RestaurantOperationsModule,
  ],
  controllers: [ReservationsController],
  providers: [
    CreateReservationService,
    ReservationExpirationService,
    ReservationCancellationService,
    ReservationQueryService,
    ReservationViewReader,
    // Puerto que restaurant-operations declara para proteger las mesas con
    // reserva activa (§12.2); se encuentra por su token sin importar este módulo.
    { provide: TableReservations, useClass: ReservationsForTables },
    { provide: CodeGenerator, useClass: RandomCodeGenerator },
    // Valida RESERVATION_TTL_MINUTES al crear el módulo: si es inválida, la app no arranca.
    reservationConfigProvider,
  ],
  // Para ReservationExpiryModule, el proceso periódico.
  exports: [ReservationExpirationService],
})
export class ReservationsCheckinModule {}
