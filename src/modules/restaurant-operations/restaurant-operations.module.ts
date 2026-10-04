import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Restaurant } from './restaurants/restaurant.entity.js';
import { Table } from './tables/table.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Restaurant, Table])],
})
export class RestaurantOperationsModule {}
