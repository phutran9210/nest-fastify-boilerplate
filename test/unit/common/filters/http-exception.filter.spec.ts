import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { AppException } from '@common/exceptions/app.exception';
import { HttpExceptionFilter } from '@common/filters/http-exception.filter';

function host(req: unknown, res: unknown) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as never;
}

describe('HttpExceptionFilter', () => {
  const config = { get: jest.fn().mockReturnValue('test') } as never;
  const i18n = { translate: jest.fn((key: string) => `translated:${key}`) };
  let filter: HttpExceptionFilter;
  let res: { status: jest.Mock; send: jest.Mock; header: jest.Mock };
  const req = { id: 'req-1', url: '/users' };

  const body = () => res.send.mock.calls[0][0];

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new HttpExceptionFilter(config, i18n as never);
    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      header: jest.fn(),
    };
  });

  it('maps NotFoundException to 404 / NOT_FOUND', () => {
    filter.catch(new NotFoundException('User 1 not found'), host(req, res));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body().success).toBe(false);
    expect(body().error.code).toBe('NOT_FOUND');
    expect(body().error.message).toBe('User 1 not found');
    expect(body().meta.requestId).toBe('req-1');
    expect(res.header).toHaveBeenCalledWith('x-request-id', 'req-1');
  });

  it('maps ConflictException to 409 / CONFLICT', () => {
    filter.catch(new ConflictException('Email taken'), host(req, res));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body().error.code).toBe('CONFLICT');
  });

  it('flattens ZodValidationException issues into error.details with 422 / UNPROCESSABLE_ENTITY', () => {
    const zodError = new ZodError([
      { code: 'custom', path: ['email'], message: 'Invalid email' } as never,
    ]);
    filter.catch(new ZodValidationException(zodError), host(req, res));
    expect(res.status).toHaveBeenCalledWith(422);
    expect(body().error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(body().error.details).toEqual([{ field: 'email', message: 'Invalid email' }]);
  });

  it('maps a plain BadRequestException (non-validation 400) to BAD_REQUEST without details', () => {
    filter.catch(new BadRequestException('Bad input'), host(req, res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(body().error.code).toBe('BAD_REQUEST');
    expect(body().error.details).toBeUndefined();
  });

  it('maps unknown errors to 500 / INTERNAL_SERVER_ERROR', () => {
    filter.catch(new Error('boom'), host(req, res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(body().error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('hides the unknown-error message in production', () => {
    (config as { get: jest.Mock }).get.mockReturnValue('production');
    filter.catch(new Error('secret detail'), host(req, res));
    expect(body().error.message).toBe('Internal server error');
  });

  it('maps ZodSerializationException to 500 / INTERNAL_SERVER_ERROR, logs server-side, no leaked details', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const zodError = new ZodError([
      { code: 'custom', path: ['createdAt'], message: 'Expected string' } as never,
    ]);
    filter.catch(new ZodSerializationException(zodError), host(req, res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(body().error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body().error.message).toBe('Internal server error');
    expect(body().error.details).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('translates an AppException messageKey via I18nService and keeps status-derived code', () => {
    filter.catch(
      new AppException('users.NOT_FOUND', HttpStatus.NOT_FOUND, { id: '1' }),
      host(req, res),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body().error.code).toBe('NOT_FOUND');
    expect(body().error.message).toBe('translated:users.NOT_FOUND');
    expect(i18n.translate).toHaveBeenCalledWith(
      'users.NOT_FOUND',
      expect.objectContaining({ args: { id: '1' } }),
    );
  });

  it('uses AppException.code override when provided', () => {
    filter.catch(
      new AppException('auth.EMAIL_TAKEN', HttpStatus.CONFLICT, undefined, 'EMAIL_TAKEN'),
      host(req, res),
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body().error.code).toBe('EMAIL_TAKEN');
  });

  it('includes ISO timestamp, request path, and requestId in meta', () => {
    filter.catch(new NotFoundException('x'), host(req, res));
    expect(body().meta.path).toBe('/users');
    expect(body().meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body().meta.requestId).toBe('req-1');
  });
});
