import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityAccessModule } from '../identity-access/index.js';
import { RestaurantEditController } from './restaurants/restaurant-edit.controller.js';
import { RestaurantEditService } from './restaurants/restaurant-edit.service.js';
import { Restaurant } from './restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './restaurants/restaurant-schedule.entity.js';
import { TableLog } from './table-logs/table-log.entity.js';
import { DbTableStatusLog } from './table-logs/table-logs.recorder.js';
import { Table } from './tables/table.entity.js';
import { TableStatusLog } from './tables/table-status-log.js';
import { TablesController } from './tables/tables.controller.js';
import { TablesService } from './tables/tables.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Restaurant, RestaurantSchedule, Table, TableLog]),
    IdentityAccessModule,
  ],
  controllers: [TablesController, RestaurantEditController],
  providers: [
    TablesService,
    RestaurantEditService,
    // Table log (PBI 9): table-logs/ implements the tables/ port.
    { provide: TableStatusLog, useClass: DbTableStatusLog },
  ],
})
export class RestaurantOperationsModule {}
