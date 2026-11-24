import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, type EntityManager } from 'typeorm';
import { AfterCommitEvents } from '../../../common/events/after-commit-events.js';
import type { CurrentUserData } from '../../identity-access/index.js';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  TableStatusLog,
  type RestaurantAvailabilityAffectedEvent,
} from '../../restaurant-operations/index.js';
import {
  Clock,
  RESERVATION_CANCELLED,
  type ReservationEndedEvent,
} from '../../search-availability/index.js';
import type { ReservationResponseDto } from './dto/reservation-response.dto.js';
import { releaseReservedTable } from './release-reserved-table.js';
import { ReservationExpirationService } from './reservation-expiration.service.js';
import {
  reservationNotActive,
  reservationNotFound,
} from './reservation-errors.js';
import { Reservation } from './reservation.entity.js';
import { ReservationViewReader } from './reservation-view.reader.js';

// Fila que devuelve el UPDATE ... RETURNING: columnas de la base.
interface CancelledRow {
  id: string;
  table_id: string;
  restaurant_id: string;
}

// Cancelar la microreserva (§12.1, §12.3). Solo el dueño y solo si está activa.
// No conoce el WebSocket: solo emite eventos internos, después del commit.
@Injectable()
export class ReservationCancellationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly expiration: ReservationExpirationService,
    private readonly statusLog: TableStatusLog,
    private readonly events: EventEmitter2,
    private readonly view: ReservationViewReader,
    private readonly clock: Clock,
  ) {}

  async cancel(
    user: CurrentUserData,
    id: string,
  ): Promise<ReservationResponseDto> {
    // Primero la lectura propia: no existe o es de otro comensal → el mismo 404.
    // Y por eso mismo nunca se vence la reserva de un tercero solo por conocer
    // su id: sin esta lectura, expireIfDue actuaría sobre cualquier id.
    const own = await this.findOwn(user.userId, id);
    if (own.status !== 'active') {
      throw reservationNotActive();
    }
    // Vencimiento al operar (§12.5), ANTES de abrir la transacción de
    // cancelación: vencer toca la fila de la mesa y, dentro de ella, las dos
    // transacciones se esperarían entre sí. Una activa ya vencida queda
    // expired y la cancelación responde 409.
    await this.expiration.expireIfDue(id);

    const outcome = await this.cancelInTransaction(user.userId, id);
    if (!outcome) {
      throw await this.whyNotCancelled(user.userId, id);
    }

    // Solo después del commit y solo si la mesa cambió: quien escucha lee la base.
    if (outcome.tableChanged) {
      const event: RestaurantAvailabilityAffectedEvent = {
        restaurantId: outcome.restaurantId,
      };
      this.events.emit(RESTAURANT_AVAILABILITY_AFFECTED, event);
    }

    const cancelled = await this.findOwn(user.userId, id);
    return this.view.toResponse(cancelled, this.clock.now());
  }

  // Reserva y mesa cambian juntas, o ninguna. null si el UPDATE no encontró una
  // reserva suya, activa y todavía vigente (otra operación se adelantó).
  private async cancelInTransaction(
    dinerId: string,
    id: string,
  ): Promise<{ restaurantId: string; tableChanged: boolean } | null> {
    const now = this.clock.now();
    const afterCommit = new AfterCommitEvents();
    const outcome = await this.dataSource.transaction(async (manager) => {
      const [row] = await this.markCancelled(manager, dinerId, id, now);
      if (!row) {
        return null;
      }
      afterCommit.add(RESERVATION_CANCELLED, {
        restaurantId: row.restaurant_id,
        dinerId,
        reservationId: row.id,
        status: 'cancelled',
        tableId: row.table_id,
        at: now.toISOString(),
      } satisfies ReservationEndedEvent);
      const tableChanged = await releaseReservedTable(
        manager,
        this.statusLog,
        afterCommit,
        {
          restaurantId: row.restaurant_id,
          tableId: row.table_id,
          userId: dinerId,
          source: 'reservation',
          changedAt: now,
        },
      );
      return { restaurantId: row.restaurant_id, tableChanged };
    });
    afterCommit.publish(this.events);
    return outcome;
  }

  // La condición va en el UPDATE: dos cancelaciones, o una cancelación y un
  // vencimiento a la vez, no se pisan; la que llega segunda espera el bloqueo de
  // la fila, ya no la ve activa y devuelve cero filas.
  private async markCancelled(
    manager: EntityManager,
    dinerId: string,
    id: string,
    now: Date,
  ): Promise<CancelledRow[]> {
    // RETURNING como texto, no como arreglo: en un arreglo TypeORM interpreta
    // cada elemento como NOMBRE DE PROPIEDAD de la entidad (tableId) y descarta
    // en silencio lo que no encuentra (con 'table_id' devolvía solo "id"). Con un
    // texto pasa tal cual al SQL y raw trae las columnas con los nombres de la
    // base, justo la forma de CancelledRow.
    const result = await manager
      .createQueryBuilder()
      .update(Reservation)
      .set({ status: 'cancelled', cancelledAt: now })
      .where(
        `"id" = :id AND "diner_id" = :dinerId AND "status" = 'active' AND "expires_at" > :now`,
        { id, dinerId, now },
      )
      .returning('"id", "table_id", "restaurant_id"')
      .execute();
    return result.raw as CancelledRow[];
  }

  // El UPDATE no encontró fila: se distingue leyendo. No existe o es de otro →
  // 404; existe y ya no está activa → 409. Si sigue activa es que venció entre
  // la lectura y el UPDATE sin que nadie la barriera: se vence ahora y es 409.
  private async whyNotCancelled(dinerId: string, id: string): Promise<Error> {
    const current = await this.dataSource
      .getRepository(Reservation)
      .findOne({ where: { id, dinerId } });
    if (!current) {
      return reservationNotFound();
    }
    if (current.status === 'active') {
      await this.expiration.expireIfDue(id);
    }
    return reservationNotActive();
  }

  private async findOwn(dinerId: string, id: string): Promise<Reservation> {
    const reservation = await this.dataSource
      .getRepository(Reservation)
      .findOne({ where: { id, dinerId } });
    if (!reservation) {
      throw reservationNotFound();
    }
    return reservation;
  }
}
