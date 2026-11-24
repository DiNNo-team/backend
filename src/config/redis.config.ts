import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('Redis');

export function createRedisClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl);

  client.on('connect', () => {
    logger.log('Redis conectado');
  });

  client.on('error', (error: Error) => {
    logger.error('Error de conexion a Redis', error.stack);
  });

  return client;
}

// On shutdown: quit waits for pending replies, but only a ready connection
// can answer it; otherwise (Redis down, still reconnecting) disconnect at
// once, so the shutdown never waits for a server that is not there.
export async function closeRedisClient(client: Redis): Promise<void> {
  if (client.status === 'ready') {
    await client.quit();
    return;
  }
  client.disconnect();
}
