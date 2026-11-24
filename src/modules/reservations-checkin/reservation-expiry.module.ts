import { Module } from '@nestjs/common';
import { reservationExpiryConfigProvider } from './reservations/reservation-expiry.config.js';
import { ReservationExpiryScheduler } from './reservations/reservation-expiry.scheduler.js';
import { ReservationsCheckinModule } from './reservations-checkin.module.js';

// El proceso periódico de vencimiento, aparte de ReservationsCheckinModule: solo
// lo importa AppModule, así que las pruebas que montan los módulos aislados nunca
// lo arrancan. Valida RESERVATION_EXPIRY_ENABLED al crear el módulo.
@Module({
  imports: [ReservationsCheckinModule],
  providers: [reservationExpiryConfigProvider, ReservationExpiryScheduler],
})
export class ReservationExpiryModule {}
