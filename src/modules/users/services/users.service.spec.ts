import { Test } from '@nestjs/testing';
import { UserRepository } from '../repositories/user.repository';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: UserRepository, useValue: repo }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('findByEmail delegates to the repository', async () => {
    const user = { id: '1', email: 'a@b.com', password: 'hash', name: null };
    repo.findByEmail.mockResolvedValue(user);
    const result = await service.findByEmail('a@b.com');
    expect(repo.findByEmail).toHaveBeenCalledWith('a@b.com');
    expect(result).toBe(user);
  });

  it('create passes data to the repository', async () => {
    const created = { id: '1', email: 'a@b.com', password: 'hash', name: 'A' };
    repo.create.mockResolvedValue(created);
    const result = await service.create({ email: 'a@b.com', password: 'hash', name: 'A' });
    expect(repo.create).toHaveBeenCalledWith({ email: 'a@b.com', password: 'hash', name: 'A' });
    expect(result).toBe(created);
  });

  it('findOne throws NotFoundException when the user does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toMatchObject({ status: 404 });
    expect(repo.findById).toHaveBeenCalledWith('missing');
  });
});
