import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { CoreConfigModule } from './core/config/config.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { HttpExceptionFilter } from './core/filters/http-exception.filter';
import { JwtAuthGuard } from './core/guards/jwt-auth.guard';
import { HealthController } from './core/health/health.controller';

@Module({
  imports: [CoreConfigModule, PrismaModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
