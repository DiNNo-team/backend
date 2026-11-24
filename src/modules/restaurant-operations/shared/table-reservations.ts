import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception.js';
import type { EntityManager } from 'typeorm';

// Reserva DiNNo activa de una mesa, lo que las acciones de mesa necesitan saber
// (CLAUDE.md §12.2): las personas de la reserva, para decidir si se puede bajar
// la capacidad.
export interface ActiveTableReservation {
  partySize: number;
}

// Puerto de las reservas, visto desde las mesas. Lo declara restaurant-operations
// y lo implementa reservations-checkin (que ya importa a restaurant-operations:
// por eso restaurant-operations no puede importar de vuelta). Es el mismo patrón
// que TableStatusLog, pero en sentido contrario.
//
// Una "reserva activa" es status 'active' Y expires_at > ahora.
export abstract class TableReservations {
  // Vence, en su propia transacción, la reserva activa de la mesa si ya pasó su
  // expires_at (§12.5). Se llama ANTES de abrir la transacción que bloquea la
  // fila de la mesa: vencer toca esa fila y, con el bloqueo ya tomado, las dos
  // transacciones se esperarían entre sí.
  abstract expireDueForTable(tableId: string): Promise<void>;

  // La reserva activa de la mesa, o null. Se llama DENTRO de la transacción de
  // la acción y DESPUÉS de tomar el bloqueo de la fila de la mesa: una
  // reserva que la creación acaba de confirmar ya se ve, y ninguna puede
  // colarse entre esta comprobación y el cambio.
  abstract findActiveForTable(
    tableId: string,
    manager: EntityManager,
  ): Promise<ActiveTableReservation | null>;

  // Reservas activas del restaurante (activeReservationsCount de §12.8).
  abstract countActive(restaurantId: string): Promise<number>;
}

// Sin reservas: la implementación que solo existe para los módulos montados
// aislados (las pruebas que montan RestaurantOperationsModule solo). En la
// aplicación real NO debe usarse: RequireTableReservationsPort lo impide.
class NoTableReservations extends TableReservations {
  expireDueForTable(): Promise<void> {
    return Promise.resolve();
  }

  findActiveForTable(): Promise<null> {
    return Promise.resolve(null);
  }

  countActive(): Promise<number> {
    return Promise.resolve(0);
  }
}

const NO_RESERVATIONS = new NoTableReservations();

// Cómo llegan las mesas al puerto sin importar reservations-checkin: busca en
// todo el contenedor la implementación registrada con el token TableReservations
// y, si no hay ninguna, usa la nula. Es lo que inyectan los servicios.
@Injectable()
export class TableReservationsAccess {
  private registered: TableReservations | undefined;

  constructor(private readonly moduleRef: ModuleRef) {}

  // true si reservations-checkin registró su implementación.
  isRegistered(): boolean {
    return this.port() !== NO_RESERVATIONS;
  }

  expireDueForTable(tableId: string): Promise<void> {
    return this.port().expireDueForTable(tableId);
  }

  findActiveForTable(
    tableId: string,
    manager: EntityManager,
  ): Promise<ActiveTableReservation | null> {
    return this.port().findActiveForTable(tableId, manager);
  }

  countActive(restaurantId: string): Promise<number> {
    return this.port().countActive(restaurantId);
  }

  private port(): TableReservations {
    if (this.registered) {
      return this.registered;
    }
    try {
      // strict: false busca en todos los módulos, no solo en los importados.
      const port = this.moduleRef.get(TableReservations, { strict: false });
      this.registered = port;
      return port;
    } catch (error) {
      // Nadie registró el puerto: módulo montado aislado. Cualquier otro error sube.
      if (error instanceof UnknownElementException) {
        return NO_RESERVATIONS;
      }
      throw error;
    }
  }
}

export const RESERVATIONS_PORT_MISSING_MESSAGE =
  'Falta la implementación de reservas de mesas (TableReservations): ReservationsCheckinModule tiene que estar registrado en AppModule. Sin ella las mesas con reserva activa no estarían protegidas, así que la aplicación no arranca.';

// Lo registra AppModule (la composición real). Hace que la app NO arranque si
// reservations-checkin no registró el puerto, en vez de seguir con la
// implementación nula y dejar las mesas desprotegidas sin que nadie lo note.
// Los módulos montados aislados en las pruebas no lo registran, y por eso
// pueden usar la implementación nula.
@Injectable()
export class RequireTableReservationsPort implements OnApplicationBootstrap {
  constructor(private readonly reservations: TableReservationsAccess) {}

  onApplicationBootstrap(): void {
    if (!this.reservations.isRegistered()) {
      throw new Error(RESERVATIONS_PORT_MISSING_MESSAGE);
    }
  }
}
