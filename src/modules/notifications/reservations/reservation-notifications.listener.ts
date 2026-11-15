import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CHECKED_IN,
  RESERVATION_CREATED,
  RESERVATION_EXPIRED,
  type ReservationCreatedEvent,
  type ReservationEndedEvent,
} from '../../search-availability/index.js';
import { PushDevicesService } from '../devices/push-devices.service.js';
import { PushSender } from '../push/push-sender.js';
import { ReservationFactsReader } from './reservation-facts.reader.js';
import {
  reservationMessage,
  type ReservationNotificationType,
} from './reservation-messages.js';

/**
 * Turns the reservation events into push notifications for the diner (Sprint 4,
 * PBI 1.1). Decoupled from the reservations: it listens to the same internal
 * events as the WebSocket, published once after the commit, so each event gives
 * at most one notification per phone (a reservation only leaves `active` once).
 * Asynchronous and never throws: a failure here never touches the reservation,
 * whose response was already sent.
 */
@Injectable()
export class ReservationNotificationsListener {
  private readonly logger = new Logger(ReservationNotificationsListener.name);

  constructor(
    private readonly sender: PushSender,
    private readonly devices: PushDevicesService,
    private readonly facts: ReservationFactsReader,
  ) {}

  @OnEvent(RESERVATION_CREATED, { async: true })
  onCreated({ reservation }: ReservationCreatedEvent): Promise<void> {
    return this.notify('created', reservation.id);
  }

  @OnEvent(RESERVATION_CANCELLED, { async: true })
  onCancelled({ reservationId }: ReservationEndedEvent): Promise<void> {
    return this.notify('cancelled', reservationId);
  }

  @OnEvent(RESERVATION_EXPIRED, { async: true })
  onExpired({ reservationId }: ReservationEndedEvent): Promise<void> {
    return this.notify('expired', reservationId);
  }

  @OnEvent(RESERVATION_CHECKED_IN, { async: true })
  onCheckedIn({ reservationId }: ReservationEndedEvent): Promise<void> {
    return this.notify('checked_in', reservationId);
  }

  private async notify(
    type: ReservationNotificationType,
    reservationId: string,
  ): Promise<void> {
    if (!this.sender.enabled) return;
    try {
      const facts = await this.facts.read(reservationId);
      if (!facts) return;
      const tokens = await this.devices.tokensOf(facts.dinerId);
      if (tokens.length === 0) return;
      const result = await this.sender.send(
        tokens,
        reservationMessage(type, facts),
      );
      await this.devices.forget(result.invalidTokens);
    } catch (error) {
      // Only the type of the error: tokens and ids of people stay out of the log.
      this.logger.warn(
        `No se pudo enviar la notificación ${type}: ${error instanceof Error ? error.name : 'error desconocido'}`,
      );
    }
  }
}
