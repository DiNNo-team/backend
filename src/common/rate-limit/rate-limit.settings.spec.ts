import {
  RATE_LIMIT_RULES,
  RATE_LIMIT_TAGS,
  parseRateLimitEnabled,
  parseRateLimitFactor,
  parseTrustProxyHops,
  scaled,
} from './rate-limit.settings.js';

describe('rate limit settings', () => {
  it('is on by default and accepts only true or false', () => {
    expect(parseRateLimitEnabled(undefined)).toBe(true);
    expect(parseRateLimitEnabled('false')).toBe(false);
    expect(parseRateLimitEnabled(' true ')).toBe(true);
    for (const raw of ['', 'yes', '0', 'TRUE']) {
      expect(() => parseRateLimitEnabled(raw)).toThrow(/RATE_LIMIT_ENABLED/);
    }
  });

  it('multiplies by 1 by default and accepts whole numbers from 1 to 1000', () => {
    expect(parseRateLimitFactor(undefined)).toBe(1);
    expect(parseRateLimitFactor('50')).toBe(50);
    for (const raw of ['', '0', '1001', '2.5', '-1', 'diez']) {
      expect(() => parseRateLimitFactor(raw)).toThrow(/RATE_LIMIT_FACTOR/);
    }
  });

  it('trusts one proxy when deployed and none locally, unless told otherwise', () => {
    expect(parseTrustProxyHops(undefined, true)).toBe(1);
    expect(parseTrustProxyHops(undefined, false)).toBe(0);
    expect(parseTrustProxyHops('2', true)).toBe(2);
    expect(parseTrustProxyHops('0', true)).toBe(0);
    for (const raw of ['', '6', 'true']) {
      expect(() => parseTrustProxyHops(raw, true)).toThrow(/TRUST_PROXY_HOPS/);
    }
  });

  it('scales the limit but never the window', () => {
    expect(scaled({ limit: 10, ttlMs: 60_000 }, 3)).toEqual({
      limit: 30,
      ttlMs: 60_000,
    });
  });

  it('has a rule for every tag, and the per-IP limit is the loosest', () => {
    for (const tag of RATE_LIMIT_TAGS) {
      expect(RATE_LIMIT_RULES[tag].limit).toBeGreaterThan(0);
      expect(RATE_LIMIT_RULES[tag].limit).toBeLessThan(
        RATE_LIMIT_RULES.caller.limit,
      );
    }
    expect(RATE_LIMIT_RULES.ip.limit).toBeGreaterThan(
      RATE_LIMIT_RULES.caller.limit,
    );
  });
});
