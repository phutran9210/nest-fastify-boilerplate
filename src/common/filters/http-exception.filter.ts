import type { I18nTranslations } from '@generated/i18n.generated';
import { Temporal } from '@js-temporal/polyfill';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { AppException } from '../exceptions/app.exception';
import type { ErrorDetail, ErrorResponse } from '../http/response.types';

// Machine-readable code = tên hằng của Nest HttpStatus (reverse-mapping numeric enum).
// vd 404 -> 'NOT_FOUND', 422 -> 'UNPROCESSABLE_ENTITY'. Status lạ -> 'HTTP_<status>'.
function codeFromStatus(status: number): string {
  return HttpStatus[status] ?? `HTTP_${status}`;
}

// Pull a human-readable message out of a Nest HttpException (body can be a string or an
// object with a string/array `message`).
function extractMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  if (response && typeof response === 'object' && 'message' in response) {
    const message = (response as { message: unknown }).message;
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return exception.message;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly i18n: I18nService<I18nTranslations>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // Non-HTTP (RMQ) contexts have no reply to write; let the transport handle it.
    if (host.getType() !== 'http') {
      throw exception;
    }

    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const requestId = String(req?.id ?? '');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: ErrorDetail[] | undefined;
    let codeOverride: string | undefined;

    if (exception instanceof ZodSerializationException) {
      // Response did not match its DTO — a server bug. Log it; never leak details to the client.
      const zodError = exception.getZodError();
      if (zodError instanceof ZodError) {
        this.logger.error(`ZodSerializationException: ${zodError.message}`);
      }
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
    } else if (exception instanceof ZodValidationException) {
      // Must be checked before HttpException — ZodValidationException extends BadRequestException.
      // Báo 422 UNPROCESSABLE_ENTITY: code suy ra từ status, tách biệt với 400 BAD_REQUEST chung.
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      message = 'Validation failed';
      const zodError = exception.getZodError();
      if (zodError instanceof ZodError) {
        details = zodError.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
      }
    } else if (exception instanceof AppException) {
      status = exception.getStatus();
      message = this.i18n.translate(exception.messageKey, {
        lang: I18nContext.current()?.lang,
        args: exception.args,
      });
      codeOverride = exception.code;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = extractMessage(exception);
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message =
        this.config.get('NODE_ENV') === 'production'
          ? 'Internal server error'
          : exception instanceof Error
            ? exception.message
            : String(exception);
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
      );
    }

    const responseBody: ErrorResponse = {
      success: false,
      error: {
        code: codeOverride ?? codeFromStatus(status),
        message,
        ...(details ? { details } : {}),
      },
      meta: {
        timestamp: Temporal.Now.instant().toString({ smallestUnit: 'millisecond' }),
        path: req?.url ?? '',
        requestId,
      },
    };

    if (requestId && typeof res.header === 'function') {
      res.header('x-request-id', requestId);
    }
    res.status(status).send(responseBody);
  }
}
