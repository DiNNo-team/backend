import type { ConfigService } from '@nestjs/config';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

export const FIREBASE_AUTH = Symbol('FIREBASE_AUTH');

export type FirebaseAuthFactory = () => Auth;

const FIREBASE_APP_NAME = 'dinno-auth';

export function createFirebaseAuthFactory(
  config: ConfigService,
): FirebaseAuthFactory {
  return () => {
    const projectId = config.getOrThrow<string>('FIREBASE_PROJECT_ID');
    const app =
      getApps().find(
        (registeredApp) => registeredApp.name === FIREBASE_APP_NAME,
      ) ?? initializeApp({ projectId }, FIREBASE_APP_NAME);

    return getAuth(app);
  };
}
