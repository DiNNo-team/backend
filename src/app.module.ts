import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { IdentityAccessModule } from './modules/identity-access/identity-access.module.js';
import { RestaurantOperationsModule } from './modules/restaurant-operations/restaurant-operations.module.js';
import { ReservationsCheckinModule } from './modules/reservations-checkin/reservations-checkin.module.js';
import { SearchAvailabilityModule } from './modules/search-availability/search-availability.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';

@Module({
  imports: [IdentityAccessModule, RestaurantOperationsModule, ReservationsCheckinModule, SearchAvailabilityModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
