import type { ConfigService } from '@nestjs/config';
import type { CurrentUserResolver } from '../current-user/current-user.resolver.js';
import type { DevUserResolver } from '../current-user/dev-user.resolver.js';
import type { FirebaseUserResolver } from './firebase-user.resolver.js';

export function selectCurrentUserResolver(
  devUserResolver: DevUserResolver,
  firebaseUserResolver: FirebaseUserResolver,
  configService: ConfigService,
): CurrentUserResolver {
  if (devUserResolver.enabled) {
    return devUserResolver;
  }

  configService.getOrThrow<string>('FIREBASE_PROJECT_ID');
  return firebaseUserResolver;
}
