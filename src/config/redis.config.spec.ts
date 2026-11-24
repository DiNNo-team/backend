import type { Redis } from 'ioredis';
import { closeRedisClient } from './redis.config.js';
import { RedisModule } from './redis.module.js';

function fakeClient(status: string) {
  return {
    status,
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
  };
}

describe('closeRedisClient', () => {
  it('quits a ready connection, waiting for pending replies', async () => {
    const client = fakeClient('ready');

    await closeRedisClient(client as unknown as Redis);

    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it.each(['connecting', 'reconnecting', 'end'])(
    'disconnects at once when the connection is %s',
    async (status) => {
      const client = fakeClient(status);

      await closeRedisClient(client as unknown as Redis);

      expect(client.disconnect).toHaveBeenCalledTimes(1);
      expect(client.quit).not.toHaveBeenCalled();
    },
  );
});

describe('RedisModule shutdown', () => {
  it('closes the Redis client when the application shuts down', async () => {
    const client = fakeClient('ready');
    const redisModule = new RedisModule(client as unknown as Redis);

    await redisModule.onApplicationShutdown();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });
});
