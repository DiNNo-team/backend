import type { ConfigService } from '@nestjs/config';
import { isDeployedEnvironment } from '../current-user/dev-user.resolver.js';

// Local-only switches that must never reach a deployed environment: with the
// emulator host the Firebase SDK accepts unsigned tokens, and the dev user
// skips authentication. Only names go in the error, never values.
export function assertSafeDeploymentConfig(config: ConfigService): void {
  if (!isDeployedEnvironment(config)) {
    return;
  }

  const unsafe: string[] = [];
  if (config.get<string>('FIREBASE_AUTH_EMULATOR_HOST') !== undefined) {
    unsafe.push('FIREBASE_AUTH_EMULATOR_HOST');
  }
  if (config.get<string>('DEV_USER_ENABLED') === 'true') {
    unsafe.push('DEV_USER_ENABLED');
  }

  if (unsafe.length > 0) {
    throw new Error(
      `Variables no permitidas en un ambiente desplegado: ${unsafe.join(', ')}. Quítalas de la configuración del servicio (por ejemplo, en Render) para que la aplicación arranque.`,
    );
  }
}
