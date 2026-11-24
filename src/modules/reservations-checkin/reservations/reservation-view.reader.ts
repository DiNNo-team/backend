import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ReservationResponseDto } from './dto/reservation-response.dto.js';
import { toReservationResponse } from './reservation.mapper.js';
import type { Reservation } from './reservation.entity.js';

// Restaurante y mesa se leen por nombre de entidad (son de
// restaurant-operations, CLAUDE.md §11), con las columnas justas.
interface RestaurantRow {
  id: string;
  name: string;
  address: string | null;
  // numeric: la entidad lo convierte a number; se tolera el texto de pg.
  latitude: number | string;
  longitude: number | string;
}

interface TableRow {
  id: string;
  identifier: string;
  capacity: number;
}

// Arma la Reservation (§12.8) de una reserva ya cargada: carga su restaurante y
// su mesa y usa el mapper de la creación. Lo usan las rutas de lectura.
@Injectable()
export class ReservationViewReader {
  constructor(private readonly dataSource: DataSource) {}

  async toResponse(
    reservation: Reservation,
    serverTime: Date,
  ): Promise<ReservationResponseDto> {
    const [restaurant, table] = await Promise.all([
      this.dataSource.getRepository<RestaurantRow>('Restaurant').findOne({
        where: { id: reservation.restaurantId },
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
        },
      }),
      this.dataSource.getRepository<TableRow>('Table').findOne({
        where: { id: reservation.tableId },
        select: { identifier: true, capacity: true },
      }),
    ]);
    // Las FK de reservations garantizan que ambas existen.
    if (!restaurant || !table) {
      throw new Error(
        `La reserva ${reservation.id} apunta a un restaurante o una mesa que no existe.`,
      );
    }
    return toReservationResponse(
      reservation,
      {
        id: restaurant.id,
        name: restaurant.name,
        address: restaurant.address,
        latitude: Number(restaurant.latitude),
        longitude: Number(restaurant.longitude),
      },
      table,
      serverTime,
    );
  }
}
