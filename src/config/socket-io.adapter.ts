import { type INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';
import {
  SOCKET_RATE_LIMITED,
  type SocketConnectionLimiter,
} from '../common/rate-limit/socket-connection-limiter.js';

const rateLimitLogger = new Logger('RateLimit');

// Socket.IO with the same allowed origins as the HTTP API (CORS_ORIGINS):
// the gateway decorator only takes static options, so the origins are set
// here, from configuration. The native app does not use CORS.
//
// With a limiter, every new connection passes it first (Sprint 4, task 6.1.3):
// its middleware is registered here, before the gateway's handshake one, so a
// flood of connections is rejected before any token is verified.
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
    private readonly limiter?: SocketConnectionLimiter,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: false },
    } as ServerOptions) as Server;
    const limiter = this.limiter;
    if (limiter) {
      server.use((socket, next) => {
        limiter
          .allows(socket.handshake)
          .then((allowed) =>
            allowed ? next() : next(new Error(SOCKET_RATE_LIMITED)),
          )
          .catch((error: unknown) => {
            // The limit never blocks real time: if it fails, the socket goes on.
            rateLimitLogger.warn(
              `El límite de conexiones falló (${error instanceof Error ? error.name : 'error'}); la conexión sigue.`,
            );
            next();
          });
      });
    }
    return server;
  }
}
