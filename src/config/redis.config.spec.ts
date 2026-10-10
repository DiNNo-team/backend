import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { closeRedisClient } from './redis.config.js';

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

describe('AppModule shutdown', () => {
  it('closes the Redis client when the application shuts down', async () => {
    const client = fakeClient('ready');
    const appModule = new AppModule(
      {} as DataSource,
      client as unknown as Redis,
    );

    await appModule.onApplicationShutdown();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });
});
