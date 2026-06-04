import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { CoreConfigModule } from './core/config/config.module';
import { HttpExceptionFilter } from './core/filters/http-exception.filter';
import { JwtAuthGuard } from './core/guards/jwt-auth.guard';
import { HealthController } from './core/health/health.controller';
import { LoggingInterceptor } from './core/interceptors/logging.interceptor';
import { MessagingModule } from './core/messaging/messaging.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { QueueModule } from './core/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationsModule } from './modules/messaging/consumer/notifications.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    CoreConfigModule,
    PrismaModule,
    QueueModule,
    MessagingModule,
    UsersModule,
    AuthModule,
    MailModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
