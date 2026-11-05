import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, type EntityManager } from 'typeorm';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  TableStatusLog,
  type RestaurantAvailabilityAffectedEvent,
} from '../../restaurant-operations/index.js';
import { Clock } from '../../search-availability/index.js';
import { Reservation } from './reservation.entity.js';

// Qué reservas vencer. Vacío = todas las debidas (lo usará el proceso de cada
// 15 s de la tarea 6, §12.5); con reservationId o dinerId, solo esas.
interface ExpirationScope {
  reservationId?: string;
  dinerId?: string;
  tableId?: string;
}

// Fila que devuelve el UPDATE ... RETURNING: columnas de la base.
interface ExpiredRow {
  id: string;
  table_id: string;
  restaurant_id: string;
}

// La mesa se lee y escribe por nombre de entidad (es de restaurant-operations).
interface TableRow {
  id: string;
  status: string;
}

// Vencimiento de las microreservas (§12.5, §12.3). La fuente de verdad es
// expires_at en PostgreSQL; no hay temporizadores en memoria.
//
// Hoy se usa "al leer" (GET /reservations/...) y "al crear" (antes de comprobar
// la reserva activa). La tarea 6 agrega expireAllDue() llamando a expireDue({}),
// la misma lógica, para el proceso periódico. No conoce el WebSocket: solo emite
// el evento interno de disponibilidad.
@Injectable()
export class ReservationExpirationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly statusLog: TableStatusLog,
    private readonly events: EventEmitter2,
    private readonly clock: Clock,
  ) {}

  // Vence esa reserva si está activa y ya pasó su expires_at. Devuelve cuántas
  // venció esta llamada (0 si no era debida o si otra operación ya la resolvió).
  expireIfDue(reservationId: string): Promise<number> {
    return this.expireDue({ reservationId });
  }

  // Vence la reserva activa del comensal si ya pasó su expires_at.
  expireDueForDiner(dinerId: string): Promise<number> {
    return this.expireDue({ dinerId });
  }

  // Vence la reserva activa de la mesa si ya pasó su expires_at. Lo usan las
  // acciones del restaurante sobre una mesa (§12.2) antes de comprobar si tiene
  // una reserva en curso.
  expireDueForTable(tableId: string): Promise<number> {
    return this.expireDue({ tableId });
  }

  // Núcleo: una transacción por llamada.
  //   1. Un solo UPDATE ... RETURNING con la condición dentro del UPDATE
  //      (status = 'active' y expires_at <= ahora): es idempotente y no pisa una
  //      reserva que otra operación acaba de cancelar o cumplir. Dos llamadas
  //      simultáneas sobre la misma reserva: la segunda espera el bloqueo de la
  //      fila, ya no la ve activa y devuelve 0 filas (sin error, sin doble bitácora).
  //   2. Por cada reserva vencida, la mesa vuelve a available SOLO si sigue en
  //      reserved: nunca se pisa un estado que el restaurante cambió después. Y
  //      la bitácora solo se escribe si la mesa realmente cambió.
  // El evento sale después del commit, una vez por restaurante cuya mesa cambió.
  private async expireDue(scope: ExpirationScope): Promise<number> {
    const now = this.clock.now();
    const { expired, restaurantsToNotify } = await this.dataSource.transaction(
      async (manager) => {
        const rows = await this.markExpired(manager, scope, now);
        const restaurants = new Set<string>();
        for (const row of rows) {
          if (await this.releaseTable(manager, row, now)) {
            restaurants.add(row.restaurant_id);
          }
        }
        return { expired: rows.length, restaurantsToNotify: restaurants };
      },
    );

    // Solo después del commit: quien escucha lee la base (CLAUDE.md §11).
    for (const restaurantId of restaurantsToNotify) {
      const event: RestaurantAvailabilityAffectedEvent = { restaurantId };
      this.events.emit(RESTAURANT_AVAILABILITY_AFFECTED, event);
    }
    return expired;
  }

  private async markExpired(
    manager: EntityManager,
    scope: ExpirationScope,
    now: Date,
  ): Promise<ExpiredRow[]> {
    const query = manager
      .createQueryBuilder()
      .update(Reservation)
      .set({ status: 'expired', expiredAt: now, noShow: true })
      .where(`"status" = 'active' AND "expires_at" <= :now`, { now });
    if (scope.reservationId !== undefined) {
      query.andWhere(`"id" = :reservationId`, {
        reservationId: scope.reservationId,
      });
    }
    if (scope.dinerId !== undefined) {
      query.andWhere(`"diner_id" = :dinerId`, { dinerId: scope.dinerId });
    }
    if (scope.tableId !== undefined) {
      query.andWhere(`"table_id" = :tableId`, { tableId: scope.tableId });
    }
    // RETURNING como texto, no como arreglo: en un arreglo TypeORM interpreta
    // cada elemento como NOMBRE DE PROPIEDAD de la entidad (tableId) y descarta
    // en silencio lo que no encuentra (con 'table_id' devolvía solo "id"). Con un
    // texto pasa tal cual al SQL y raw trae las columnas con los nombres de la
    // base, justo la forma de ExpiredRow; un error de escritura falla en el SQL.
    const result = await query
      .returning('"id", "table_id", "restaurant_id"')
      .execute();
    return result.raw as ExpiredRow[];
  }

  // reserved → available solo si sigue reserved. true si la mesa cambió.
  private async releaseTable(
    manager: EntityManager,
    row: ExpiredRow,
    now: Date,
  ): Promise<boolean> {
    const released = await manager
      .getRepository<TableRow>('Table')
      .update(
        { id: row.table_id, status: 'reserved' },
        { status: 'available' },
      );
    if (released.affected !== 1) {
      return false;
    }
    // Automático: sin usuario (§12.3).
    await this.statusLog.record(
      {
        tableId: row.table_id,
        previousStatus: 'reserved',
        newStatus: 'available',
        userId: null,
        source: 'system',
        changedAt: now,
      },
      manager,
    );
    return true;
  }
}
