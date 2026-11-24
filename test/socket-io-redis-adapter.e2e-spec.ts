import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createAdapter } from '@socket.io/redis-adapter';
import type { AddressInfo } from 'node:net';
import type { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import type { SocketConnectionLimiter } from './../src/common/rate-limit/socket-connection-limiter.js';
import { CorsIoAdapter } from './../src/config/socket-io.adapter.js';
import {
  type SocketIoAdapterConstructor,
  withSafePublish,
} from './../src/config/socket-io-redis.js';
import { FakeRedisBus } from './support/fake-redis-pubsub.js';

// Two "replicas" of the API: two Nest apps, each with its own Socket.IO server
// made by CorsIoAdapter, like two containers behind the Azure ingress. A
// socket stays on the replica it connected to; the Redis adapter is what lets
// an emit on one replica reach the sockets of the other.

const ORIGINS = ['https://web.dinno.test'];
const EVENT_TIMEOUT_MS = 2_000;
// How long to wait before concluding an event did NOT arrive.
const SILENCE_MS = 300;

interface Replica {
  app: INestApplication;
  server: Server;
  url: string;
}

async function startReplica(
  roomsAdapter: SocketIoAdapterConstructor | null,
  limiter?: SocketConnectionLimiter,
): Promise<Replica> {
  const moduleRef = await Test.createTestingModule({}).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const adapter = new CorsIoAdapter(app, ORIGINS, limiter, roomsAdapter);
  await app.listen(0, '127.0.0.1');
  const server = adapter.create(0) as Server;
  // Like roomsFor: the server puts each socket in its rooms on connection.
  server.on('connection', (socket) => {
    const room = socket.handshake.query.room;
    if (typeof room === 'string') {
      void socket.join(room);
    }
  });
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, server, url: `http://127.0.0.1:${port}` };
}

function connect(replica: Replica, room: string): Promise<Socket> {
  const socket = io(replica.url, {
    transports: ['websocket'],
    reconnection: false,
    query: { room },
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function nextEvent(socket: Socket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${event} no llegó`)),
      EVENT_TIMEOUT_MS,
    );
    socket.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function receivedWithin(socket: Socket, event: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), SILENCE_MS);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe('Socket.IO with the Redis adapter, two replicas (e2e)', () => {
  let replicas: Replica[] = [];
  let sockets: Socket[] = [];

  async function twoReplicas(bus: FakeRedisBus | null): Promise<Replica[]> {
    const adapterFor = () =>
      bus ? createAdapter(withSafePublish(bus.client()), bus.client()) : null;
    replicas = [
      await startReplica(adapterFor()),
      await startReplica(adapterFor()),
    ];
    return replicas;
  }

  async function client(replica: Replica, room: string): Promise<Socket> {
    const socket = await connect(replica, room);
    sockets.push(socket);
    return socket;
  }

  afterEach(async () => {
    sockets.forEach((socket) => socket.disconnect());
    sockets = [];
    for (const replica of replicas) {
      await new Promise((resolve) => replica.server.close(resolve));
      await replica.app.close();
    }
    replicas = [];
    vi.restoreAllMocks();
  });

  it('delivers an emit on one replica to the sockets of both', async () => {
    const [a, b] = await twoReplicas(new FakeRedisBus());
    const onA = await client(a, 'diners');
    const onB = await client(b, 'diners');
    const payload = { restaurantId: 'r1', availability: 'few' };

    const arrivals = Promise.all([
      nextEvent(onA, 'availability.changed'),
      nextEvent(onB, 'availability.changed'),
    ]);
    b.server.to('diners').emit('availability.changed', payload);

    expect(await arrivals).toEqual([payload, payload]);
  });

  it('keeps each room to itself across replicas', async () => {
    const [a, b] = await twoReplicas(new FakeRedisBus());
    const restaurant = await client(a, 'restaurant:r1');
    const otherRestaurant = await client(a, 'restaurant:r2');
    const diner = await client(b, 'diner:d1');

    const arrives = nextEvent(restaurant, 'reservation.cancelled');
    const silentForOther = receivedWithin(
      otherRestaurant,
      'reservation.cancelled',
    );
    const silentForDiner = receivedWithin(diner, 'reservation.cancelled');
    b.server.to('restaurant:r1').emit('reservation.cancelled', { id: 'x' });

    expect(await arrives).toEqual({ id: 'x' });
    expect(await silentForOther).toBe(false);
    expect(await silentForDiner).toBe(false);
  });

  it('without the adapter (control): the other replica never gets the event', async () => {
    const [a, b] = await twoReplicas(null);
    const onA = await client(a, 'diners');
    const onB = await client(b, 'diners');

    const arrivesOnB = nextEvent(onB, 'availability.changed');
    const arrivedOnA = receivedWithin(onA, 'availability.changed');
    b.server.to('diners').emit('availability.changed', { restaurantId: 'r1' });

    await arrivesOnB;
    expect(await arrivedOnA).toBe(false);
  });

  it('if Redis fails, the replica still delivers to its own sockets and the API keeps running', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const bus = new FakeRedisBus();
    const [a, b] = await twoReplicas(bus);
    const onA = await client(a, 'diners');
    const onB = await client(b, 'diners');
    bus.failPublish = true;

    const local = nextEvent(onB, 'availability.changed');
    const remote = receivedWithin(onA, 'availability.changed');
    b.server.to('diners').emit('availability.changed', { n: 1 });
    expect(await local).toEqual({ n: 1 });
    expect(await remote).toBe(false);

    // A second failure does not repeat the WARN.
    const second = nextEvent(onB, 'availability.changed');
    b.server.to('diners').emit('availability.changed', { n: 2 });
    await second;
    expect(warn).toHaveBeenCalledTimes(1);

    // Redis is back: the other replica gets events again, with one LOG.
    bus.failPublish = false;
    const backOnA = nextEvent(onA, 'availability.changed');
    b.server.to('diners').emit('availability.changed', { n: 3 });
    expect(await backOnA).toEqual({ n: 3 });
    expect(
      log.mock.calls.filter(([message]) =>
        String(message).includes('Redis volvió'),
      ),
    ).toHaveLength(1);
  });

  it('keeps the CORS origins and the connection limit with the adapter', async () => {
    const limiter = {
      allows: vi.fn().mockResolvedValue(false),
    } as unknown as SocketConnectionLimiter;
    const bus = new FakeRedisBus();
    replicas = [
      await startReplica(createAdapter(bus.client(), bus.client()), limiter),
    ];
    const [replica] = replicas;

    expect(replica.server.engine.opts.cors).toEqual({
      origin: ORIGINS,
      credentials: false,
    });
    await expect(connect(replica, 'diners')).rejects.toThrow('RATE_LIMITED');
    expect(limiter.allows).toHaveBeenCalledTimes(1);
  });
});
