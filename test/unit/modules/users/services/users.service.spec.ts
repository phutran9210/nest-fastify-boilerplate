import { UserRepository } from '@modules/users/repositories/user.repository.port';
import { UsersService } from '@modules/users/services/users.service';
import { Test } from '@nestjs/testing';

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<Pick<UserRepository, 'findById' | 'findAll' | 'count'>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    repo = { findById: jest.fn(), findAll: jest.fn(), count: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: UserRepository, useValue: repo }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('findAll returns items + total with pagination', async () => {
    const items = [{ id: 'u1' }] as never;
    repo.findAll.mockResolvedValue(items);
    repo.count.mockResolvedValue(1);
    await expect(service.findAll({ page: 2, limit: 10 })).resolves.toEqual({ items, total: 1 });
    expect(repo.findAll).toHaveBeenCalledWith({ skip: 10, take: 10 });
  });

  it('findOne returns the user when found', async () => {
    const user = { id: 'u1' } as never;
    repo.findById.mockResolvedValue(user);
    await expect(service.findOne('u1')).resolves.toBe(user);
  });

  it('findOne throws when missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow();
  });
});
