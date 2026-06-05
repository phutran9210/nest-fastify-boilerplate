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
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { ErrorCode, statusToErrorCode } from '../errors/error-code';
import type { ErrorDetail, ErrorResponse } from '../http/response.types';

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

  constructor(private readonly config: ConfigService) {}

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
    // Most codes derive from the HTTP status, but a few branches (validation) need an explicit
    // code that differs from the status default (400 -> BAD_REQUEST vs VALIDATION_ERROR).
    let code: string | undefined;

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
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCode.VALIDATION_ERROR;
      message = 'Validation failed';
      const zodError = exception.getZodError();
      if (zodError instanceof ZodError) {
        details = zodError.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
      }
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
        code: code ?? statusToErrorCode(status),
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
