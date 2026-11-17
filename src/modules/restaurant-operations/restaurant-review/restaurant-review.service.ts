import type { ConflictException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Clock } from '../../../common/time/clock.js';
import {
  APPROVED,
  PENDING,
  REJECTED,
  SUSPENDED,
  type RestaurantApprovalStatus,
} from '../../identity-access/index.js';
import {
  availabilityAffected,
  RESTAURANT_AVAILABILITY_AFFECTED,
} from '../shared/availability-affected.event.js';
import { restaurantNotFound } from '../shared/restaurant-not-found.js';
import { Restaurant } from '../restaurants/restaurant.entity.js';
import {
  restaurantNotApproved,
  restaurantNotPending,
  restaurantNotSuspended,
} from './review-errors.js';

// Columnas que cambia una decisión del administrador: el estado y su auditoría
// (la de la revisión o la de la suspensión). No hay tabla de auditoría.
type DecisionChanges = Partial<
  Pick<
    Restaurant,
    | 'approvalStatus'
    | 'rejectionReason'
    | 'reviewedBy'
    | 'reviewedAt'
    | 'suspensionReason'
    | 'suspendedAt'
    | 'suspendedBy'
  >
>;

// Las decisiones del administrador de DiNNo sobre un restaurante (§11,
// "Administrador"):
//   pending  → approved | rejected  (aprobar, rechazar)
//   approved → suspended            (suspender, con motivo)
//   suspended → approved            (reactivar)
//
// Cada una es UNA sentencia condicional (UPDATE ... WHERE id AND
// approval_status = <el estado de origen>): la base decide quién gana. Dos
// administradores a la vez sobre el mismo restaurante: el segundo espera el
// bloqueo de la fila, ya no lo ve en el estado de origen y no actualiza nada
// (409). Nada queda a medias. Como en RestaurantStatusService, basta con
// affected: no hace falta leer columnas de vuelta (el detalle se lee después).
@Injectable()
export class RestaurantReviewService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    private readonly clock: Clock,
    private readonly events: EventEmitter2,
  ) {}

  // Después de guardar avisa a la disponibilidad: el restaurante puede empezar a
  // aparecer para los comensales si cumple lo demás (coordenadas, horario, mesas).
  async approve(adminId: string, restaurantId: string): Promise<void> {
    await this.transition(
      restaurantId,
      PENDING,
      {
        approvalStatus: APPROVED,
        rejectionReason: null,
        reviewedBy: adminId,
        reviewedAt: this.clock.now(),
      },
      restaurantNotPending,
    );
    this.availabilityChanged(restaurantId);
  }

  // Un rechazado nunca fue visible: no hay disponibilidad que avisar.
  async reject(
    adminId: string,
    restaurantId: string,
    reason: string,
  ): Promise<void> {
    await this.transition(
      restaurantId,
      PENDING,
      {
        approvalStatus: REJECTED,
        rejectionReason: reason,
        reviewedBy: adminId,
        reviewedAt: this.clock.now(),
      },
      restaurantNotPending,
    );
  }

  // Deja de ser visible para los comensales y de operar. Las reservas activas
  // no se tocan: siguen hasta el check-in, la cancelación o el vencimiento.
  // Emite el evento de disponibilidad como al aprobar. Ojo: hoy el listener no
  // envía availability.changed de un restaurante que el comensal no puede ver
  // (getForRestaurant da null), así que la app lo quita en su siguiente
  // consulta (máximo 60 s), no al instante (riesgo anotado en AVISOS.md).
  async suspend(
    adminId: string,
    restaurantId: string,
    reason: string,
  ): Promise<void> {
    await this.transition(
      restaurantId,
      APPROVED,
      {
        approvalStatus: SUSPENDED,
        suspensionReason: reason,
        suspendedBy: adminId,
        suspendedAt: this.clock.now(),
      },
      restaurantNotApproved,
    );
    this.availabilityChanged(restaurantId);
  }

  // Vuelve a approved. Conserva la última suspensión (motivo, cuándo y quién)
  // y la revisión original: reactivar no es una nueva aprobación.
  async reactivate(restaurantId: string): Promise<void> {
    await this.transition(
      restaurantId,
      SUSPENDED,
      { approvalStatus: APPROVED },
      restaurantNotSuspended,
    );
    this.availabilityChanged(restaurantId);
  }

  private availabilityChanged(restaurantId: string): void {
    this.events.emit(
      RESTAURANT_AVAILABILITY_AFFECTED,
      availabilityAffected(restaurantId),
    );
  }

  private async transition(
    restaurantId: string,
    from: RestaurantApprovalStatus,
    changes: DecisionChanges,
    conflict: () => ConflictException,
  ): Promise<void> {
    const { affected } = await this.restaurants.update(
      { id: restaurantId, approvalStatus: from },
      changes,
    );
    if (affected === 1) {
      return;
    }
    // No cambió: o no existe, o ya no estaba en el estado de origen.
    const exists = await this.restaurants.existsBy({ id: restaurantId });
    throw exists ? conflict() : restaurantNotFound();
  }
}
