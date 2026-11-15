import type { PushDevicesService } from '../devices/push-devices.service.js';
import type { PushSender } from '../push/push-sender.js';
import type { ReservationFactsReader } from './reservation-facts.reader.js';
import { ReservationNotificationsListener } from './reservation-notifications.listener.js';

const facts = {
  reservationId: 'r1',
  dinerId: 'diner-1',
  restaurantName: 'Casa 72',
  tableIdentifier: '04',
  expiresAt: new Date('2026-11-12T17:45:00Z'),
};
const ended = {
  reservationId: 'r1',
  restaurantId: 'rest-1',
  dinerId: 'diner-1',
  status: 'expired' as const,
  tableId: 't1',
  at: '2026-11-12T17:45:00Z',
};

function setup(overrides: {
  enabled?: boolean;
  send?: PushSender['send'];
  read?: ReservationFactsReader['read'];
}) {
  const sender = {
    enabled: overrides.enabled ?? true,
    send: vi.fn(
      overrides.send ?? (() => Promise.resolve({ sent: 1, invalidTokens: [] })),
    ),
  };
  const devices = {
    tokensOf: vi.fn().mockResolvedValue(['phone']),
    forget: vi.fn().mockResolvedValue(undefined),
  };
  const reader = {
    read: vi.fn(overrides.read ?? (() => Promise.resolve(facts))),
  };
  const listener = new ReservationNotificationsListener(
    sender as unknown as PushSender,
    devices as unknown as PushDevicesService,
    reader as unknown as ReservationFactsReader,
  );
  return { listener, sender, devices, reader };
}

describe('ReservationNotificationsListener', () => {
  it('sends the expiry to the phones of the diner of the reservation', async () => {
    const { listener, sender, devices } = setup({});

    await listener.onExpired(ended);

    expect(devices.tokensOf).toHaveBeenCalledWith('diner-1');
    expect(sender.send).toHaveBeenCalledWith(
      ['phone'],
      expect.objectContaining({ title: 'Tu reserva se venció' }),
    );
  });

  it('with notifications off it does not even read the database', async () => {
    const { listener, reader } = setup({ enabled: false });

    await listener.onCancelled({ ...ended, status: 'cancelled' });

    expect(reader.read).not.toHaveBeenCalled();
  });

  it('a failure of FCM is logged and never thrown: the reservation was already saved', async () => {
    const { listener } = setup({
      send: () => Promise.reject(new Error('FCM down')),
    });

    await expect(
      listener.onCheckedIn({ ...ended, status: 'completed' }),
    ).resolves.toBeUndefined();
  });

  it('a reservation that is no longer there sends nothing', async () => {
    const { listener, sender } = setup({ read: () => Promise.resolve(null) });

    await listener.onExpired(ended);

    expect(sender.send).not.toHaveBeenCalled();
  });
});
