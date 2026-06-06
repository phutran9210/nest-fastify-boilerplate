import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { SendMailJob } from './mail.producer';

// Concurrency cho worker mail. Đọc process.env trực tiếp vì ConfigService chưa khả dụng lúc
// decorate class (ngoại lệ có chủ đích). Giá trị không hợp lệ/không dương → fallback 5 (Zod
// cũng chặn ở boot; đây là phòng vệ cho thời điểm decoration chạy trước khi env được validate).
// Concurrency chỉ vô hiệu khi nhiều consumer cùng 1 queue; ở đây mỗi queue 1 consumer.
export function mailWorkerConcurrency(): number {
  const n = Number(process.env.MAIL_WORKER_CONCURRENCY);
  return Number.isInteger(n) && n > 0 ? n : 5;
}

@Processor('mail', { concurrency: mailWorkerConcurrency() })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  async process(job: Job<SendMailJob>): Promise<{ delivered: boolean }> {
    this.logger.log(`Sending mail to ${job.data.to}: ${job.data.subject}`);
    return { delivered: true };
  }
}
