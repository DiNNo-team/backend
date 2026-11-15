import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Clock } from '../../../common/time/clock.js';
import { APPROVED, PENDING, REJECTED } from '../../identity-access/index.js';
import {
  availabilityAffected,
  RESTAURANT_AVAILABILITY_AFFECTED,
} from '../shared/availability-affected.event.js';
import { restaurantNotFound } from '../shared/restaurant-not-found.js';
import { Restaurant } from '../restaurants/restaurant.entity.js';
import { restaurantNotPending } from './review-errors.js';

// Columnas que cambia una revisión: el estado y su auditoría.
type ReviewChanges = Pick<
  Restaurant,
  'approvalStatus' | 'rejectionReason' | 'reviewedBy' | 'reviewedAt'
>;

// Aprobar o rechazar una solicitud (§11, "Administrador"). Solo desde pending.
//
// Cada revisión es UNA sentencia condicional (UPDATE ... WHERE id AND
// approval_status = 'pending'): la base decide quién gana. Dos administradores a
// la vez sobre la misma solicitud: el segundo espera el bloqueo de la fila, ya no
// la ve pendiente y no actualiza nada (409). Nada queda a medias. Como en
// RestaurantStatusService, basta con affected: no hace falta leer columnas de
// vuelta (el detalle se lee después).
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
    await this.review(restaurantId, {
      approvalStatus: APPROVED,
      rejectionReason: null,
      reviewedBy: adminId,
      reviewedAt: this.clock.now(),
    });
    this.events.emit(
      RESTAURANT_AVAILABILITY_AFFECTED,
      availabilityAffected(restaurantId),
    );
  }

  // Un rechazado nunca fue visible: no hay disponibilidad que avisar.
  async reject(
    adminId: string,
    restaurantId: string,
    reason: string,
  ): Promise<void> {
    await this.review(restaurantId, {
      approvalStatus: REJECTED,
      rejectionReason: reason,
      reviewedBy: adminId,
      reviewedAt: this.clock.now(),
    });
  }

  private async review(
    restaurantId: string,
    changes: ReviewChanges,
  ): Promise<void> {
    const { affected } = await this.restaurants.update(
      { id: restaurantId, approvalStatus: PENDING },
      changes,
    );
    if (affected === 1) {
      return;
    }
    // No cambió: o no existe, o ya no estaba pendiente.
    const exists = await this.restaurants.existsBy({ id: restaurantId });
    throw exists ? restaurantNotPending() : restaurantNotFound();
  }
}
