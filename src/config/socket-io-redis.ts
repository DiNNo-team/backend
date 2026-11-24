import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT, closeRedisClient } from './redis.config.js';

// Socket.IO Redis adapter (Sprint 4, Azure with more than one replica): the
// rooms (diners, diner:{id}, restaurant:{id}) live in each process's memory,
// so an event emitted on one replica only reached the sockets connected to
// that replica. With the adapter, every emit is also published on Redis and
// the other replicas deliver it to their own sockets.

export type SocketIoAdapterConstructor = ReturnType<typeof createAdapter>;

const logger = new Logger('SocketIoRedis');

// Sin definir: true. Otro valor (también vacío) impide que la app arranque.
export function parseRealtimeRedisAdapterEnabled(
  raw: string | undefined,
): boolean {
  if (raw === undefined) {
    return true;
  }
  const text = raw.trim();
  if (text === 'true' || text === 'false') {
    return text === 'true';
  }
  throw new Error(
    'REALTIME_REDIS_ADAPTER_ENABLED debe ser true o false (o quitarla para usar true). Corrígela en la configuración del servicio.',
  );
}

// The adapter calls pubClient.publish(...) without handling its promise: if
// Redis is down and ioredis gives up, the rejection would be unhandled and
// Node would stop the process. This wrapper catches it, so a Redis failure
// only degrades real time to "this replica's sockets" (the local delivery
// happens anyway, right after the publish) and never brings the API down.
// One WARN when publishing starts failing and one LOG when it works again.
export function withSafePublish(client: Redis): Redis {
  let failing = false;
  const publish = (channel: string | Buffer, message: string | Buffer) =>
    client.publish(channel, message).then(
      (receivers) => {
        if (failing) {
          failing = false;
          logger.log(
            'Redis volvió: los eventos llegan otra vez a todas las réplicas.',
          );
        }
        return receivers;
      },
      (error: unknown) => {
        if (!failing) {
          failing = true;
          logger.warn(
            `No se pudo publicar en Redis (${error instanceof Error ? error.name : 'error'}); los eventos llegan solo a los clientes de esta réplica.`,
          );
        }
        return 0;
      },
    );
  return new Proxy(client, {
    get(target, property) {
      if (property === 'publish') {
        return publish;
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

function logErrors(client: Redis, label: string): Redis {
  client.on('error', (error: Error) => {
    logger.error(`Error de conexión a Redis (${label}): ${error.name}`);
  });
  return client;
}

// Two dedicated connections, duplicated from the app's one (same URL and
// TLS): a subscribed connection cannot run other commands, and the publisher
// does not queue while Redis is down (enableOfflineQueue: false), so a stale
// event is dropped instead of delivered minutes later. Closed on shutdown,
// after Nest has closed the Socket.IO server.
@Injectable()
export class SocketIoRedisAdapter implements OnApplicationShutdown {
  private readonly clients: { pub: Redis; sub: Redis } | null;

  constructor(@Inject(REDIS_CLIENT) redis: Redis, config: ConfigService) {
    const enabled = parseRealtimeRedisAdapterEnabled(
      config.get<string>('REALTIME_REDIS_ADAPTER_ENABLED'),
    );
    this.clients = enabled
      ? {
          pub: logErrors(
            redis.duplicate({ enableOfflineQueue: false }),
            'publicar',
          ),
          sub: logErrors(redis.duplicate(), 'suscribir'),
        }
      : null;
    logger.log(
      enabled
        ? 'Tiempo real con el adaptador de Redis: los eventos llegan a todas las réplicas.'
        : 'Adaptador de Redis de Socket.IO apagado (REALTIME_REDIS_ADAPTER_ENABLED=false): cada réplica entrega solo a sus clientes.',
    );
  }

  // null when it is turned off: Socket.IO keeps its in-memory adapter.
  adapter(): SocketIoAdapterConstructor | null {
    if (!this.clients) {
      return null;
    }
    return createAdapter(withSafePublish(this.clients.pub), this.clients.sub);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.clients) {
      await Promise.all([
        closeRedisClient(this.clients.pub),
        closeRedisClient(this.clients.sub),
      ]);
    }
  }
}
