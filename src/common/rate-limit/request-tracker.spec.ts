import {
  bearerSubject,
  callerTracker,
  clientIp,
  ipTracker,
} from './request-tracker.js';

function token(claims: unknown): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.firma`;
}

describe('request tracker', () => {
  it('reads the sub of a bearer token without verifying it', () => {
    expect(bearerSubject(`Bearer ${token({ sub: 'uid-1' })}`)).toBe('uid-1');
    expect(bearerSubject(`bearer ${token({ sub: 'uid-1' })}`)).toBe('uid-1');
  });

  it.each([
    ['no header', undefined],
    ['another scheme', `Basic ${token({ sub: 'uid-1' })}`],
    ['not a JWT', 'Bearer abc'],
    ['payload that is not JSON', 'Bearer a.bm8tanNvbg.c'],
    ['no sub', `Bearer ${token({ uid: 'uid-1' })}`],
    ['empty sub', `Bearer ${token({ sub: '' })}`],
    ['sub that is not text', `Bearer ${token({ sub: 42 })}`],
    ['sub too long', `Bearer ${token({ sub: 'x'.repeat(129) })}`],
    ['payload that is null', `Bearer ${token(null)}`],
  ])('has no subject with %s', (_case, header) => {
    expect(bearerSubject(header)).toBeNull();
  });

  it('counts a request with a session by account and one without by IP', () => {
    const headers = { authorization: `Bearer ${token({ sub: 'uid-1' })}` };
    expect(callerTracker(headers, '10.0.0.1')).toBe('user:uid-1');
    expect(callerTracker({}, '10.0.0.1')).toBe('ip:10.0.0.1');
  });

  it('treats an IPv4 address seen through IPv6 as the same client', () => {
    expect(ipTracker('::ffff:10.0.0.1')).toBe('ip:10.0.0.1');
    expect(ipTracker('2001:db8::1')).toBe('ip:2001:db8::1');
  });

  it('finds the client behind the trusted proxies, like Express', () => {
    // Without proxies: the socket address, whatever the header says.
    expect(clientIp('10.0.0.9', '1.2.3.4', 0)).toBe('10.0.0.9');
    // One proxy (the ingress): the address it appended, the last one.
    expect(clientIp('10.0.0.9', 'falso, 200.1.1.1', 1)).toBe('200.1.1.1');
    expect(clientIp('10.0.0.9', ['falso', '200.1.1.1'], 1)).toBe('200.1.1.1');
    // A shorter chain than the hops: the farthest address.
    expect(clientIp('10.0.0.9', '200.1.1.1', 3)).toBe('200.1.1.1');
    expect(clientIp('10.0.0.9', undefined, 1)).toBe('10.0.0.9');
    expect(clientIp(undefined, undefined, 0)).toBe('unknown');
  });
});
