import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
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
});
