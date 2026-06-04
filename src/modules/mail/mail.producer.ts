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

  async enqueue(data: SendMailJob): Promise<string> {
    const job = await this.queue.add('send', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    });
    return job.id as string;
  }
}
