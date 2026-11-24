import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';

// An in-memory Redis pub/sub with the slice of the ioredis API that
// @socket.io/redis-adapter uses (publish, psubscribe/subscribe and the
// pmessageBuffer/messageBuffer events). Every client made by one bus sees the
// messages of the others, like two replicas sharing one Redis.
export class FakeRedisBus {
  private readonly clients = new Set<FakeRedisClient>();
  failPublish = false;
  published = 0;

  client(): Redis {
    const client = new FakeRedisClient(this);
    this.clients.add(client);
    return client as unknown as Redis;
  }

  deliver(channel: string, message: Buffer): number {
    let receivers = 0;
    for (const client of this.clients) {
      receivers += client.receive(channel, message);
    }
    return receivers;
  }
}

class FakeRedisClient extends EventEmitter {
  private readonly patterns = new Set<string>();
  private readonly channels = new Set<string>();

  constructor(private readonly bus: FakeRedisBus) {
    super();
  }

  publish(channel: string, message: string | Buffer): Promise<number> {
    if (this.bus.failPublish) {
      return Promise.reject(new Error('Connection is closed.'));
    }
    this.bus.published += 1;
    const payload = Buffer.isBuffer(message) ? message : Buffer.from(message);
    // Redis delivers asynchronously, after the publish returns.
    return new Promise((resolve) =>
      setImmediate(() => resolve(this.bus.deliver(channel, payload))),
    );
  }

  psubscribe(...patterns: string[]): Promise<number> {
    patterns.flat().forEach((pattern) => this.patterns.add(pattern));
    return Promise.resolve(this.patterns.size);
  }

  punsubscribe(...patterns: string[]): Promise<number> {
    patterns.flat().forEach((pattern) => this.patterns.delete(pattern));
    return Promise.resolve(this.patterns.size);
  }

  subscribe(...channels: (string | string[])[]): Promise<number> {
    channels.flat().forEach((channel) => this.channels.add(channel));
    return Promise.resolve(this.channels.size);
  }

  unsubscribe(...channels: (string | string[])[]): Promise<number> {
    channels.flat().forEach((channel) => this.channels.delete(channel));
    return Promise.resolve(this.channels.size);
  }

  receive(channel: string, message: Buffer): number {
    let matched = 0;
    for (const pattern of this.patterns) {
      if (channel.startsWith(pattern.replace(/\*$/, ''))) {
        matched += 1;
        this.emit(
          'pmessageBuffer',
          Buffer.from(pattern),
          Buffer.from(channel),
          message,
        );
      }
    }
    if (this.channels.has(channel)) {
      matched += 1;
      this.emit('messageBuffer', Buffer.from(channel), message);
    }
    return matched;
  }
}
