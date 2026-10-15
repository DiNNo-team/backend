import { Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { User } from '../users/user.entity.js';
import type { UsersService } from '../users/users.service.js';
import type { FirebaseAuthFactory } from './firebase-admin.provider.js';
import { FirebaseUserResolver } from './firebase-user.resolver.js';
import { UserRole } from '../roles/user-role.js';

const SESSION_EXPIRED_MESSAGE = 'Tu sesión terminó. Inicia sesión de nuevo.';
const EMAIL_NOT_VERIFIED_MESSAGE = 'Verifica tu correo para continuar.';
const FIREBASE_UID = 'firebase-uid';
const EMAIL = 'owner@example.com';
const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function decodedToken(overrides: Partial<DecodedIdToken> = {}): DecodedIdToken {
  return {
    uid: FIREBASE_UID,
    email: EMAIL,
    email_verified: true,
    ...overrides,
  } as DecodedIdToken;
}

function requestWith(authorization?: string | string[]): Request {
  return {
    headers: authorization === undefined ? {} : { authorization },
  } as unknown as Request;
}

function createResolver() {
  const auth = { verifyIdToken: vi.fn() };
  const firebaseAuthFactory = vi.fn(
    () => auth,
  ) as unknown as FirebaseAuthFactory;
  const usersService = {
    findByFirebaseUid: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    linkFirebaseUid: vi.fn(),
    create: vi.fn(),
  };
  const resolver = new FirebaseUserResolver(
    firebaseAuthFactory,
    usersService as unknown as UsersService,
  );
  return { auth, firebaseAuthFactory, resolver, usersService };
}

async function expectUnauthorized(
  promise: Promise<unknown>,
  message: string,
  errorCode?: string,
): Promise<void> {
  let caughtError: unknown;
  try {
    await promise;
  } catch (error) {
    caughtError = error;
  }

  expect(caughtError).toBeInstanceOf(UnauthorizedException);
  expect((caughtError as UnauthorizedException).getResponse()).toEqual({
    statusCode: 401,
    message,
    error: 'Unauthorized',
    ...(errorCode ? { errorCode } : {}),
  });
}

describe('FirebaseUserResolver', () => {
  beforeEach(() => vi.resetAllMocks());

  it('resolves an existing user by Firebase UID from a valid token', async () => {
    const { auth, resolver, usersService } = createResolver();
    const user = {
      id: USER_ID,
      firebaseUid: FIREBASE_UID,
      email: EMAIL,
      role: UserRole.RESTAURANT_ADMIN,
      restaurantId: null,
    } as User;
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.findByFirebaseUid.mockResolvedValue(user);

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).resolves.toEqual({
      kind: 'registered',
      user: {
        userId: USER_ID,
        restaurantId: null,
        role: UserRole.RESTAURANT_ADMIN,
      },
    });
    expect(auth.verifyIdToken).toHaveBeenCalledWith('valid-token');
    expect(usersService.findByEmail).not.toHaveBeenCalled();
  });

  it('rejects an invalid Firebase token with the standard 401 message', async () => {
    const { auth, resolver, usersService } = createResolver();
    auth.verifyIdToken.mockRejectedValue(new Error('private SDK detail'));

    await expectUnauthorized(
      resolver.resolve(requestWith('Bearer invalid-token')),
      SESSION_EXPIRED_MESSAGE,
    );
    expect(usersService.findByFirebaseUid).not.toHaveBeenCalled();
  });

  it('logs only the Firebase error code, never the token or the message', async () => {
    const { auth, resolver } = createResolver();
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    auth.verifyIdToken.mockRejectedValue(
      Object.assign(new Error('private SDK detail'), {
        code: 'auth/id-token-expired',
      }),
    );

    try {
      await expectUnauthorized(
        resolver.resolve(requestWith('Bearer secret-token-value')),
        SESSION_EXPIRED_MESSAGE,
      );

      expect(warn).toHaveBeenCalledTimes(1);
      const [logged] = warn.mock.calls[0] as [string];
      expect(logged).toContain('auth/id-token-expired');
      expect(logged).not.toContain('secret-token-value');
      expect(logged).not.toContain('private SDK detail');
    } finally {
      warn.mockRestore();
    }
  });

  it('logs a placeholder when the Firebase error has no code', async () => {
    const { auth, resolver } = createResolver();
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    auth.verifyIdToken.mockRejectedValue(new Error('private SDK detail'));

    try {
      await expectUnauthorized(
        resolver.resolve(requestWith('Bearer secret-token-value')),
        SESSION_EXPIRED_MESSAGE,
      );

      const [logged] = warn.mock.calls[0] as [string];
      expect(logged).toContain('sin código');
      expect(logged).not.toContain('private SDK detail');
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects a request without a Bearer token', async () => {
    const { auth, resolver } = createResolver();

    await expectUnauthorized(
      resolver.resolve(requestWith()),
      SESSION_EXPIRED_MESSAGE,
    );
    expect(auth.verifyIdToken).not.toHaveBeenCalled();
  });

  it.each<[string, string | string[]]>([
    ['an empty Authorization header', ''],
    ['a different authorization scheme', 'Basic valid-token'],
    ['Bearer without a token', 'Bearer'],
    ['Bearer followed only by extra spaces', 'Bearer   '],
    [
      'a repeated Authorization header',
      ['Bearer token-one', 'Bearer token-two'],
    ],
  ])('rejects %s with the generic 401', async (_case, authorization) => {
    const { auth, resolver } = createResolver();

    await expectUnauthorized(
      resolver.resolve(requestWith(authorization)),
      SESSION_EXPIRED_MESSAGE,
    );
    expect(auth.verifyIdToken).not.toHaveBeenCalled();
  });

  it('accepts a case-insensitive Bearer scheme', async () => {
    const { auth, resolver, usersService } = createResolver();
    const user = {
      id: USER_ID,
      firebaseUid: FIREBASE_UID,
      email: EMAIL,
      role: UserRole.RESTAURANT_ADMIN,
      restaurantId: null,
    } as User;
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.findByFirebaseUid.mockResolvedValue(user);

    await expect(
      resolver.resolve(requestWith('bEaReR valid-token')),
    ).resolves.toMatchObject({ user: { userId: USER_ID } });
    expect(auth.verifyIdToken).toHaveBeenCalledWith('valid-token');
  });

  it('accepts surrounding and repeated whitespace around a valid Bearer token', async () => {
    const { auth, resolver, usersService } = createResolver();
    const user = {
      id: USER_ID,
      firebaseUid: FIREBASE_UID,
      email: EMAIL,
      role: UserRole.RESTAURANT_ADMIN,
      restaurantId: null,
    } as User;
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.findByFirebaseUid.mockResolvedValue(user);

    await expect(
      resolver.resolve(requestWith('  Bearer   valid-token  ')),
    ).resolves.toMatchObject({ user: { userId: USER_ID } });
    expect(auth.verifyIdToken).toHaveBeenCalledWith('valid-token');
  });

  it('rejects a token that has no email', async () => {
    const { auth, resolver, usersService } = createResolver();
    auth.verifyIdToken.mockResolvedValue(decodedToken({ email: undefined }));

    await expectUnauthorized(
      resolver.resolve(requestWith('Bearer valid-token')),
      SESSION_EXPIRED_MESSAGE,
    );
    expect(usersService.findByFirebaseUid).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('returns an unregistered identity, never creating a user, when no UID or email row exists', async () => {
    const { auth, resolver, usersService } = createResolver();
    auth.verifyIdToken.mockResolvedValue(
      decodedToken({ name: '  Ana Gómez ' }),
    );

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).resolves.toEqual({
      kind: 'unregistered',
      firebase: {
        uid: FIREBASE_UID,
        email: EMAIL,
        name: 'Ana Gómez',
        emailVerified: true,
      },
    });
    expect(usersService.findByEmail).toHaveBeenCalledWith(EMAIL);
    expect(usersService.create).not.toHaveBeenCalled();
    expect(usersService.linkFirebaseUid).not.toHaveBeenCalled();
  });

  it.each([
    ['no name', undefined],
    ['a blank name', '   '],
  ])(
    'gives a null name to an unregistered identity whose token has %s',
    async (_case, name) => {
      const { auth, resolver } = createResolver();
      auth.verifyIdToken.mockResolvedValue(decodedToken({ name }));

      await expect(
        resolver.resolve(requestWith('Bearer valid-token')),
      ).resolves.toMatchObject({
        kind: 'unregistered',
        firebase: { name: null },
      });
    },
  );

  it('links an existing email row only when its email is verified', async () => {
    const { auth, resolver, usersService } = createResolver();
    const existingUser = {
      id: USER_ID,
      firebaseUid: null,
      email: EMAIL,
      role: UserRole.RESTAURANT_ADMIN,
      restaurantId: null,
    } as User;
    const linkedUser = { ...existingUser, firebaseUid: FIREBASE_UID } as User;
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.findByEmail.mockResolvedValue(existingUser);
    usersService.linkFirebaseUid.mockResolvedValue(linkedUser);

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).resolves.toMatchObject({ kind: 'registered', user: { userId: USER_ID } });
    expect(usersService.linkFirebaseUid).toHaveBeenCalledWith(
      existingUser,
      FIREBASE_UID,
    );
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('returns EMAIL_NOT_VERIFIED before looking up an existing email row', async () => {
    const { auth, resolver, usersService } = createResolver();
    const existingUser = { id: USER_ID, email: EMAIL } as User;
    auth.verifyIdToken.mockResolvedValue(
      decodedToken({ email_verified: false }),
    );
    usersService.findByEmail.mockResolvedValue(existingUser);

    await expectUnauthorized(
      resolver.resolve(requestWith('Bearer valid-token')),
      EMAIL_NOT_VERIFIED_MESSAGE,
      'EMAIL_NOT_VERIFIED',
    );
    expect(usersService.findByEmail).not.toHaveBeenCalled();
    expect(usersService.linkFirebaseUid).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('does not overwrite a different Firebase UID linked to the email', async () => {
    const { auth, resolver, usersService } = createResolver();
    const existingUser = {
      id: USER_ID,
      firebaseUid: 'another-firebase-uid',
      email: EMAIL,
    } as User;
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.findByEmail.mockResolvedValue(existingUser);

    await expectUnauthorized(
      resolver.resolve(requestWith('Bearer valid-token')),
      SESSION_EXPIRED_MESSAGE,
    );
    expect(usersService.linkFirebaseUid).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('logs the rejected account without the email, the UIDs or the token', async () => {
    const { auth, resolver, usersService } = createResolver();
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.findByEmail.mockResolvedValue({
      id: USER_ID,
      firebaseUid: 'another-firebase-uid',
      email: EMAIL,
    } as User);

    try {
      // Same 401 as before: the log is the only new thing.
      await expectUnauthorized(
        resolver.resolve(requestWith('Bearer secret-token-value')),
        SESSION_EXPIRED_MESSAGE,
      );

      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warn.mock.calls[0]);
      expect(logged).toContain('email already linked to another UID');
      for (const secret of [
        EMAIL,
        FIREBASE_UID,
        'another-firebase-uid',
        USER_ID,
        'secret-token-value',
      ]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('returns EMAIL_NOT_VERIFIED without creating when no email row exists', async () => {
    const { auth, resolver, usersService } = createResolver();
    auth.verifyIdToken.mockResolvedValue(
      decodedToken({ email_verified: false }),
    );

    await expectUnauthorized(
      resolver.resolve(requestWith('Bearer valid-token')),
      EMAIL_NOT_VERIFIED_MESSAGE,
      'EMAIL_NOT_VERIFIED',
    );
    expect(usersService.findByEmail).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('resolves an already UID-linked user even when its email is unverified', async () => {
    const { auth, resolver, usersService } = createResolver();
    const user = {
      id: USER_ID,
      firebaseUid: FIREBASE_UID,
      email: EMAIL,
      role: UserRole.RESTAURANT_ADMIN,
      restaurantId: null,
    } as User;
    auth.verifyIdToken.mockResolvedValue(
      decodedToken({ email_verified: false }),
    );
    usersService.findByFirebaseUid.mockResolvedValue(user);

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).resolves.toEqual({
      kind: 'registered',
      user: {
        userId: USER_ID,
        restaurantId: null,
        role: UserRole.RESTAURANT_ADMIN,
      },
    });
    expect(usersService.findByEmail).not.toHaveBeenCalled();
  });
});
