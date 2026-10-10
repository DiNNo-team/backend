import { ConfigModule, type ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IdentityAccessModule } from '../identity-access.module.js';
import { User } from '../users/user.entity.js';
import { assertSafeDeploymentConfig } from './deployment-safety.js';

function configWith(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

const DEPLOYED_ENVS: [string, Record<string, string>][] = [
  ['Render', { RENDER: 'true' }],
  ['production', { NODE_ENV: 'production' }],
];

describe('assertSafeDeploymentConfig', () => {
  describe.each(DEPLOYED_ENVS)('deployed (%s)', (_, deployedEnv) => {
    it('refuses to start with FIREBASE_AUTH_EMULATOR_HOST, naming the variable but not its value', () => {
      const config = configWith({
        ...deployedEnv,
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      });

      expect(() => assertSafeDeploymentConfig(config)).toThrow(
        'FIREBASE_AUTH_EMULATOR_HOST',
      );
      expect(() => assertSafeDeploymentConfig(config)).not.toThrow(
        '127.0.0.1:9099',
      );
    });

    it('refuses to start with DEV_USER_ENABLED=true', () => {
      const config = configWith({ ...deployedEnv, DEV_USER_ENABLED: 'true' });

      expect(() => assertSafeDeploymentConfig(config)).toThrow(
        'DEV_USER_ENABLED',
      );
    });

    it('names both variables when both are set', () => {
      const config = configWith({
        ...deployedEnv,
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        DEV_USER_ENABLED: 'true',
      });

      expect(() => assertSafeDeploymentConfig(config)).toThrow(
        'FIREBASE_AUTH_EMULATOR_HOST, DEV_USER_ENABLED',
      );
    });

    it('starts without them, or with DEV_USER_ENABLED other than true', () => {
      expect(() =>
        assertSafeDeploymentConfig(configWith(deployedEnv)),
      ).not.toThrow();
      expect(() =>
        assertSafeDeploymentConfig(
          configWith({ ...deployedEnv, DEV_USER_ENABLED: 'false' }),
        ),
      ).not.toThrow();
    });
  });

  it('starts locally with both variables set', () => {
    const config = configWith({
      NODE_ENV: 'test',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      DEV_USER_ENABLED: 'true',
    });

    expect(() => assertSafeDeploymentConfig(config)).not.toThrow();
  });
});

describe('IdentityAccessModule startup', () => {
  async function initWith(env: Record<string, string>): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({ FIREBASE_PROJECT_ID: 'firebase-project-example', ...env }),
          ],
        }),
        IdentityAccessModule,
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .compile();
    try {
      await moduleRef.init();
    } finally {
      await moduleRef.close();
    }
  }

  it('does not start on Render with the development user enabled', async () => {
    await expect(
      initWith({ RENDER: 'true', DEV_USER_ENABLED: 'true' }),
    ).rejects.toThrow('DEV_USER_ENABLED');
  });

  it('starts on Render without the local-only variables', async () => {
    await expect(initWith({ RENDER: 'true' })).resolves.toBeUndefined();
  });
});
