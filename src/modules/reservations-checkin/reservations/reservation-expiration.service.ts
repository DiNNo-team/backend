import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, type EntityManager } from 'typeorm';
import { AfterCommitEvents } from '../../../common/events/after-commit-events.js';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  TableStatusLog,
  type RestaurantAvailabilityAffectedEvent,
} from '../../restaurant-operations/index.js';
import {
  Clock,
  RESERVATION_EXPIRED,
  type ReservationEndedEvent,
} from '../../search-availability/index.js';
import { releaseReservedTable } from './release-reserved-table.js';
import { Reservation } from './reservation.entity.js';

// Tamaño de cada lote del barrido: acota cuántas filas bloquea una transacción.
export const EXPIRY_BATCH_SIZE = 100;

// Qué reservas vencer. Vacío = todas las debidas (el barrido, §12.5); con algún
// campo, solo esas.
interface ExpirationScope {
  reservationId?: string;
  dinerId?: string;
  tableId?: string;
  restaurantId?: string;
}

// Fila que devuelve el UPDATE ... RETURNING: columnas de la base.
interface ExpiredRow {
  id: string;
  table_id: string;
  restaurant_id: string;
  diner_id: string;
}

// Vencimiento de las microreservas (§12.5, §12.3). La fuente de verdad es
// expires_at en PostgreSQL; no hay temporizadores en memoria.
//
// Se usa "al leer" (GET /reservations/...), "al crear" y "al operar", con un
// alcance, y en el barrido periódico (expireAllDue), por lotes: siempre la misma
// lógica. No conoce el WebSocket: solo emite eventos internos, después del commit.
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

  // Vence las reservas debidas de todo el restaurante. Lo usa la creación: si el
  // restaurante está lleno solo por reservas ya vencidas, el comensal recibe mesa.
  expireDueForRestaurant(restaurantId: string): Promise<number> {
    return this.expireDue({ restaurantId });
  }

  // El barrido (§12.5): vence todas las debidas, por lotes y con una transacción
  // por lote. Termina cuando un lote no se llena: lo que otra instancia tenga
  // bloqueado es de esa instancia, y lo que quede lo recoge el siguiente barrido.
  // Devuelve cuántas venció en total.
  async expireAllDue(): Promise<number> {
    let total = 0;
    let expired: number;
    do {
      expired = await this.expireDue({}, EXPIRY_BATCH_SIZE);
      total += expired;
    } while (expired >= EXPIRY_BATCH_SIZE);
    return total;
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
  // Los eventos salen después del commit de esta transacción (en el barrido, de
  // su lote): reservation.expired por reserva, table.status_changed por mesa que
  // cambió y el de disponibilidad, una vez por restaurante cuya mesa cambió.
  private async expireDue(
    scope: ExpirationScope,
    batchSize?: number,
  ): Promise<number> {
    const now = this.clock.now();
    const afterCommit = new AfterCommitEvents();
    const { expired, restaurantsToNotify } = await this.dataSource.transaction(
      async (manager) => {
        const rows = await this.markExpired(manager, scope, now, batchSize);
        const restaurants = new Set<string>();
        for (const row of rows) {
          afterCommit.add(RESERVATION_EXPIRED, {
            restaurantId: row.restaurant_id,
            dinerId: row.diner_id,
            reservationId: row.id,
            status: 'expired',
            tableId: row.table_id,
            at: now.toISOString(),
          } satisfies ReservationEndedEvent);
          if (await this.releaseTable(manager, afterCommit, row, now)) {
            restaurants.add(row.restaurant_id);
          }
        }
        return { expired: rows.length, restaurantsToNotify: restaurants };
      },
    );

    // Solo después del commit: quien escucha lee la base (CLAUDE.md §11).
    afterCommit.publish(this.events);
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
    batchSize?: number,
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
    if (scope.restaurantId !== undefined) {
      query.andWhere(`"restaurant_id" = :restaurantId`, {
        restaurantId: scope.restaurantId,
      });
    }
    // Lote: SKIP LOCKED salta lo que otra transacción tiene bloqueado, en vez de
    // esperarla. Dos barridos a la vez (varias instancias) toman lotes distintos.
    if (batchSize !== undefined) {
      query.andWhere(
        `"id" IN (SELECT "id" FROM "reservations" WHERE "status" = 'active' AND "expires_at" <= :now ORDER BY "expires_at" LIMIT :batchSize FOR UPDATE SKIP LOCKED)`,
        { batchSize },
      );
    }
    // RETURNING como texto, no como arreglo: en un arreglo TypeORM interpreta
    // cada elemento como NOMBRE DE PROPIEDAD de la entidad (tableId) y descarta
    // en silencio lo que no encuentra (con 'table_id' devolvía solo "id"). Con un
    // texto pasa tal cual al SQL y raw trae las columnas con los nombres de la
    // base, justo la forma de ExpiredRow; un error de escritura falla en el SQL.
    const result = await query
      .returning('"id", "table_id", "restaurant_id", "diner_id"')
      .execute();
    return result.raw as ExpiredRow[];
  }

  // reserved → available solo si sigue reserved (regla compartida con la
  // cancelación). Automático: sin usuario, source 'system' (§12.3). true si la
  // mesa cambió.
  private releaseTable(
    manager: EntityManager,
    afterCommit: AfterCommitEvents,
    row: ExpiredRow,
    now: Date,
  ): Promise<boolean> {
    return releaseReservedTable(manager, this.statusLog, afterCommit, {
      restaurantId: row.restaurant_id,
      tableId: row.table_id,
      userId: null,
      source: 'system',
      changedAt: now,
    });
  }
}
