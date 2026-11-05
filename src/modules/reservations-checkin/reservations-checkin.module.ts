import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckIn } from './check-ins/check-in.entity.js';
import { Reservation } from './reservations/reservation.entity.js';

// Microreservas y check-in (Sprint 3). Por ahora solo el modelo de datos:
// los servicios y controladores llegan en las siguientes tareas.
@Module({
  imports: [TypeOrmModule.forFeature([Reservation, CheckIn])],
})
export class ReservationsCheckinModule {}
