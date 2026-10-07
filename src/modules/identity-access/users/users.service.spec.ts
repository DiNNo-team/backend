import { Repository } from 'typeorm';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  const usersRepository = {
    findOneBy: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
  };
  let usersService: UsersService;

  beforeEach(() => {
    vi.resetAllMocks();
    usersService = new UsersService(
      usersRepository as unknown as Repository<User>,
    );
  });

  describe('findByFirebaseUid', () => {
    it('returns the user matching the Firebase UID', async () => {
      const user = { firebaseUid: 'firebase-uid' } as User;
      usersRepository.findOneBy.mockResolvedValue(user);

      await expect(
        usersService.findByFirebaseUid('firebase-uid'),
      ).resolves.toBe(user);
      expect(usersRepository.findOneBy).toHaveBeenCalledWith({
        firebaseUid: 'firebase-uid',
      });
    });

    it('returns null when no user matches the Firebase UID', async () => {
      usersRepository.findOneBy.mockResolvedValue(null);

      await expect(
        usersService.findByFirebaseUid('missing-uid'),
      ).resolves.toBeNull();
    });

    it('propagates repository errors', async () => {
      const error = new Error('Database failure');
      usersRepository.findOneBy.mockRejectedValue(error);

      await expect(usersService.findByFirebaseUid('firebase-uid')).rejects.toBe(
        error,
      );
    });
  });

  describe('findByEmail', () => {
    it('normalizes the email before searching', async () => {
      usersRepository.findOneBy.mockResolvedValue(null);

      await expect(
        usersService.findByEmail('  Owner@Example.COM  '),
      ).resolves.toBeNull();
      expect(usersRepository.findOneBy).toHaveBeenCalledWith({
        email: 'owner@example.com',
      });
    });
  });

  describe('findById', () => {
    it('returns the user matching the id', async () => {
      const user = { id: 'user-id' } as User;
      usersRepository.findOneBy.mockResolvedValue(user);

      await expect(usersService.findById('user-id')).resolves.toBe(user);
      expect(usersRepository.findOneBy).toHaveBeenCalledWith({ id: 'user-id' });
    });

    it('returns null when no user matches the id', async () => {
      usersRepository.findOneBy.mockResolvedValue(null);

      await expect(usersService.findById('missing-id')).resolves.toBeNull();
    });

    it('propagates repository errors', async () => {
      const error = new Error('Database failure');
      usersRepository.findOneBy.mockRejectedValue(error);

      await expect(usersService.findById('user-id')).rejects.toBe(error);
    });
  });

  describe('create', () => {
    it('creates and persists a user', async () => {
      const input = {
        firebaseUid: 'firebase-uid',
        email: '  Owner@Example.COM  ',
        role: 'restaurant_admin',
        restaurantId: null,
      };
      const newUser = { ...input, email: 'owner@example.com' } as User;
      const savedUser = { ...newUser, id: 'user-id' } as User;
      usersRepository.create.mockReturnValue(newUser);
      usersRepository.save.mockResolvedValue(savedUser);

      await expect(usersService.create(input)).resolves.toBe(savedUser);
      expect(usersRepository.create).toHaveBeenCalledWith({
        ...input,
        email: 'owner@example.com',
      });
      expect(usersRepository.save).toHaveBeenCalledWith(newUser);
    });

    it('propagates persistence errors', async () => {
      const input = {
        firebaseUid: 'firebase-uid',
        email: 'owner@example.com',
        role: 'restaurant_admin',
        restaurantId: null,
      };
      const error = new Error('Unique constraint violation');
      usersRepository.create.mockReturnValue(input);
      usersRepository.save.mockRejectedValue(error);

      await expect(usersService.create(input)).rejects.toBe(error);
    });

    it('does not persist unexpected input fields', async () => {
      const input = {
        firebaseUid: 'firebase-uid',
        email: 'owner@example.com',
        role: 'restaurant_admin',
        restaurantId: null,
        unexpected: 'must not be persisted',
      };
      const persistedFields = {
        firebaseUid: input.firebaseUid,
        email: input.email,
        role: input.role,
        restaurantId: input.restaurantId,
      };
      const user = persistedFields as User;
      usersRepository.create.mockReturnValue(user);
      usersRepository.save.mockResolvedValue(user);

      await usersService.create(input);

      expect(usersRepository.create).toHaveBeenCalledWith(persistedFields);
      expect(usersRepository.save).toHaveBeenCalledWith(persistedFields);
    });
  });
});
