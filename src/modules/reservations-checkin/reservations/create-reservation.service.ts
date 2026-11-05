import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, type EntityManager } from 'typeorm';
import { isUniqueViolation } from '../../../common/database/unique-violation.js';
import type { CurrentUserData } from '../../identity-access/index.js';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  TableStatusLog,
  type RestaurantAvailabilityAffectedEvent,
} from '../../restaurant-operations/index.js';
import {
  AvailabilityService,
  canSeatParty,
  Clock,
  restaurantNotFound,
  type TableSnapshot,
} from '../../search-availability/index.js';
import type { CreateReservationDto } from './dto/create-reservation.dto.js';
import type { ReservationResponseDto } from './dto/reservation-response.dto.js';
import { CodeGenerator } from './reservation-code.js';
import { ReservationConfig } from './reservation.config.js';
import { Reservation } from './reservation.entity.js';
import {
  activeReservationExists,
  noTableAvailable,
  restaurantClosed,
} from './reservation-errors.js';
import { toReservationResponse } from './reservation.mapper.js';
import { rankCandidateTables } from './table-assignment.js';

// Nombres de los índices únicos parciales de la migración CreateReservations:
// la defensa final de la base se traduce por el nombre (§12.4).
export const UQ_ACTIVE_DINER = 'UQ_reservations_active_diner';
export const UQ_ACTIVE_TABLE = 'UQ_reservations_active_table';
export const UQ_ACTIVE_CODE = 'UQ_reservations_active_code';

// Intentos para dar con un código que no esté en uso (§12.4).
export const CODE_ATTEMPTS = 5;

const MINUTE_MS = 60_000;

// Restaurantes y mesas se leen y escriben por nombre de entidad: son de
// restaurant-operations y esta carpeta no importa sus archivos internos
// (CLAUDE.md §11). Solo las columnas que hacen falta.
interface RestaurantRow {
  id: string;
  name: string;
  address: string | null;
  // numeric: la entidad lo convierte a number; se tolera el texto de pg.
  latitude: number | string | null;
  longitude: number | string | null;
}

interface TableRow extends TableSnapshot {
  id: string;
  restaurantId: string;
  identifier: string;
}

interface VisibleRestaurant {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
}

// Crear la microreserva (§12.1, §12.3 y §12.4): elegir y bloquear la mesa,
// guardar la reserva, pasar la mesa a Reservada y escribir la bitácora, todo en
// una transacción. No conoce el WebSocket: solo emite el evento interno de
// disponibilidad, después del commit.
@Injectable()
export class CreateReservationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly availability: AvailabilityService,
    private readonly statusLog: TableStatusLog,
    private readonly events: EventEmitter2,
    private readonly clock: Clock,
    private readonly codes: CodeGenerator,
    private readonly config: ReservationConfig,
  ) {}

  async create(
    user: CurrentUserData,
    dto: CreateReservationDto,
  ): Promise<ReservationResponseDto> {
    const restaurant = await this.findVisibleRestaurant(dto.restaurantId);
    await this.assertOpenNow(restaurant.id);

    const { reservation, table } = await this.saveWithCodeRetry(
      user.userId,
      restaurant.id,
      dto.partySize,
    );

    // Solo después del commit: quien escucha lee la base (CLAUDE.md §11).
    const event: RestaurantAvailabilityAffectedEvent = {
      restaurantId: restaurant.id,
    };
    this.events.emit(RESTAURANT_AVAILABILITY_AFFECTED, event);

    return toReservationResponse(
      reservation,
      restaurant,
      table,
      this.clock.now(),
    );
  }

  // Visible = existe y tiene coordenadas: el mismo criterio del detalle público
  // (search-availability/public-restaurant), con su mismo 404.
  private async findVisibleRestaurant(id: string): Promise<VisibleRestaurant> {
    const row = await this.dataSource
      .getRepository<RestaurantRow>('Restaurant')
      .findOne({
        where: { id },
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
        },
      });
    if (!row || row.latitude === null || row.longitude === null) {
      throw restaurantNotFound();
    }
    return {
      id: row.id,
      name: row.name,
      address: row.address,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    };
  }

  // Abierto ahora = la regla isOpenNow de disponibilidad (is_open y horario de
  // Bogotá), sin duplicarla.
  //
  // Decisión conocida: se evalúa ANTES de la transacción. Si el restaurante
  // cierra (o termina su horario) en los milisegundos entre esta comprobación y
  // el commit, la reserva se crea igual; la regla de §12.2 respeta las reservas
  // ya hechas al cerrar, así que no deja nada trabado. Evitarlo del todo
  // exigiría leer los horarios dentro de la transacción y duplicar la regla.
  private async assertOpenNow(restaurantId: string): Promise<void> {
    const result = await this.availability.getForRestaurant(restaurantId);
    if (!result?.isOpenNow) {
      throw restaurantClosed();
    }
  }

  // Una transacción por intento. En Postgres un error la aborta, así que si el
  // código ya estaba en uso se repite la transacción completa con otro código.
  private async saveWithCodeRetry(
    dinerId: string,
    restaurantId: string,
    partySize: number,
  ): Promise<{ reservation: Reservation; table: TableRow }> {
    for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt++) {
      try {
        return await this.dataSource.transaction((manager) =>
          this.saveInTransaction(manager, dinerId, restaurantId, partySize),
        );
      } catch (error) {
        if (isUniqueViolation(error, UQ_ACTIVE_CODE)) {
          continue;
        }
        throw translateUniqueViolation(error);
      }
    }
    // Sin traducir a propósito: el filtro global responde 500 y registra el detalle.
    throw new Error(
      `No se pudo generar un código de reserva libre en ${CODE_ATTEMPTS} intentos.`,
    );
  }

  private async saveInTransaction(
    manager: EntityManager,
    dinerId: string,
    restaurantId: string,
    partySize: number,
  ): Promise<{ reservation: Reservation; table: TableRow }> {
    await this.assertNoActiveReservation(manager, dinerId);
    const table = await this.lockAssignableTable(
      manager,
      restaurantId,
      partySize,
    );

    const now = this.clock.now();
    const reservation = await manager.getRepository(Reservation).save({
      code: this.codes.generate(),
      status: 'active',
      partySize,
      dinerId,
      restaurantId,
      tableId: table.id,
      expiresAt: new Date(now.getTime() + this.config.ttlMinutes * MINUTE_MS),
      cancelledAt: null,
      expiredAt: null,
      checkedInAt: null,
      noShow: false,
    });

    // La mesa solo cambia si sigue Disponible: lo acaba de comprobar bajo el
    // bloqueo de la fila.
    await manager
      .getRepository<TableRow>('Table')
      .update({ id: table.id }, { status: 'reserved' });
    await this.statusLog.record(
      {
        tableId: table.id,
        previousStatus: 'available',
        newStatus: 'reserved',
        userId: dinerId,
        source: 'reservation',
        changedAt: now,
      },
      manager,
    );
    return { reservation, table };
  }

  // Una sola reserva activa por comensal (§12.1). Método aparte: el
  // vencimiento perezoso (§12.5) se antepone aquí sin reescribirlo.
  private async assertNoActiveReservation(
    manager: EntityManager,
    dinerId: string,
  ): Promise<void> {
    const hasActive = await manager
      .getRepository(Reservation)
      .exists({ where: { dinerId, status: 'active' } });
    if (hasActive) {
      throw activeReservationExists();
    }
  }

  // Elige y bloquea la mesa (§12.1 y §12.4).
  //   1. Lee las candidatas y las ordena con la regla pura (rankCandidateTables).
  //   2. Las recorre en ese orden e intenta bloquear UNA: FOR UPDATE SKIP LOCKED
  //      no espera, y devuelve null si otra transacción la tiene bloqueada.
  //      Bloquear solo una (no todas las candidatas) evita que dos solicitudes
  //      se estorben cuando sobran mesas.
  //   3. Bajo el bloqueo revalida con la misma regla (activa, Disponible,
  //      capacidad, y del restaurante): otra transacción pudo cambiarla entre la
  //      lectura y el bloqueo.
  // Si se agotan, NO_TABLE_AVAILABLE.
  private async lockAssignableTable(
    manager: EntityManager,
    restaurantId: string,
    partySize: number,
  ): Promise<TableRow> {
    const tables = manager.getRepository<TableRow>('Table');
    const candidates = await tables.find({
      where: { restaurantId, isActive: true, status: 'available' },
      select: {
        id: true,
        identifier: true,
        capacity: true,
        status: true,
        isActive: true,
      },
    });
    for (const candidate of rankCandidateTables(candidates, partySize)) {
      const locked = await tables.findOne({
        where: { id: candidate.id, restaurantId },
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });
      if (
        locked &&
        locked.restaurantId === restaurantId &&
        canSeatParty(locked, partySize)
      ) {
        return locked;
      }
    }
    throw noTableAvailable();
  }
}

// La base ya garantizó la regla con los índices únicos parciales: aquí solo
// se traduce qué regla se violó. Cualquier otro error pasa igual.
function translateUniqueViolation(error: unknown): unknown {
  if (isUniqueViolation(error, UQ_ACTIVE_DINER)) {
    return activeReservationExists();
  }
  if (isUniqueViolation(error, UQ_ACTIVE_TABLE)) {
    return noTableAvailable();
  }
  return error;
}
