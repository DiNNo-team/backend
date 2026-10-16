import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

// Socket.IO with the same allowed origins as the HTTP API (CORS_ORIGINS):
// the gateway decorator only takes static options, so the origins are set
// here, from configuration. The native app does not use CORS.
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: false },
    } as ServerOptions) as Server;
  }
}
