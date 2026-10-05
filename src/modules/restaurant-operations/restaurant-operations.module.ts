import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityAccessModule } from '../identity-access/index.js';
import { Restaurant } from './restaurants/restaurant.entity.js';
import { Table } from './tables/table.entity.js';
import { TablesController } from './tables/tables.controller.js';
import { TablesService } from './tables/tables.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Restaurant, Table]),
    IdentityAccessModule,
  ],
  controllers: [TablesController],
  providers: [TablesService],
})
export class RestaurantOperationsModule {}
