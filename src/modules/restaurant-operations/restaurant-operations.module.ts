import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityAccessModule } from '../identity-access/index.js';
import { RestaurantEditController } from './restaurants/restaurant-edit.controller.js';
import { RestaurantEditService } from './restaurants/restaurant-edit.service.js';
import { RestaurantRegistrationController } from './restaurants/restaurant-registration.controller.js';
import { RestaurantRegistrationService } from './restaurants/restaurant-registration.service.js';
import { Restaurant } from './restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './restaurants/restaurant-schedule.entity.js';
import { RestaurantStatusController } from './restaurants/restaurant-status.controller.js';
import { RestaurantStatusService } from './restaurants/restaurant-status.service.js';
import { TableLog } from './table-logs/table-log.entity.js';
import { TableLogsController } from './table-logs/table-logs.controller.js';
import { DbTableStatusLog } from './table-logs/table-logs.recorder.js';
import { TableLogsService } from './table-logs/table-logs.service.js';
import { Table } from './tables/table.entity.js';
import { TableStatusLog } from './tables/table-status-log.js';
import { TablesController } from './tables/tables.controller.js';
import { TablesService } from './tables/tables.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Restaurant, RestaurantSchedule, Table, TableLog]),
    IdentityAccessModule,
  ],
  controllers: [
    TablesController,
    RestaurantEditController,
    RestaurantRegistrationController,
    RestaurantStatusController,
    TableLogsController,
  ],
  providers: [
    TablesService,
    RestaurantEditService,
    RestaurantRegistrationService,
    RestaurantStatusService,
    // Table log (PBI 9): table-logs/ implements the tables/ port.
    { provide: TableStatusLog, useClass: DbTableStatusLog },
    TableLogsService,
  ],
})
export class RestaurantOperationsModule {}
