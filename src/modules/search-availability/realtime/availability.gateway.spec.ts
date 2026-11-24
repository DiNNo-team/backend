import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import {
  type SocketAuthenticator,
  SocketRejection,
  UserRole,
} from '../../identity-access/index.js';
import { AvailabilityGateway } from './availability.gateway.js';
import { roomsFor } from './realtime-rooms.js';

type Middleware = (socket: Socket, next: (error?: Error) => void) => void;

const DINER = {
  userId: '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a',
  restaurantId: null,
  role: UserRole.DINER,
  restaurantApproval: null,
};
const OWNER = {
  userId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  restaurantId: '55bb0482-be1e-490b-9ba8-7533335d958b',
  role: UserRole.RESTAURANT_ADMIN,
  restaurantApproval: 'approved' as const,
};

function gatewayWith(authenticate: ReturnType<typeof vi.fn>) {
  return new AvailabilityGateway({
    authenticate,
  } as unknown as SocketAuthenticator);
}

// Registers the gateway middleware on a fake server and runs one handshake.
async function handshake(
  authenticate: ReturnType<typeof vi.fn>,
  auth: object,
  data: Record<string, unknown> = {},
) {
  let middleware: Middleware | undefined;
  const server = {
    use: (fn: Middleware) => {
      middleware = fn;
    },
  } as unknown as Server;
  gatewayWith(authenticate).afterInit(server);

  return new Promise<Error | undefined>((resolve) => {
    middleware?.({ handshake: { auth }, data } as unknown as Socket, resolve);
  });
}

describe('AvailabilityGateway handshake middleware', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets a diner through, passes it the handshake auth and keeps the user for the rooms', async () => {
    const authenticate = vi.fn().mockResolvedValue(DINER);
    const data: Record<string, unknown> = {};

    await expect(handshake(authenticate, { token: 't' }, data)).resolves.toBe(
      undefined,
    );
    expect(authenticate).toHaveBeenCalledWith({ token: 't' });
    expect(data.user).toEqual(DINER);
  });

  it.each([
    'UNAUTHORIZED',
    'EMAIL_NOT_VERIFIED',
    'PROFILE_REQUIRED',
    'RESTAURANT_REQUIRED',
  ] as const)('rejects with an Error whose message is %s', async (code) => {
    const error = await handshake(
      vi.fn().mockRejectedValue(new SocketRejection(code)),
      {},
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe(code);
  });

  it('answers SERVER_ERROR for an unexpected failure and logs only its type', async () => {
    const error = await handshake(
      vi.fn().mockRejectedValue(
        Object.assign(new Error('password=secret host=db'), {
          name: 'QueryFailedError',
        }),
      ),
      { token: 't' },
    );

    expect(error?.message).toBe('SERVER_ERROR');
    expect(warn).toHaveBeenCalledWith(
      'WebSocket handshake failed: QueryFailedError',
    );
  });
});

describe('Salas del WebSocket (§12.7)', () => {
  it('el comensal entra a diners y a la suya', () => {
    expect(roomsFor(DINER)).toEqual(['diners', `diner:${DINER.userId}`]);
  });

  it('el restaurante entra SOLO a la suya, nunca a diners', () => {
    expect(roomsFor(OWNER)).toEqual([`restaurant:${OWNER.restaurantId}`]);
  });

  it('un admin sin restaurante no entra a ninguna (el handshake ya lo rechaza)', () => {
    expect(roomsFor({ ...OWNER, restaurantId: null })).toEqual([]);
  });

  it.each([
    ['el comensal', DINER, ['diners', `diner:${DINER.userId}`]],
    ['el restaurante', OWNER, [`restaurant:${OWNER.restaurantId}`]],
  ])(
    'al conectar, %s queda en las salas que dice su usuario',
    async (_who, user, rooms) => {
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      const gateway = gatewayWith(vi.fn());
      (gateway as unknown as { server: unknown }).server = {
        of: () => ({ sockets: new Map() }),
      };
      const join = vi.fn(() => Promise.resolve());

      await gateway.handleConnection({
        data: { user },
        join,
      } as unknown as Socket);

      expect(join).toHaveBeenCalledWith(rooms);
      vi.restoreAllMocks();
    },
  );

  it('emitToRooms envía el evento a esas salas', () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const gateway = gatewayWith(vi.fn());
    (gateway as unknown as { server: unknown }).server = { to };

    gateway.emitToRooms(['restaurant:r', 'diner:d'], 'reservation.expired', {
      reservationId: 'x',
    });

    expect(to).toHaveBeenCalledWith(['restaurant:r', 'diner:d']);
    expect(emit).toHaveBeenCalledWith('reservation.expired', {
      reservationId: 'x',
    });
  });
});
