import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { SendMailJob } from './mail.producer';

// Đối số thứ 2 là WorkerOptions của BullMQ. Đọc process.env trực tiếp vì ConfigService
// chưa khả dụng lúc decorate class (ngoại lệ có chủ đích — giống các nơi cần config tại
// thời điểm decoration). Concurrency chỉ vô hiệu khi nhiều consumer cùng 1 queue; ở đây 1.
@Processor('mail', { concurrency: Number(process.env.MAIL_WORKER_CONCURRENCY ?? 5) })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  async process(job: Job<SendMailJob>): Promise<{ delivered: boolean }> {
    this.logger.log(`Sending mail to ${job.data.to}: ${job.data.subject}`);
    return { delivered: true };
  }
}
