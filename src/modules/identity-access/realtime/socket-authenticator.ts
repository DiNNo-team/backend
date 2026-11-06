import { Injectable, UnauthorizedException } from '@nestjs/common';
import { EMAIL_NOT_VERIFIED_CODE } from '../auth/auth-errors.js';
import type { CurrentUserData } from '../current-user/current-user-data.js';
import {
  CurrentUserResolver,
  type IdentityRequest,
} from '../current-user/current-user.resolver.js';
import { DEV_USER_HEADER } from '../current-user/dev-user.resolver.js';
import { UserRole } from '../roles/user-role.js';

// Codes of the WebSocket connect_error (CLAUDE.md §10 and §12.7): the client
// reads them in error.message. UNAUTHORIZED only exists here; in HTTP it is the
// 401 without errorCode. RESTAURANT_REQUIRED is the same code as the HTTP 403 of
// restaurant-operations (this module cannot import it; a test keeps them equal).
export const SOCKET_REJECTION_CODES = [
  'UNAUTHORIZED',
  'EMAIL_NOT_VERIFIED',
  'PROFILE_REQUIRED',
  'RESTAURANT_REQUIRED',
] as const;
export type SocketRejectionCode = (typeof SOCKET_REJECTION_CODES)[number];

// Rejection of a handshake: its message is only the code, never a detail.
export class SocketRejection extends Error {
  constructor(readonly code: SocketRejectionCode) {
    super(code);
    this.name = 'SocketRejection';
  }
}

// What the client sends in io(url, { auth }). devUserId only works locally:
// it becomes the x-dev-user-id header, which only DevUserResolver reads, and
// that resolver is never selected in a deployed environment.
interface HandshakeAuth {
  token?: unknown;
  devUserId?: unknown;
}

// Who connects to the WebSocket: a diner or a restaurant_admin with a restaurant
// (§12.7), with the same resolution as HTTP (Firebase, link by email, development
// user). It only translates the auth payload into headers and the outcome into a
// connect_error code. Errors that are not about the session (the database is
// down) propagate unchanged.
@Injectable()
export class SocketAuthenticator {
  constructor(private readonly resolver: CurrentUserResolver) {}

  async authenticate(auth: unknown): Promise<CurrentUserData> {
    let identity;
    try {
      identity = await this.resolver.resolve(toIdentityRequest(auth));
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new SocketRejection(
          error.errorCode === EMAIL_NOT_VERIFIED_CODE
            ? 'EMAIL_NOT_VERIFIED'
            : 'UNAUTHORIZED',
        );
      }
      throw error;
    }
    if (identity.kind === 'unregistered') {
      throw new SocketRejection('PROFILE_REQUIRED');
    }
    if (
      identity.user.role === UserRole.RESTAURANT_ADMIN &&
      identity.user.restaurantId === null
    ) {
      throw new SocketRejection('RESTAURANT_REQUIRED');
    }
    return identity.user;
  }
}

function toIdentityRequest(auth: unknown): IdentityRequest {
  const { token, devUserId } = (
    typeof auth === 'object' && auth !== null ? auth : {}
  ) as HandshakeAuth;
  const headers: IdentityRequest['headers'] = {};
  if (typeof token === 'string' && token !== '') {
    headers.authorization = `Bearer ${token}`;
  }
  if (typeof devUserId === 'string') {
    headers[DEV_USER_HEADER] = devUserId;
  }
  return { headers };
}
