import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export function createRedisClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl);

  client.on('connect', () => {
    console.log('Redis conectado');
  });

  client.on('error', (error: Error) => {
    console.error('Error de conexion a Redis', error);
  });

  return client;
}
