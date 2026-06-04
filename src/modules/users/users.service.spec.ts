import { Test } from '@nestjs/testing';
import { PrismaService } from '../../core/prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('findByEmail delegates to prisma.user.findUnique', async () => {
    const user = { id: '1', email: 'a@b.com', password: 'hash', name: null };
    prisma.user.findUnique.mockResolvedValue(user);
    const result = await service.findByEmail('a@b.com');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
    expect(result).toBe(user);
  });

  it('create passes data to prisma.user.create', async () => {
    const created = { id: '1', email: 'a@b.com', password: 'hash', name: 'A' };
    prisma.user.create.mockResolvedValue(created);
    const result = await service.create({ email: 'a@b.com', password: 'hash', name: 'A' });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'a@b.com', password: 'hash', name: 'A' },
    });
    expect(result).toBe(created);
  });

  it('findOne throws NotFoundException when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toMatchObject({ status: 404 });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'missing' } });
  });
});
