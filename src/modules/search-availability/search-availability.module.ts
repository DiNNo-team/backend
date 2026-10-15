import { Module } from '@nestjs/common';
import { IdentityAccessModule } from '../identity-access/index.js';
import { AvailabilityService } from './availability/availability.service.js';
import { Clock, SystemClock } from './availability/clock.js';
import { RestaurantCandidatesReader } from './search/restaurant-candidates.reader.js';
import { RestaurantSearchService } from './search/restaurant-search.service.js';
import { SearchController } from './search/search.controller.js';

@Module({
  imports: [IdentityAccessModule],
  controllers: [SearchController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    AvailabilityService,
    RestaurantCandidatesReader,
    RestaurantSearchService,
  ],
  exports: [AvailabilityService],
})
export class SearchAvailabilityModule {}
