import { Module } from '@nestjs/common';
import { IdentityAccessModule } from '../identity-access/index.js';
import { AvailabilityService } from './availability/availability.service.js';
import { Clock, SystemClock } from './availability/clock.js';
import { PublicRestaurantController } from './public-restaurant/public-restaurant.controller.js';
import { PublicRestaurantReader } from './public-restaurant/public-restaurant.reader.js';
import { PublicRestaurantService } from './public-restaurant/public-restaurant.service.js';
import { RestaurantCandidatesReader } from './search/restaurant-candidates.reader.js';
import { RestaurantSearchService } from './search/restaurant-search.service.js';
import { SearchController } from './search/search.controller.js';

@Module({
  imports: [IdentityAccessModule],
  controllers: [SearchController, PublicRestaurantController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    AvailabilityService,
    RestaurantCandidatesReader,
    RestaurantSearchService,
    PublicRestaurantReader,
    PublicRestaurantService,
  ],
  exports: [AvailabilityService],
})
export class SearchAvailabilityModule {}
