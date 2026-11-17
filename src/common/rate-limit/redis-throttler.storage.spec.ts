import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  RATE_LIMIT_KEY_PREFIX,
  RedisThrottlerStorage,
} from './redis-throttler.storage.js';

function fakeRedis(status: string, evalImpl?: () => Promise<unknown>) {
  return {
    status,
    eval: vi.fn(evalImpl ?? (() => Promise.resolve([1, 60_000]))),
  };
}

function storageWith(redis: ReturnType<typeof fakeRedis>) {
  return new RedisThrottlerStorage(redis as unknown as Redis);
}

describe('RedisThrottlerStorage', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;
  const storages: RedisThrottlerStorage[] = [];

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    storages.splice(0).forEach((storage) => storage.onApplicationShutdown());
    vi.restoreAllMocks();
  });

  function track(storage: RedisThrottlerStorage) {
    storages.push(storage);
    return storage;
  }

  it('counts in Redis with one script per hit, in seconds', async () => {
    const redis = fakeRedis('ready', () => Promise.resolve([3, 41_200]));
    const storage = track(storageWith(redis));

    const record = await storage.increment(
      'caller:user:a',
      60_000,
      5,
      60_000,
      'caller',
    );

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      1,
      `${RATE_LIMIT_KEY_PREFIX}caller:user:a`,
      60_000,
    );
    expect(record).toEqual({
      totalHits: 3,
      timeToExpire: 42,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('blocks once the hits pass the limit, until the window ends', async () => {
    const storage = track(
      storageWith(fakeRedis('ready', () => Promise.resolve([6, 9_000]))),
    );

    const record = await storage.increment('k', 60_000, 5, 60_000, 'caller');

    expect(record.isBlocked).toBe(true);
    expect(record.timeToBlockExpire).toBe(9);
  });

  it('counts in memory while Redis is not connected', async () => {
    const redis = fakeRedis('reconnecting');
    const storage = track(storageWith(redis));

    const first = await storage.increment('k', 60_000, 1, 60_000, 'caller');
    const second = await storage.increment('k', 60_000, 1, 60_000, 'caller');

    expect(redis.eval).not.toHaveBeenCalled();
    expect(first.isBlocked).toBe(false);
    expect(second.isBlocked).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not wait for a Redis that does not answer', async () => {
    const storage = track(
      storageWith(fakeRedis('ready', () => new Promise(() => {}))),
    );
    const started = Date.now();

    const record = await storage.increment('k', 60_000, 5, 60_000, 'caller');

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(record.totalHits).toBe(1);
  });

  it('falls back on an error or an odd reply, and says when Redis is back', async () => {
    const replies: Array<() => Promise<unknown>> = [
      () => Promise.reject(new Error('READONLY')),
      () => Promise.resolve('OK'),
      () => Promise.resolve([1, 60_000]),
    ];
    const redis = fakeRedis('ready', () => replies.shift()!());
    const storage = track(storageWith(redis));

    await storage.increment('k', 60_000, 5, 60_000, 'caller');
    await storage.increment('k', 60_000, 5, 60_000, 'caller');
    await storage.increment('k', 60_000, 5, 60_000, 'caller');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
