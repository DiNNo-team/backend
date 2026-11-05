import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityAccessModule } from '../identity-access/index.js';
import { RestaurantOperationsModule } from '../restaurant-operations/index.js';
import { SearchAvailabilityModule } from '../search-availability/index.js';
import { CheckIn } from './check-ins/check-in.entity.js';
import { CreateReservationService } from './reservations/create-reservation.service.js';
import {
  CodeGenerator,
  RandomCodeGenerator,
} from './reservations/reservation-code.js';
import { reservationConfigProvider } from './reservations/reservation.config.js';
import { Reservation } from './reservations/reservation.entity.js';
import { ReservationsController } from './reservations/reservations.controller.js';

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
    { provide: CodeGenerator, useClass: RandomCodeGenerator },
    // Valida RESERVATION_TTL_MINUTES al crear el módulo: si es inválida, la app no arranca.
    reservationConfigProvider,
  ],
})
export class ReservationsCheckinModule {}
