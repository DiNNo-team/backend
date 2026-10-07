import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { CurrentUserData } from '../current-user/current-user-data.js';
import { CurrentUserResolver } from '../current-user/current-user.resolver.js';
import type { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import {
  FIREBASE_AUTH,
  type FirebaseAuthFactory,
} from './firebase-admin.provider.js';

const SESSION_EXPIRED_MESSAGE = 'Tu sesión terminó. Inicia sesión de nuevo.';
const CREATE_ROLE = 'restaurant_admin';

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  return candidate.code === '23505' || candidate.driverError?.code === '23505';
}

function toCurrentUser(user: User): CurrentUserData {
  return {
    userId: user.id,
    restaurantId: user.restaurantId,
    role: user.role,
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

@Injectable()
export class FirebaseUserResolver extends CurrentUserResolver {
  constructor(
    @Inject(FIREBASE_AUTH)
    private readonly getFirebaseAuth: FirebaseAuthFactory,
    private readonly usersService: UsersService,
  ) {
    super();
  }

  async resolve(request: Request): Promise<CurrentUserData> {
    const token = bearerToken(request);
    if (!token) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    let decodedToken: DecodedIdToken;
    const firebaseAuth = this.getFirebaseAuth();
    try {
      decodedToken = await firebaseAuth.verifyIdToken(token);
    } catch {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    if (!decodedToken.email) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    const userByUid = await this.usersService.findByFirebaseUid(
      decodedToken.uid,
    );
    if (userByUid) {
      return toCurrentUser(userByUid);
    }

    const userByEmail = await this.usersService.findByEmail(decodedToken.email);
    if (userByEmail) {
      if (
        decodedToken.email_verified !== true ||
        userByEmail.firebaseUid !== null
      ) {
        throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
      }
      return toCurrentUser(
        await this.usersService.linkFirebaseUid(userByEmail, decodedToken.uid),
      );
    }

    if (decodedToken.email_verified !== true) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    try {
      const user = await this.usersService.create({
        firebaseUid: decodedToken.uid,
        email: decodedToken.email,
        role: CREATE_ROLE,
        restaurantId: null,
      });
      return toCurrentUser(user);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const userAfterConflict = await this.usersService.findByFirebaseUid(
        decodedToken.uid,
      );
      if (!userAfterConflict) {
        throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
      }
      return toCurrentUser(userAfterConflict);
    }
  }
}
