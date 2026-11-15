import type { ConfigService } from '@nestjs/config';
import type { Messaging } from 'firebase-admin/messaging';
import {
  ANDROID_CHANNEL_ID,
  createPushSender,
  DisabledPushSender,
  FcmPushSender,
} from './push-sender.js';

function messagingAnswering(
  responses: { success: boolean; error?: { code: string } }[],
) {
  const sendEachForMulticast = vi.fn().mockResolvedValue({
    successCount: responses.filter((r) => r.success).length,
    responses,
  });
  return {
    messaging: { sendEachForMulticast } as unknown as Messaging,
    sendEachForMulticast,
  };
}

const message = {
  title: 'Check-in confirmado',
  body: 'Tu Mesa 04 en Casa 72 te espera.',
  data: { type: 'checked_in', reservationId: 'r1' },
};

describe('FcmPushSender', () => {
  it('sends to every phone through the «Reservas» channel with high priority', async () => {
    const { messaging, sendEachForMulticast } = messagingAnswering([
      { success: true },
    ]);

    const result = await new FcmPushSender(messaging).send(['t1'], message);

    expect(result).toEqual({ sent: 1, invalidTokens: [] });
    expect(sendEachForMulticast).toHaveBeenCalledWith({
      tokens: ['t1'],
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        priority: 'high',
        notification: { channelId: ANDROID_CHANNEL_ID },
      },
    });
  });

  it('reports only the tokens that will never work again, not the ones that failed for a while', async () => {
    const { messaging } = messagingAnswering([
      {
        success: false,
        error: { code: 'messaging/registration-token-not-registered' },
      },
      { success: false, error: { code: 'messaging/internal-error' } },
      {
        success: false,
        error: { code: 'messaging/invalid-registration-token' },
      },
      { success: true },
    ]);

    const result = await new FcmPushSender(messaging).send(
      ['gone', 'flaky', 'broken', 'ok'],
      message,
    );

    expect(result).toEqual({ sent: 1, invalidTokens: ['gone', 'broken'] });
  });

  it('does not call FCM without phones', async () => {
    const { messaging, sendEachForMulticast } = messagingAnswering([]);
    await new FcmPushSender(messaging).send([], message);
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });
});

describe('createPushSender', () => {
  const config = (values: Record<string, string>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  it('without credentials the API starts with notifications off', () => {
    const sender = createPushSender(config({}));
    expect(sender).toBeInstanceOf(DisabledPushSender);
    expect(sender.enabled).toBe(false);
  });

  it('a JSON that cannot be read turns them off instead of stopping the API', () => {
    expect(
      createPushSender(config({ FIREBASE_SERVICE_ACCOUNT_JSON: '{not json' })),
    ).toBeInstanceOf(DisabledPushSender);
  });

  it('a file that does not exist turns them off too', () => {
    expect(
      createPushSender(
        config({ FIREBASE_SERVICE_ACCOUNT_FILE: '/no/such/file.json' }),
      ),
    ).toBeInstanceOf(DisabledPushSender);
  });

  it('a service account without its private key turns them off', () => {
    expect(
      createPushSender(
        config({
          FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
            project_id: 'p',
            client_email: 'e@p.iam.gserviceaccount.com',
          }),
        }),
      ),
    ).toBeInstanceOf(DisabledPushSender);
  });

  it('a disabled sender sends nothing', async () => {
    expect(await new DisabledPushSender().send()).toEqual({
      sent: 0,
      invalidTokens: [],
    });
  });
});
