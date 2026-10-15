import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability/availability.service.js';
import { Clock, SystemClock } from './availability/clock.js';

@Module({
  providers: [{ provide: Clock, useClass: SystemClock }, AvailabilityService],
  exports: [AvailabilityService],
})
export class SearchAvailabilityModule {}
