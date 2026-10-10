import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { CurrentUserData } from '../current-user/current-user-data.js';
import { CurrentUserResolver } from '../current-user/current-user.resolver.js';
import { isUniqueViolation } from '../users/unique-violation.js';
import type { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import {
  FIREBASE_AUTH,
  type FirebaseAuthFactory,
} from './firebase-admin.provider.js';

const SESSION_EXPIRED_MESSAGE = 'Tu sesión terminó. Inicia sesión de nuevo.';
const EMAIL_NOT_VERIFIED_MESSAGE = 'Verifica tu correo para continuar.';
const CREATE_ROLE = 'restaurant_admin';

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

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'sin código';
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

  async resolve(request: Request): Promise<CurrentUserData> {
    const token = bearerToken(request);
    if (!token) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    let decodedToken: DecodedIdToken;
    const firebaseAuth = this.getFirebaseAuth();
    try {
      decodedToken = await firebaseAuth.verifyIdToken(token);
    } catch (error) {
      // Only the code (e.g. auth/id-token-expired): it tells an expired session
      // from a wrong FIREBASE_PROJECT_ID. Never the token or the full message.
      this.logger.warn(`verifyIdToken rechazó el token: ${errorCode(error)}`);
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

    if (decodedToken.email_verified !== true) {
      throw new UnauthorizedException(EMAIL_NOT_VERIFIED_MESSAGE, {
        errorCode: 'EMAIL_NOT_VERIFIED',
      });
    }

    const userByEmail = await this.usersService.findByEmail(decodedToken.email);
    if (userByEmail) {
      if (userByEmail.firebaseUid !== null) {
        throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
      }
      return toCurrentUser(
        await this.usersService.linkFirebaseUid(userByEmail, decodedToken.uid),
      );
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
