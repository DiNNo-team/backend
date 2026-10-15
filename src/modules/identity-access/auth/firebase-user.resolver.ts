import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { RequestIdentity } from '../current-user/current-user-data.js';
import { CurrentUserResolver } from '../current-user/current-user.resolver.js';
import type { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { emailNotVerified, sessionExpired } from './auth-errors.js';
import {
  FIREBASE_AUTH,
  type FirebaseAuthFactory,
} from './firebase-admin.provider.js';

function registered(user: User): RequestIdentity {
  return {
    kind: 'registered',
    user: {
      userId: user.id,
      restaurantId: user.restaurantId,
      role: user.role,
    },
  };
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') {
    return null;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'sin código';
}

function tokenName(token: DecodedIdToken): string | null {
  const name: unknown = token.name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
}

@Injectable()
export class FirebaseUserResolver extends CurrentUserResolver {
  private readonly logger = new Logger(FirebaseUserResolver.name);

  constructor(
    @Inject(FIREBASE_AUTH)
    private readonly getFirebaseAuth: FirebaseAuthFactory,
    private readonly usersService: UsersService,
  ) {
    super();
  }

  // Never creates a user (Sprint 2): an account without a users row resolves
  // to an unregistered identity. Only POST /v1/diners/me creates users.
  async resolve(request: Request): Promise<RequestIdentity> {
    const token = bearerToken(request);
    if (!token) {
      throw sessionExpired();
    }

    let decodedToken: DecodedIdToken;
    const firebaseAuth = this.getFirebaseAuth();
    try {
      decodedToken = await firebaseAuth.verifyIdToken(token);
    } catch (error) {
      // Only the code (e.g. auth/id-token-expired): it tells an expired session
      // from a wrong FIREBASE_PROJECT_ID. Never the token or the full message.
      this.logger.warn(`verifyIdToken rechazó el token: ${errorCode(error)}`);
      throw sessionExpired();
    }

    if (!decodedToken.email) {
      throw sessionExpired();
    }

    const userByUid = await this.usersService.findByFirebaseUid(
      decodedToken.uid,
    );
    if (userByUid) {
      return registered(userByUid);
    }

    if (decodedToken.email_verified !== true) {
      throw emailNotVerified();
    }

    const userByEmail = await this.usersService.findByEmail(decodedToken.email);
    if (userByEmail) {
      if (userByEmail.firebaseUid !== null) {
        // Typically a Firebase account deleted and created again: support
        // must unlink it (docs/database.md). No email, UID or token here.
        this.logger.warn(
          'Firebase account rejected: email already linked to another UID',
        );
        throw sessionExpired();
      }
      return registered(
        await this.usersService.linkFirebaseUid(userByEmail, decodedToken.uid),
      );
    }

    return {
      kind: 'unregistered',
      firebase: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: tokenName(decodedToken),
        emailVerified: true,
      },
    };
  }
}
