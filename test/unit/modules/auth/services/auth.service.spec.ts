import { AppException } from '@common/exceptions/app.exception';
import { OutboxRepository } from '@core/outbox/outbox.repository.port';
import { TransactionManager } from '@core/prisma/transaction-manager.port';
import { AuthService } from '@modules/auth/services/auth.service';
import { UsersService } from '@modules/users/services/users.service';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  const users = { findByEmail: jest.fn(), create: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
  const outbox = { enqueue: jest.fn() };
  const tx = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: jwt },
        { provide: OutboxRepository, useValue: outbox },
        { provide: TransactionManager, useValue: tx },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('login returns an access token for valid credentials', async () => {
    const hash = await bcrypt.hash('password123', 10);
    users.findByEmail.mockResolvedValue({ id: '1', email: 'a@b.com', password: hash, name: 'A' });
    const result = await service.login({ email: 'a@b.com', password: 'password123' });
    expect(result).toEqual({ accessToken: 'signed.jwt.token' });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: '1', email: 'a@b.com' });
  });

  it('login throws Unauthorized for wrong password', async () => {
    const hash = await bcrypt.hash('password123', 10);
    users.findByEmail.mockResolvedValue({ id: '1', email: 'a@b.com', password: hash, name: 'A' });
    await expect(service.login({ email: 'a@b.com', password: 'wrongpass' })).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('register throws Conflict when the email is already taken', async () => {
    users.findByEmail.mockResolvedValue({ id: '1', email: 'a@b.com', password: 'hash', name: 'A' });
    await expect(
      service.register({ email: 'a@b.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(AppException);
    expect(users.create).not.toHaveBeenCalled();
  });

  it('register hashes the password before creating the user', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.create.mockImplementation((data) => Promise.resolve({ id: '1', ...data }));
    outbox.enqueue.mockResolvedValue(undefined);
    const result = await service.register({ email: 'a@b.com', password: 'password123', name: 'A' });
    const created = users.create.mock.calls[0][0];
    expect(created.email).toBe('a@b.com');
    expect(created.password).not.toBe('password123');
    await expect(bcrypt.compare('password123', created.password)).resolves.toBe(true);
    expect(result.id).toBe('1');
  });
});

describe('AuthService.register', () => {
  let service: AuthService;
  const users = { findByEmail: jest.fn(), create: jest.fn() };
  const jwt = { signAsync: jest.fn() };
  const outbox = { enqueue: jest.fn() };
  const tx = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: jwt },
        { provide: OutboxRepository, useValue: outbox },
        { provide: TransactionManager, useValue: tx },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('tạo user và enqueue outbox user.registered trong cùng transaction', async () => {
    users.findByEmail.mockResolvedValue(null);
    const created = { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.com', name: 'A' };
    users.create.mockResolvedValue(created);

    const result = await service.register({ email: 'a@b.com', password: 'secret12', name: 'A' });

    expect(tx.run).toHaveBeenCalledTimes(1);
    expect(users.create).toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledWith({
      routingKey: 'user.registered',
      payload: { userId: created.id, email: created.email, name: created.name },
    });
    expect(result).toBe(created);
  });
});
