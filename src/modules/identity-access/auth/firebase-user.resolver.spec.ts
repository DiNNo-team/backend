import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { User } from '../users/user.entity.js';
import type { UsersService } from '../users/users.service.js';
import type { FirebaseAuthFactory } from './firebase-admin.provider.js';
import { FirebaseUserResolver } from './firebase-user.resolver.js';

const SESSION_EXPIRED_MESSAGE = 'Tu sesión terminó. Inicia sesión de nuevo.';
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

function requestWith(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
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

describe('FirebaseUserResolver', () => {
  beforeEach(() => vi.resetAllMocks());

  it('resolves an existing user by Firebase UID from a valid token', async () => {
    const { auth, resolver, usersService } = createResolver();
    const user = {
      id: USER_ID,
      firebaseUid: FIREBASE_UID,
      email: EMAIL,
      role: 'restaurant_admin',
      restaurantId: null,
    } as User;
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.findByFirebaseUid.mockResolvedValue(user);

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).resolves.toEqual({
      userId: USER_ID,
      restaurantId: null,
      role: 'restaurant_admin',
    });
    expect(auth.verifyIdToken).toHaveBeenCalledWith('valid-token');
    expect(usersService.findByEmail).not.toHaveBeenCalled();
  });

  it('rejects an invalid Firebase token with the standard 401 message', async () => {
    const { auth, resolver, usersService } = createResolver();
    auth.verifyIdToken.mockRejectedValue(new Error('private SDK detail'));

    await expect(
      resolver.resolve(requestWith('Bearer invalid-token')),
    ).rejects.toMatchObject({
      status: 401,
      response: { message: SESSION_EXPIRED_MESSAGE },
    });
    expect(usersService.findByFirebaseUid).not.toHaveBeenCalled();
  });

  it('rejects a request without a Bearer token', async () => {
    const { auth, resolver } = createResolver();

    await expect(resolver.resolve(requestWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(auth.verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects a token that has no email', async () => {
    const { auth, resolver, usersService } = createResolver();
    auth.verifyIdToken.mockResolvedValue(decodedToken({ email: undefined }));

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).rejects.toMatchObject({
      response: { message: SESSION_EXPIRED_MESSAGE },
    });
    expect(usersService.findByFirebaseUid).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('creates a user with the default role when no UID or email row exists', async () => {
    const { auth, resolver, usersService } = createResolver();
    const user = {
      id: USER_ID,
      firebaseUid: FIREBASE_UID,
      email: EMAIL,
      role: 'restaurant_admin',
      restaurantId: null,
    } as User;
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.create.mockResolvedValue(user);

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).resolves.toEqual({
      userId: USER_ID,
      restaurantId: null,
      role: 'restaurant_admin',
    });
    expect(usersService.create).toHaveBeenCalledWith({
      firebaseUid: FIREBASE_UID,
      email: EMAIL,
      role: 'restaurant_admin',
      restaurantId: null,
    });
  });

  it('links an existing email row only when its email is verified', async () => {
    const { auth, resolver, usersService } = createResolver();
    const existingUser = {
      id: USER_ID,
      firebaseUid: null,
      email: EMAIL,
      role: 'restaurant_admin',
      restaurantId: null,
    } as User;
    const linkedUser = { ...existingUser, firebaseUid: FIREBASE_UID } as User;
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.findByEmail.mockResolvedValue(existingUser);
    usersService.linkFirebaseUid.mockResolvedValue(linkedUser);

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).resolves.toMatchObject({ userId: USER_ID });
    expect(usersService.linkFirebaseUid).toHaveBeenCalledWith(
      existingUser,
      FIREBASE_UID,
    );
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('does not link or create when an existing email is unverified', async () => {
    const { auth, resolver, usersService } = createResolver();
    const existingUser = { id: USER_ID, email: EMAIL } as User;
    auth.verifyIdToken.mockResolvedValue(
      decodedToken({ email_verified: false }),
    );
    usersService.findByEmail.mockResolvedValue(existingUser);

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).rejects.toMatchObject({
      response: { message: SESSION_EXPIRED_MESSAGE },
    });
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

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).rejects.toMatchObject({
      response: { message: SESSION_EXPIRED_MESSAGE },
    });
    expect(usersService.linkFirebaseUid).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('does not create a user when the token email is unverified', async () => {
    const { auth, resolver, usersService } = createResolver();
    auth.verifyIdToken.mockResolvedValue(
      decodedToken({ email_verified: false }),
    );

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).rejects.toMatchObject({
      response: { message: SESSION_EXPIRED_MESSAGE },
    });
    expect(usersService.findByEmail).toHaveBeenCalledWith(EMAIL);
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('rechecks by UID after a unique conflict while creating', async () => {
    const { auth, resolver, usersService } = createResolver();
    const user = {
      id: USER_ID,
      firebaseUid: FIREBASE_UID,
      email: EMAIL,
      role: 'restaurant_admin',
      restaurantId: null,
    } as User;
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.create.mockRejectedValue({ code: '23505' });
    usersService.findByFirebaseUid
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(user);

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).resolves.toMatchObject({ userId: USER_ID });
    expect(usersService.findByFirebaseUid).toHaveBeenCalledTimes(2);
  });

  it('propagates creation errors other than unique violations', async () => {
    const { auth, resolver, usersService } = createResolver();
    const error = new Error('database unavailable');
    auth.verifyIdToken.mockResolvedValue(decodedToken());
    usersService.create.mockRejectedValue(error);

    await expect(
      resolver.resolve(requestWith('Bearer valid-token')),
    ).rejects.toBe(error);
    expect(usersService.findByFirebaseUid).toHaveBeenCalledTimes(1);
  });
});
