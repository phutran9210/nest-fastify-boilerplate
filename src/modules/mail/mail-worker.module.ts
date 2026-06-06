import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailProcessor } from './jobs/mail.processor';

// Phía worker của feature mail: đăng ký queue (để Bull Board introspect được), gắn queue
// vào Bull Board, và chạy processor. KHÔNG import PrismaModule — MailProcessor không dùng DB.
@Module({
  imports: [
    BullModule.registerQueue({ name: 'mail' }),
    BullBoardModule.forFeature({ name: 'mail', adapter: BullMQAdapter }),
  ],
  providers: [MailProcessor],
})
export class MailWorkerModule {}
