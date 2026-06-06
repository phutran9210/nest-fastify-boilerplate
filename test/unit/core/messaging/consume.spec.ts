import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';
import { CacheService } from '@core/redis/ports/cache.service.port';
import { LockService } from '@core/redis/ports/lock.service.port';
import { MessageConsumer } from '@core/messaging/consume';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import type { ConsumeMessage } from 'amqplib';

const amqpMsg = (headers: Record<string, unknown>, messageId: string | undefined = 'mid-1') =>
  ({ properties: { headers, messageId } }) as unknown as ConsumeMessage;

describe('MessageConsumer', () => {
  let consumer: MessageConsumer;
  const amqp = { publish: jest.fn().mockResolvedValue(undefined) };
  const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn(), getOrSet: jest.fn() };
  const lock = { acquire: jest.fn(), withLock: jest.fn() };
  const release = jest.fn().mockResolvedValue(true);
  const config = {
    getOrThrow: jest.fn((k: string) =>
      ({ RABBITMQ_EXCHANGE: 'app', RABBITMQ_MAX_RETRIES: 2, RABBITMQ_IDEMPOTENCY_TTL: 100 })[k],
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    lock.acquire.mockResolvedValue({ key: 'k', token: 't', fencingToken: 1, release });
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessageConsumer,
        { provide: AmqpConnection, useValue: amqp },
        { provide: CacheService, useValue: cache },
        { provide: LockService, useValue: lock },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    consumer = moduleRef.get(MessageConsumer);
  });

  const params = { subscriber: 'mail', routingKey: 'user.registered' as const };
  const good = { userId: '11111111-1111-1111-8111-111111111111', email: 'a@b.com' };

  it('happy path: gọi handler, set processed marker, ack (void)', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(handler).toHaveBeenCalledWith(good);
    expect(cache.set).toHaveBeenCalledWith('messaging:done:mid-1', 1, 100);
    expect(res).toBeUndefined();
    expect(release).toHaveBeenCalled();
  });

  it('đã xử lý (marker tồn tại) → skip handler, ack', async () => {
    cache.get.mockResolvedValue(1);
    const handler = jest.fn();
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(handler).not.toHaveBeenCalled();
    expect(res).toBeUndefined();
  });

  it('không lấy được lock → Nack(requeue)', async () => {
    lock.acquire.mockResolvedValue(null);
    const handler = jest.fn();
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(res).toBeInstanceOf(Nack);
    expect((res as Nack).requeue).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('payload sai schema → publish DLX, KHÔNG retry, ack', async () => {
    const handler = jest.fn();
    const res = await consumer.handle(params, { userId: 'x' }, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(handler).not.toHaveBeenCalled();
    expect(lock.acquire).not.toHaveBeenCalled(); // validation trước lock — không tốn Redis lock
    const [exchange] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('app.dlx');
    expect(res).toBeUndefined();
  });

  it('thiếu messageId → DLQ, không xử lý', async () => {
    const handler = jest.fn();
    // Dựng trực tiếp (không qua helper) để messageId thật sự undefined.
    const noId = { properties: { headers: { 'x-attempt': 0 } } } as unknown as ConsumeMessage;
    const res = await consumer.handle(params, good, noId, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(lock.acquire).not.toHaveBeenCalled();
    const [exchange] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('app.dlx');
    expect(res).toBeUndefined();
  });

  it('handler lỗi & còn lượt → publish retry tier, ack', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    const [exchange, rk, , options] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('app.retry');
    expect(rk).toBe('mail.user.registered.r0');
    expect(options.headers['x-attempt']).toBe(1);
    expect(cache.set).not.toHaveBeenCalled(); // marker chỉ set khi success
    expect(res).toBeUndefined();
  });

  it('handler lỗi & cạn lượt → publish DLX, ack', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 2 }), handler);
    const [exchange] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('app.dlx');
    expect(res).toBeUndefined();
  });

  it('handler lỗi nhưng publish retry FAIL → Nack(requeue), không ack', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    amqp.publish.mockRejectedValueOnce(new Error('broker down'));
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(res).toBeInstanceOf(Nack);
    expect((res as Nack).requeue).toBe(true);
  });

  it('cạn lượt nhưng publish DLQ FAIL → Nack(requeue), không ack', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    amqp.publish.mockRejectedValueOnce(new Error('broker down'));
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 2 }), handler);
    expect(res).toBeInstanceOf(Nack);
    expect((res as Nack).requeue).toBe(true);
  });
});
