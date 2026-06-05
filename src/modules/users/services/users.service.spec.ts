import { AppException } from '@common/exceptions/app.exception';
import { Test } from '@nestjs/testing';
import { UserRepository } from '../repositories/user.repository.port';
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
    count: jest.fn(),
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

  it('findOne throws AppException(404) when the user does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(AppException);
    await expect(service.findOne('missing')).rejects.toMatchObject({ status: 404 });
    expect(repo.findById).toHaveBeenCalledWith('missing');
  });

  it('findAll returns items + total and translates page/limit into skip/take', async () => {
    const items = [{ id: '1', email: 'a@b.com', password: 'hash', name: null }];
    repo.findAll.mockResolvedValue(items);
    repo.count.mockResolvedValue(57);
    const result = await service.findAll({ page: 3, limit: 10 });
    expect(repo.findAll).toHaveBeenCalledWith({ skip: 20, take: 10 });
    expect(repo.count).toHaveBeenCalled();
    expect(result).toEqual({ items, total: 57 });
  });

  it('update delegates to the repository after confirming the user exists', async () => {
    const existing = { id: '1', email: 'a@b.com', password: 'hash', name: null };
    const updated = { ...existing, name: 'B' };
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue(updated);
    const result = await service.update('1', { name: 'B' });
    expect(repo.findById).toHaveBeenCalledWith('1');
    expect(repo.update).toHaveBeenCalledWith('1', { name: 'B' });
    expect(result).toBe(updated);
  });

  it('update throws NotFoundException and does not write when the user is missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.update('missing', { name: 'B' })).rejects.toBeInstanceOf(AppException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('remove delegates to the repository after confirming the user exists', async () => {
    const existing = { id: '1', email: 'a@b.com', password: 'hash', name: null };
    repo.findById.mockResolvedValue(existing);
    repo.delete.mockResolvedValue(existing);
    const result = await service.remove('1');
    expect(repo.findById).toHaveBeenCalledWith('1');
    expect(repo.delete).toHaveBeenCalledWith('1');
    expect(result).toBe(existing);
  });

  it('remove throws NotFoundException and does not delete when the user is missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toBeInstanceOf(AppException);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
