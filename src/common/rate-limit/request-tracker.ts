import type { IncomingHttpHeaders } from 'node:http';

// Who a request counts against. With a session, the account (the `sub` of the
// Firebase token): in a network with NAT (the university) everyone shares one
// IP, and a per-IP limit would block the whole room. Without a session, the IP.
//
// The token is only decoded here, not verified: the limit runs before
// CurrentUserGuard so it is cheap. Someone who invents a different `sub` on
// every request gets a 401 from the guard anyway, and the per-IP limit still
// counts those requests.
export function callerTracker(
  headers: IncomingHttpHeaders,
  ip: string,
): string {
  const subject = bearerSubject(headers.authorization);
  return subject === null ? ipTracker(ip) : `user:${subject}`;
}

export function ipTracker(ip: string): string {
  return `ip:${normalizeIp(ip)}`;
}

// An IPv4 address seen through an IPv6 socket ("::ffff:10.0.0.1") is the same
// client as "10.0.0.1".
export function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

const MAX_SUBJECT_LENGTH = 128;

export function bearerSubject(
  authorization: string | undefined,
): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (!match) {
    return null;
  }
  const payload = match[1].split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    const sub =
      typeof claims === 'object' && claims !== null
        ? (claims as { sub?: unknown }).sub
        : undefined;
    return typeof sub === 'string' &&
      sub.length > 0 &&
      sub.length <= MAX_SUBJECT_LENGTH
      ? sub
      : null;
  } catch {
    // Not a JWT: the request counts by IP, and the guard answers the 401.
    return null;
  }
}

// The client IP behind `hops` proxies, the same rule as Express's numeric
// `trust proxy`: the addresses are [socket, ...X-Forwarded-For from right to
// left] and the client is the one `hops` positions in (or the last one, if the
// chain is shorter). The WebSocket handshake needs it because Socket.IO does
// not apply Express's setting.
export function clientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  hops: number,
): string {
  const header = Array.isArray(forwardedFor)
    ? forwardedFor.join(',')
    : (forwardedFor ?? '');
  const forwarded = header
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
    .reverse();
  const chain = [remoteAddress ?? 'unknown', ...forwarded];
  return chain[Math.min(hops, chain.length - 1)];
}
