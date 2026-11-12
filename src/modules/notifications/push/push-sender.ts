import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

export interface PushMessage {
  title: string;
  body: string;
  // What the app needs when the person taps it (type and reservationId).
  data: Record<string, string>;
}

export interface PushResult {
  sent: number;
  // Tokens FCM says no longer exist: the caller forgets them.
  invalidTokens: string[];
}

// Port: who delivers a notification to a list of phones. The listener depends
// on this, never on firebase-admin, so the tests replace it.
export abstract class PushSender {
  abstract readonly enabled: boolean;
  abstract send(tokens: string[], message: PushMessage): Promise<PushResult>;
}

// The Android channel the app creates («Reservas»): high importance, so the
// notification shows as a banner.
export const ANDROID_CHANNEL_ID = 'reservations';

// FCM error codes of a token that will never work again.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export class FcmPushSender extends PushSender {
  readonly enabled = true;

  constructor(private readonly messaging: Messaging) {
    super();
  }

  async send(tokens: string[], message: PushMessage): Promise<PushResult> {
    if (tokens.length === 0) return { sent: 0, invalidTokens: [] };
    const response = await this.messaging.sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        priority: 'high',
        notification: { channelId: ANDROID_CHANNEL_ID },
      },
    });
    const invalidTokens = response.responses.flatMap((result, index) =>
      !result.success && DEAD_TOKEN_CODES.has(result.error?.code ?? '')
        ? [tokens[index]]
        : [],
    );
    return { sent: response.successCount, invalidTokens };
  }
}

// Without credentials the API works the same, only without notifications.
export class DisabledPushSender extends PushSender {
  readonly enabled = false;

  send(): Promise<PushResult> {
    return Promise.resolve({ sent: 0, invalidTokens: [] });
  }
}

// Its own Firebase app: the one of identity-access only verifies tokens with
// the project id and does not change.
const FIREBASE_APP_NAME = 'dinno-notifications';

interface ServiceAccountJson {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

function readServiceAccount(config: ConfigService): ServiceAccountJson | null {
  const inline = config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim();
  const file = config.get<string>('FIREBASE_SERVICE_ACCOUNT_FILE')?.trim();
  if (inline) return JSON.parse(inline) as ServiceAccountJson;
  if (file) return JSON.parse(readFileSync(file, 'utf8')) as ServiceAccountJson;
  return null;
}

/**
 * The sender of the app: FCM with the service account of
 * FIREBASE_SERVICE_ACCOUNT_JSON (its content, for Azure and CI) or
 * FIREBASE_SERVICE_ACCOUNT_FILE (a path: a Secret File in Render, a local
 * file). Without either one, or if they cannot be read, notifications are off
 * and the API starts anyway: they are never critical for the reservation.
 * The credentials never go to the log, only the type of failure.
 */
export function createPushSender(config: ConfigService): PushSender {
  const logger = new Logger('PushNotifications');
  let account: ServiceAccountJson | null;
  try {
    account = readServiceAccount(config);
  } catch (error) {
    logger.error(
      `Notificaciones push desactivadas: no se pudo leer la cuenta de servicio (${error instanceof Error ? error.name : 'error desconocido'}).`,
    );
    return new DisabledPushSender();
  }
  if (!account) {
    logger.warn(
      'Notificaciones push desactivadas: falta FIREBASE_SERVICE_ACCOUNT_JSON o FIREBASE_SERVICE_ACCOUNT_FILE.',
    );
    return new DisabledPushSender();
  }
  if (!account.project_id || !account.client_email || !account.private_key) {
    logger.error(
      'Notificaciones push desactivadas: a la cuenta de servicio le faltan project_id, client_email o private_key.',
    );
    return new DisabledPushSender();
  }
  const app =
    getApps().find((registered) => registered.name === FIREBASE_APP_NAME) ??
    initializeApp(
      {
        credential: cert({
          projectId: account.project_id,
          clientEmail: account.client_email,
          privateKey: account.private_key,
        }),
      },
      FIREBASE_APP_NAME,
    );
  logger.log('Notificaciones push activas (FCM).');
  return new FcmPushSender(getMessaging(app));
}
