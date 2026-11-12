import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityAccessModule } from '../identity-access/index.js';
import { PushDevice } from './devices/push-device.entity.js';
import { PushDevicesController } from './devices/push-devices.controller.js';
import { PushDevicesService } from './devices/push-devices.service.js';
import { createPushSender, PushSender } from './push/push-sender.js';
import { ReservationFactsReader } from './reservations/reservation-facts.reader.js';
import { ReservationNotificationsListener } from './reservations/reservation-notifications.listener.js';

// Push notifications of the reservation to the diner (Sprint 4, PBI 1.1). It
// only listens to the internal reservation events: nothing depends on this
// module, and without credentials it stays off.
@Module({
  imports: [TypeOrmModule.forFeature([PushDevice]), IdentityAccessModule],
  controllers: [PushDevicesController],
  providers: [
    PushDevicesService,
    ReservationFactsReader,
    ReservationNotificationsListener,
    {
      provide: PushSender,
      inject: [ConfigService],
      useFactory: createPushSender,
    },
  ],
})
export class NotificationsModule {}
