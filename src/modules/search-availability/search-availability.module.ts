import { Module } from '@nestjs/common';
import { IdentityAccessModule } from '../identity-access/index.js';
import { AvailabilityService } from './availability/availability.service.js';
import { Clock, SystemClock } from './availability/clock.js';
import {
  ReservationConfig,
  reservationConfigProvider,
} from './reservation-ttl/reservation-ttl.config.js';
import { PublicRestaurantController } from './public-restaurant/public-restaurant.controller.js';
import { PublicRestaurantReader } from './public-restaurant/public-restaurant.reader.js';
import { PublicRestaurantService } from './public-restaurant/public-restaurant.service.js';
import { AvailabilityChangedListener } from './realtime/availability-changed.listener.js';
import { AvailabilityGateway } from './realtime/availability.gateway.js';
import { ReservationEventsListener } from './realtime/reservation-events.listener.js';
import { RestaurantCandidatesReader } from './search/restaurant-candidates.reader.js';
import { RestaurantSearchService } from './search/restaurant-search.service.js';
import { SearchController } from './search/search.controller.js';

@Module({
  imports: [IdentityAccessModule],
  controllers: [SearchController, PublicRestaurantController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    // TTL de la microreserva: lo valida al crear el módulo (la app no arranca si es inválido).
    reservationConfigProvider,
    AvailabilityService,
    RestaurantCandidatesReader,
    RestaurantSearchService,
    PublicRestaurantReader,
    PublicRestaurantService,
    // Real time (Sprint 2): restaurant-operations event → listener → gateway.
    AvailabilityGateway,
    AvailabilityChangedListener,
    // Sprint 3: eventos internos de reservas y bitácora → salas del socket.
    ReservationEventsListener,
  ],
  // Clock: reservations-checkin uses the same source of time (and the tests fix it once).
  // ReservationConfig: reservations-checkin usa el mismo valor para crear reservas.
  exports: [AvailabilityService, Clock, ReservationConfig],
})
export class SearchAvailabilityModule {}
