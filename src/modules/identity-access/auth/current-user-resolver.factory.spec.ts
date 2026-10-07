import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { DevUserResolver } from '../current-user/dev-user.resolver.js';
import type { User } from '../users/user.entity.js';
import { selectCurrentUserResolver } from './current-user-resolver.factory.js';
import type { FirebaseUserResolver } from './firebase-user.resolver.js';

function createConfig(values: Record<string, string>) {
  return {
    get: vi.fn((key: string) => values[key]),
    getOrThrow: vi.fn((key: string) => {
      const value = values[key];
      if (!value) {
        throw new Error(`Configuration key "${key}" does not exist`);
      }
      return value;
    }),
  } as unknown as ConfigService;
}

function createDevResolver(config: ConfigService): DevUserResolver {
  return new DevUserResolver({} as Repository<User>, config);
}

describe('selectCurrentUserResolver', () => {
  const firebaseResolver = {} as FirebaseUserResolver;

  it.each([
    ['Render', { RENDER: 'true' }],
    ['production', { NODE_ENV: 'production' }],
  ])('selects Firebase in %s even when development is enabled', (_, env) => {
    const config = createConfig({
      DEV_USER_ENABLED: 'true',
      FIREBASE_PROJECT_ID: 'firebase-project-example',
      ...env,
    });
    const devResolver = createDevResolver(config);

    expect(devResolver.enabled).toBe(false);
    expect(
      selectCurrentUserResolver(devResolver, firebaseResolver, config),
    ).toBe(firebaseResolver);
    expect(config.getOrThrow).toHaveBeenCalledWith('FIREBASE_PROJECT_ID');
  });

  it('keeps the local dev resolver without requiring the Firebase project ID', () => {
    const config = createConfig({ DEV_USER_ENABLED: 'true' });
    const devResolver = createDevResolver(config);

    expect(
      selectCurrentUserResolver(devResolver, firebaseResolver, config),
    ).toBe(devResolver);
    expect(config.getOrThrow).not.toHaveBeenCalled();
  });

  it('fails immediately when Firebase is selected without its project ID', () => {
    const config = createConfig({ DEV_USER_ENABLED: 'false' });
    const devResolver = createDevResolver(config);

    expect(() =>
      selectCurrentUserResolver(devResolver, firebaseResolver, config),
    ).toThrow('Configuration key "FIREBASE_PROJECT_ID" does not exist');
  });
});
