import { Injectable } from '@nestjs/common';
import { DataSource, MoreThan, type EntityManager } from 'typeorm';
import {
  TableReservations,
  type ActiveTableReservation,
} from '../../restaurant-operations/index.js';
import { Clock } from '../../search-availability/index.js';
import { ReservationExpirationService } from './reservation-expiration.service.js';
import { Reservation } from './reservation.entity.js';

// Implementación del puerto TableReservations (lo declara restaurant-operations,
// que no puede importar este módulo): lo que las mesas necesitan saber de las
// reservas (CLAUDE.md §12.2 y §12.8).
//
// "Reserva activa" = status 'active' Y expires_at > ahora. Una activa ya
// vencida que el proceso periódico aún no barrió no cuenta.
@Injectable()
export class ReservationsForTables extends TableReservations {
  constructor(
    private readonly dataSource: DataSource,
    private readonly expiration: ReservationExpirationService,
    private readonly clock: Clock,
  ) {
    super();
  }

  async expireDueForTable(tableId: string): Promise<void> {
    await this.expiration.expireDueForTable(tableId);
  }

  async findActiveForTable(
    tableId: string,
    manager: EntityManager,
  ): Promise<ActiveTableReservation | null> {
    const reservation = await manager.getRepository(Reservation).findOne({
      where: {
        tableId,
        status: 'active',
        expiresAt: MoreThan(this.clock.now()),
      },
      select: { partySize: true },
    });
    return reservation ? { partySize: reservation.partySize } : null;
  }

  countActive(restaurantId: string): Promise<number> {
    return this.dataSource.getRepository(Reservation).count({
      where: {
        restaurantId,
        status: 'active',
        expiresAt: MoreThan(this.clock.now()),
      },
    });
  }
}
