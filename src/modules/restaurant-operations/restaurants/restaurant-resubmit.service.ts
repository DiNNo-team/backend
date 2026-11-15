import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Clock } from '../../../common/time/clock.js';
import { PENDING, REJECTED } from '../../identity-access/index.js';
import { requireRestaurant } from '../shared/restaurant-required.js';
import { Restaurant } from './restaurant.entity.js';

// 409 de reenviar una solicitud que no está rechazada (pendiente o aprobada).
export const RESTAURANT_NOT_REJECTED_CODE = 'RESTAURANT_NOT_REJECTED';
export const RESTAURANT_NOT_REJECTED_MESSAGE =
  'Tu solicitud no está rechazada.';

export function restaurantNotRejected(): ConflictException {
  return new ConflictException(RESTAURANT_NOT_REJECTED_MESSAGE, {
    errorCode: RESTAURANT_NOT_REJECTED_CODE,
  });
}

// Reenvío de una solicitud rechazada (CLAUDE.md §11, "Aprobación de
// restaurantes"): rejected → pending, sin motivo ni revisión, con submitted_at
// = ahora (vuelve al final de la fila de pendientes del administrador).
//
// Una sola sentencia condicional (WHERE id AND approval_status = 'rejected'):
// dos reenvíos a la vez, o un reenvío contra cualquier otro cambio de estado, no
// se pisan; el segundo espera el bloqueo de la fila, ya no la ve rechazada y
// recibe 409. No emite disponibilidad: un pendiente sigue sin ser visible.
@Injectable()
export class RestaurantResubmitService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    private readonly clock: Clock,
  ) {}

  async resubmit(restaurantId: string | null): Promise<void> {
    const id = requireRestaurant(restaurantId);
    const { affected } = await this.restaurants.update(
      { id, approvalStatus: REJECTED },
      {
        approvalStatus: PENDING,
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        submittedAt: this.clock.now(),
      },
    );
    if (affected !== 1) {
      throw restaurantNotRejected();
    }
  }
}
