import {
  reservationMessage,
  type ReservationFacts,
  type ReservationNotificationType,
} from './reservation-messages.js';

const facts: ReservationFacts = {
  reservationId: 'reservation-1',
  dinerId: 'diner-1',
  restaurantName: 'Casa 72',
  tableIdentifier: '4',
  // 12:45 in Bogotá.
  expiresAt: new Date('2026-11-12T17:45:00Z'),
};

describe('reservationMessage', () => {
  it.each<[ReservationNotificationType, string, string]>([
    [
      'created',
      'Mesa reservada en Casa 72',
      'Te guardamos la Mesa 04 hasta las 12:45. Muestra tu código al llegar.',
    ],
    ['cancelled', 'Cancelaste tu reserva', 'La mesa en Casa 72 quedó libre.'],
    [
      'expired',
      'Tu reserva se venció',
      'Ya no tenemos tu mesa en Casa 72. Busca otra mesa cerca de ti.',
    ],
    [
      'checked_in',
      'Check-in confirmado',
      'Tu Mesa 04 en Casa 72 te espera. Buen provecho.',
    ],
  ])('%s → «%s»', (type, title, body) => {
    expect(reservationMessage(type, facts)).toEqual({
      title,
      body,
      data: { type, reservationId: 'reservation-1' },
    });
  });

  it('formats the table like the rest of the product ("Mesa 4" → "Mesa 04")', () => {
    const message = reservationMessage('created', {
      ...facts,
      tableIdentifier: 'Mesa 4',
    });
    expect(message.body).toContain('la Mesa 04 ');
  });
});
