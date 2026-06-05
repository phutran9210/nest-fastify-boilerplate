import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only time HTTP requests; microservice (RMQ) contexts have no request to log.
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest();
    const method = req?.method;
    const url = req?.url;
    const start = Date.now();
    return next
      .handle()
      .pipe(tap(() => this.logger.log(`${method} ${url} - ${Date.now() - start}ms`)));
  }
}
