import { UsersService } from '@modules/users/services/users.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  const users = { findByEmail: jest.fn(), create: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: jwt },
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
      UnauthorizedException,
    );
  });

  it('register throws Conflict when the email is already taken', async () => {
    users.findByEmail.mockResolvedValue({ id: '1', email: 'a@b.com', password: 'hash', name: 'A' });
    await expect(
      service.register({ email: 'a@b.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users.create).not.toHaveBeenCalled();
  });

  it('register hashes the password before creating the user', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.create.mockImplementation((data) => Promise.resolve({ id: '1', ...data }));
    const result = await service.register({ email: 'a@b.com', password: 'password123', name: 'A' });
    const created = users.create.mock.calls[0][0];
    expect(created.email).toBe('a@b.com');
    expect(created.password).not.toBe('password123');
    await expect(bcrypt.compare('password123', created.password)).resolves.toBe(true);
    expect(result.id).toBe('1');
  });
});
