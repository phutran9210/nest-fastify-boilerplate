import { randomUUID } from 'node:crypto';
import { PrismaService } from '@core/prisma/prisma.service';
import { type OutboxEvent, Prisma } from '@generated/prisma/client';
import { Temporal } from '@js-temporal/polyfill';
import { Injectable } from '@nestjs/common';
import { type EnqueueOutboxData, OutboxRepository } from './outbox.repository.port';

@Injectable()
export class PrismaOutboxRepository extends OutboxRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  enqueue(data: EnqueueOutboxData): Promise<OutboxEvent> {
    return this.prisma.db.outboxEvent.create({
      data: {
        messageId: data.messageId ?? randomUUID(),
        routingKey: data.routingKey,
        payload: data.payload as Prisma.InputJsonValue,
        requestId: data.requestId,
      },
    });
  }

  // Khoá hàng PENDING tới hạn để nhiều relay không publish trùng.
  claimPending(limit: number): Promise<OutboxEvent[]> {
    return this.prisma.db.$queryRaw<OutboxEvent[]>`
      SELECT * FROM "OutboxEvent"
      WHERE "status" = 'PENDING' AND "availableAt" <= now()
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
  }

  async markPublished(id: string): Promise<void> {
    await this.prisma.db.outboxEvent.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(Temporal.Now.instant().epochMilliseconds),
      },
    });
  }

  async markFailed(id: string, retryDelayMs: number, maxAttempts: number): Promise<void> {
    const row = await this.prisma.db.outboxEvent.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        availableAt: new Date(
          Temporal.Now.instant().add({ milliseconds: retryDelayMs }).epochMilliseconds,
        ),
      },
    });
    if (row.attempts >= maxAttempts) {
      await this.prisma.db.outboxEvent.update({ where: { id }, data: { status: 'FAILED' } });
    }
  }
}
