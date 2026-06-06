import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export interface SendMailJob {
  to: string;
  subject: string;
  body: string;
}

@Injectable()
export class MailProducer {
  constructor(@InjectQueue('mail') private readonly queue: Queue) {}

  async enqueue(data: SendMailJob, jobId?: string): Promise<string> {
    const job = await this.queue.add('send', data, {
      jobId, // = messageId → BullMQ bỏ trùng nếu enqueue lại cùng id
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    });
    return job.id as string;
  }
}
