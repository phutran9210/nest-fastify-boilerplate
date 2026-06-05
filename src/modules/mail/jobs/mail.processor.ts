import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { SendMailJob } from './mail.producer';

@Processor('mail')
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  async process(job: Job<SendMailJob>): Promise<{ delivered: boolean }> {
    this.logger.log(`Sending mail to ${job.data.to}: ${job.data.subject}`);
    return { delivered: true };
  }
}
