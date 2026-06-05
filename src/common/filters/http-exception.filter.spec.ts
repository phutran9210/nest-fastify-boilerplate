import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { HttpExceptionFilter } from './http-exception.filter';

function host(req: unknown, res: unknown) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as never;
}

describe('HttpExceptionFilter', () => {
  const config = { get: jest.fn().mockReturnValue('test') } as never;
  let filter: HttpExceptionFilter;
  let res: { status: jest.Mock; send: jest.Mock; header: jest.Mock };
  const req = { id: 'req-1', url: '/users' };

  const body = () => res.send.mock.calls[0][0];

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new HttpExceptionFilter(config);
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

  it('flattens ZodValidationException issues into error.details with VALIDATION_ERROR code', () => {
    const zodError = new ZodError([
      { code: 'custom', path: ['email'], message: 'Invalid email' } as never,
    ]);
    filter.catch(new ZodValidationException(zodError), host(req, res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(body().error.code).toBe('VALIDATION_ERROR');
    expect(body().error.details).toEqual([{ field: 'email', message: 'Invalid email' }]);
  });

  it('maps a plain BadRequestException (non-validation 400) to BAD_REQUEST without details', () => {
    filter.catch(new BadRequestException('Bad input'), host(req, res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(body().error.code).toBe('BAD_REQUEST');
    expect(body().error.details).toBeUndefined();
  });

  it('maps unknown errors to 500 / INTERNAL_ERROR', () => {
    filter.catch(new Error('boom'), host(req, res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(body().error.code).toBe('INTERNAL_ERROR');
  });

  it('hides the unknown-error message in production', () => {
    (config as { get: jest.Mock }).get.mockReturnValue('production');
    filter.catch(new Error('secret detail'), host(req, res));
    expect(body().error.message).toBe('Internal server error');
  });

  it('maps ZodSerializationException to 500 / INTERNAL_ERROR, logs server-side, no leaked details', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const zodError = new ZodError([
      { code: 'custom', path: ['createdAt'], message: 'Expected string' } as never,
    ]);
    filter.catch(new ZodSerializationException(zodError), host(req, res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(body().error.code).toBe('INTERNAL_ERROR');
    expect(body().error.message).toBe('Internal server error');
    expect(body().error.details).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('includes ISO timestamp, request path, and requestId in meta', () => {
    filter.catch(new NotFoundException('x'), host(req, res));
    expect(body().meta.path).toBe('/users');
    expect(body().meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body().meta.requestId).toBe('req-1');
  });
});
