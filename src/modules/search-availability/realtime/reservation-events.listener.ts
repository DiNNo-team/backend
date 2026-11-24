import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TABLE_STATUS_CHANGED,
  type TableStatusChangedEvent,
} from '../../restaurant-operations/index.js';
import { AvailabilityGateway } from './availability.gateway.js';
import { dinerRoom, restaurantRoom } from './realtime-rooms.js';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CHECKED_IN,
  RESERVATION_CREATED,
  RESERVATION_EXPIRED,
  type ReservationCreatedEvent,
  type ReservationEndedEvent,
} from './reservation-events.js';

// El nombre del evento en el socket (§12.8): el interno sigue la convención de
// RESTAURANT_AVAILABILITY_AFFECTED y no se expone.
export const TABLE_STATUS_CHANGED_SOCKET_EVENT = 'table.status_changed';

// Traduce los eventos internos a emits del socket: elige las salas y deja solo
// los campos del contrato (§12.8). Es síncrono porque no lee la base, y así
// conserva el orden de publicación. Un fallo del socket se registra: la operación
// ya se confirmó y los clientes se recuperan consultando (§12.7).
@Injectable()
export class ReservationEventsListener {
  private readonly logger = new Logger(ReservationEventsListener.name);

  constructor(private readonly gateway: AvailabilityGateway) {}

  @OnEvent(RESERVATION_CREATED)
  onCreated({ restaurantId, reservation }: ReservationCreatedEvent): void {
    this.send([restaurantRoom(restaurantId)], RESERVATION_CREATED, reservation);
  }

  @OnEvent(RESERVATION_CANCELLED)
  onCancelled(event: ReservationEndedEvent): void {
    this.sendEnded(RESERVATION_CANCELLED, event);
  }

  @OnEvent(RESERVATION_EXPIRED)
  onExpired(event: ReservationEndedEvent): void {
    this.sendEnded(RESERVATION_EXPIRED, event);
  }

  @OnEvent(RESERVATION_CHECKED_IN)
  onCheckedIn(event: ReservationEndedEvent): void {
    this.sendEnded(RESERVATION_CHECKED_IN, event);
  }

  @OnEvent(TABLE_STATUS_CHANGED)
  onTableStatusChanged({
    restaurantId,
    tableId,
    previousStatus,
    status,
    source,
  }: TableStatusChangedEvent): void {
    this.send(
      [restaurantRoom(restaurantId)],
      TABLE_STATUS_CHANGED_SOCKET_EVENT,
      { tableId, previousStatus, status, source },
    );
  }

  private sendEnded(
    name: string,
    {
      restaurantId,
      dinerId,
      reservationId,
      status,
      tableId,
      at,
    }: ReservationEndedEvent,
  ): void {
    this.send([restaurantRoom(restaurantId), dinerRoom(dinerId)], name, {
      reservationId,
      status,
      tableId,
      at,
    });
  }

  private send(rooms: string[], name: string, payload: object): void {
    try {
      this.gateway.emitToRooms(rooms, name, payload);
    } catch (error) {
      // Solo el tipo de error: las salas llevan ids de usuarios.
      this.logger.error(
        `No se pudo enviar ${name} por el WebSocket: ${error instanceof Error ? error.name : 'error desconocido'}`,
      );
    }
  }
}
