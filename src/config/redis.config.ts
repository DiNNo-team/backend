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
    console.error('Error de conexion a Redis', error);
  });

  return client;
}
