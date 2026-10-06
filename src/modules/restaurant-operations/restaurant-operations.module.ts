import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityAccessModule } from '../identity-access/index.js';
import { RestaurantEditController } from './restaurants/restaurant-edit.controller.js';
import { RestaurantEditService } from './restaurants/restaurant-edit.service.js';
import { Restaurant } from './restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './restaurants/restaurant-schedule.entity.js';
import { NoopTableStatusLog } from './tables/noop-table-status-log.js';
import { Table } from './tables/table.entity.js';
import { TableStatusLog } from './tables/table-status-log.js';
import { TablesController } from './tables/tables.controller.js';
import { TablesService } from './tables/tables.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Restaurant, RestaurantSchedule, Table]),
    IdentityAccessModule,
  ],
  controllers: [TablesController, RestaurantEditController],
  providers: [
    TablesService,
    RestaurantEditService,
    // Table log: replace NoopTableStatusLog with the table-logs/ implementation.
    { provide: TableStatusLog, useClass: NoopTableStatusLog },
  ],
})
export class RestaurantOperationsModule {}
