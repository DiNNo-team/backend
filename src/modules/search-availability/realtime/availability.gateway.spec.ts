import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import {
  type DinerSocketAuthenticator,
  SocketRejection,
  UserRole,
} from '../../identity-access/index.js';
import { AvailabilityGateway } from './availability.gateway.js';

type Middleware = (socket: Socket, next: (error?: Error) => void) => void;

// Registers the gateway middleware on a fake server and runs one handshake.
async function handshake(authenticate: ReturnType<typeof vi.fn>, auth: object) {
  let middleware: Middleware | undefined;
  const server = {
    use: (fn: Middleware) => {
      middleware = fn;
    },
  } as unknown as Server;
  const gateway = new AvailabilityGateway({
    authenticate,
  } as unknown as DinerSocketAuthenticator);
  gateway.afterInit(server);

  return new Promise<Error | undefined>((resolve) => {
    middleware?.({ handshake: { auth } } as unknown as Socket, resolve);
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

  it('lets a diner through and passes it the handshake auth', async () => {
    const authenticate = vi.fn().mockResolvedValue({
      userId: '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a',
      restaurantId: null,
      role: UserRole.DINER,
    });

    await expect(handshake(authenticate, { token: 't' })).resolves.toBe(
      undefined,
    );
    expect(authenticate).toHaveBeenCalledWith({ token: 't' });
  });

  it.each([
    'UNAUTHORIZED',
    'EMAIL_NOT_VERIFIED',
    'PROFILE_REQUIRED',
    'RESTAURANT_ACCOUNT',
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
