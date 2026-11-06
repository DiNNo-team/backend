import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  type CurrentUserData,
  SocketAuthenticator,
  SocketRejection,
} from '../../identity-access/index.js';
import {
  AVAILABILITY_CHANGED_EVENT,
  type AvailabilityChangedPayload,
  DINERS_ROOM,
} from './availability-changed.js';
import { roomsFor } from './realtime-rooms.js';

// Code for a handshake that failed for a reason other than the session (the
// database is down). Part of the contract (CLAUDE.md, section 10, "Tiempo
// real"): Socket.IO does not retry a rejected handshake, so the app retries
// it with a growing wait (5 s, 15 s, 30 s) and meanwhile keeps polling every
// 60 s.
export const SOCKET_SERVER_ERROR = 'SERVER_ERROR';

// Socket.IO on the same host and port as the API (path /socket.io; CORS from
// CORS_ORIGINS, set by the adapter in app.setup.ts). It only authenticates,
// assigns the rooms and sends: the listeners decide what goes where.
@WebSocketGateway()
export class AvailabilityGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AvailabilityGateway.name);

  @WebSocketServer()
  private readonly server: Server;

  constructor(private readonly authenticator: SocketAuthenticator) {}

  // Handshake middleware: a rejected client gets connect_error with the code
  // in error.message and is never connected.
  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.authenticator.authenticate(socket.handshake.auth).then(
        (user) => {
          (socket.data as { user?: CurrentUserData }).user = user;
          next();
        },
        (error: unknown) => next(this.rejection(error)),
      );
    });
  }

  // Las salas salen del usuario del handshake: el cliente no elige ninguna.
  async handleConnection(socket: Socket): Promise<void> {
    const { user } = socket.data as { user: CurrentUserData };
    await socket.join(roomsFor(user));
    this.logger.log(`Client connected (${this.connectedCount()} connected)`);
  }

  handleDisconnect(): void {
    this.logger.log(`Client disconnected (${this.connectedCount()} connected)`);
  }

  broadcast(payload: AvailabilityChangedPayload): void {
    this.server.to(DINERS_ROOM).emit(AVAILABILITY_CHANGED_EVENT, payload);
  }

  emitToRooms(rooms: string[], event: string, payload: object): void {
    this.server.to(rooms).emit(event, payload);
  }

  private connectedCount(): number {
    return this.server.of('/').sockets.size;
  }

  private rejection(error: unknown): Error {
    if (error instanceof SocketRejection) {
      return new Error(error.code);
    }
    // Only the error type: the message could carry connection details.
    this.logger.warn(
      `WebSocket handshake failed: ${error instanceof Error ? error.name : 'unknown error'}`,
    );
    return new Error(SOCKET_SERVER_ERROR);
  }
}
