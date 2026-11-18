import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { INSIGHTS_CACHE_PREFIX, RedisInsightsCache } from './insights-cache.js';

function redis(
  overrides: Partial<Record<'get' | 'set', unknown>> = {},
  status = 'ready',
) {
  return {
    status,
    get: vi.fn().mockResolvedValue('{"ok":true}'),
    set: vi.fn().mockResolvedValue('OK'),
    ...overrides,
  };
}

describe('RedisInsightsCache', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('lee y guarda con el prefijo y la expiración en segundos', async () => {
    const client = redis();
    const cache = new RedisInsightsCache(client as unknown as Redis);

    await expect(cache.get('r1:2026-11-17')).resolves.toBe('{"ok":true}');
    await cache.set('r1:2026-11-17', '{}', 3600);

    expect(client.get).toHaveBeenCalledWith(
      `${INSIGHTS_CACHE_PREFIX}r1:2026-11-17`,
    );
    expect(client.set).toHaveBeenCalledWith(
      `${INSIGHTS_CACHE_PREFIX}r1:2026-11-17`,
      '{}',
      'EX',
      3600,
    );
  });

  it('con Redis sin conexión no lo usa y sigue sin caché', async () => {
    const client = redis({}, 'reconnecting');
    const cache = new RedisInsightsCache(client as unknown as Redis);

    await expect(cache.get('k')).resolves.toBeNull();
    await expect(cache.set('k', '{}', 60)).resolves.toBeUndefined();
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  it('si Redis falla, avisa y sigue sin caché', async () => {
    const client = redis({
      get: vi.fn().mockRejectedValue(new Error('caído')),
      set: vi.fn().mockRejectedValue(new Error('caído')),
    });
    const cache = new RedisInsightsCache(client as unknown as Redis);

    await expect(cache.get('k')).resolves.toBeNull();
    await expect(cache.set('k', '{}', 60)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('si Redis tarda más de 250 ms, no lo espera', async () => {
    vi.useFakeTimers();
    const client = redis({ get: vi.fn(() => new Promise(() => {})) });
    const cache = new RedisInsightsCache(client as unknown as Redis);

    const result = cache.get('k');
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toBeNull();
  });
});
