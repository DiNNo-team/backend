import type { ConfigService } from '@nestjs/config';

// Render sets RENDER on every service; NODE_ENV covers other deployments.
// Used to turn off the local-only switches (deployment-safety.ts, the dev
// user) and to choose the listen host (app.setup.ts).
export function isDeployedEnvironment(config: ConfigService): boolean {
  return (
    config.get<string>('RENDER') !== undefined ||
    config.get<string>('NODE_ENV') === 'production'
  );
}
