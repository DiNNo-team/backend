import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PushDevice, type PushPlatform } from './push-device.entity.js';

// The phones of each diner. Registering is idempotent: the token is unique, so
// the same phone registering again (every app start) only refreshes the row,
// and a phone that signs in with another account moves to that account.
@Injectable()
export class PushDevicesService {
  constructor(
    @InjectRepository(PushDevice)
    private readonly devices: Repository<PushDevice>,
  ) {}

  async register(
    userId: string,
    token: string,
    platform: PushPlatform,
  ): Promise<void> {
    await this.devices.upsert({ userId, token, platform }, ['token']);
  }

  // Only the diner's own token: a token of another account is left alone.
  async unregister(userId: string, token: string): Promise<void> {
    await this.devices.delete({ userId, token });
  }

  async tokensOf(userId: string): Promise<string[]> {
    const rows = await this.devices.find({
      where: { userId },
      select: { token: true },
    });
    return rows.map((row) => row.token);
  }

  // Tokens FCM says no longer exist (the app was uninstalled or the token rotated).
  async forget(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.devices.delete({ token: In(tokens) });
  }
}
