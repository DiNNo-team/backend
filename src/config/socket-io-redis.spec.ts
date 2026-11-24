import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import {
  SocketIoRedisAdapter,
  parseRealtimeRedisAdapterEnabled,
  withSafePublish,
} from './socket-io-redis.js';

function configWith(value: string | undefined): ConfigService {
  return { get: () => value } as unknown as ConfigService;
}

function fakeClient() {
  return {
    status: 'ready',
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
  };
}

describe('parseRealtimeRedisAdapterEnabled', () => {
  it('is on by default', () => {
    expect(parseRealtimeRedisAdapterEnabled(undefined)).toBe(true);
  });

  it.each([
    ['true', true],
    ['false', false],
    [' false ', false],
  ])('reads %j', (raw, expected) => {
    expect(parseRealtimeRedisAdapterEnabled(raw)).toBe(expected);
  });

  it.each(['', 'yes', '1', 'TRUE'])(
    'rejects %j so the app does not start',
    (raw) => {
      expect(() => parseRealtimeRedisAdapterEnabled(raw)).toThrow(
        /REALTIME_REDIS_ADAPTER_ENABLED debe ser true o false/,
      );
    },
  );
});

describe('withSafePublish', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('passes a successful publish through', async () => {
    const client = { publish: vi.fn().mockResolvedValue(2) };
    const safe = withSafePublish(client as unknown as Redis);

    await expect(safe.publish('channel', 'message')).resolves.toBe(2);
    expect(client.publish).toHaveBeenCalledWith('channel', 'message');
  });

  it('turns a failed publish into 0, with one WARN while it keeps failing', async () => {
    const client = {
      publish: vi.fn().mockRejectedValue(new Error('Connection is closed.')),
    };
    const safe = withSafePublish(client as unknown as Redis);

    await expect(safe.publish('c', 'm')).resolves.toBe(0);
    await expect(safe.publish('c', 'm')).resolves.toBe(0);
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
  });

  it('leaves the other methods bound to the real client', () => {
    const client = {
      publish: vi.fn(),
      tag: 'real',
      whoAmI(this: { tag: string }) {
        return this.tag;
      },
    };
    const safe = withSafePublish(client as unknown as Redis) as unknown as {
      whoAmI: () => string;
    };
    expect(safe.whoAmI()).toBe('real');
  });
});

describe('SocketIoRedisAdapter', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens a publisher without offline queue and a subscriber, and closes both', async () => {
    const pub = fakeClient();
    const sub = fakeClient();
    const redis = {
      duplicate: vi.fn().mockReturnValueOnce(pub).mockReturnValueOnce(sub),
    };
    const provider = new SocketIoRedisAdapter(
      redis as unknown as Redis,
      configWith(undefined),
    );

    expect(redis.duplicate).toHaveBeenNthCalledWith(1, {
      enableOfflineQueue: false,
    });
    expect(redis.duplicate).toHaveBeenNthCalledWith(2);
    expect(provider.adapter()).toEqual(expect.any(Function));

    await provider.onApplicationShutdown();
    expect(pub.quit).toHaveBeenCalled();
    expect(sub.quit).toHaveBeenCalled();
  });

  it('turned off: no connections and the in-memory adapter', async () => {
    const redis = { duplicate: vi.fn() };
    const provider = new SocketIoRedisAdapter(
      redis as unknown as Redis,
      configWith('false'),
    );

    expect(redis.duplicate).not.toHaveBeenCalled();
    expect(provider.adapter()).toBeNull();
    await expect(provider.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('does not start with an invalid value', () => {
    expect(
      () =>
        new SocketIoRedisAdapter(
          { duplicate: vi.fn() } as unknown as Redis,
          configWith('si'),
        ),
    ).toThrow(/REALTIME_REDIS_ADAPTER_ENABLED/);
  });
});
