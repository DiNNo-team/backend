import { EntityManager, IsNull, Repository } from 'typeorm';
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

  describe('assignRestaurantIfNone', () => {
    const userId = 'user-id';
    const restaurantId = 'restaurant-id';

    function createManager(affected: number) {
      return {
        update: vi.fn().mockResolvedValue({ affected }),
      } as unknown as EntityManager & { update: ReturnType<typeof vi.fn> };
    }

    it('assigns a restaurant when the user has none and returns true', async () => {
      const manager = createManager(1);

      await expect(
        usersService.assignRestaurantIfNone(userId, restaurantId, manager),
      ).resolves.toBe(true);

      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        User,
        { id: userId, restaurantId: IsNull() },
        { restaurantId },
      );
      expect(usersRepository.save).not.toHaveBeenCalled();
    });

    it('returns false and does not overwrite an existing restaurant', async () => {
      const manager = createManager(0);

      await expect(
        usersService.assignRestaurantIfNone(userId, restaurantId, manager),
      ).resolves.toBe(false);

      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        User,
        { id: userId, restaurantId: IsNull() },
        { restaurantId },
      );
    });

    it('returns false when the user does not exist', async () => {
      const manager = createManager(0);

      await expect(
        usersService.assignRestaurantIfNone(userId, restaurantId, manager),
      ).resolves.toBe(false);
      expect(manager.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('create', () => {
    it('creates and persists a user', async () => {
      const input = {
        firebaseUid: 'firebase-uid',
        email: 'owner@example.com',
        role: 'restaurant',
        restaurantId: null,
      };
      const newUser = { ...input } as User;
      const savedUser = { ...newUser, id: 'user-id' } as User;
      usersRepository.create.mockReturnValue(newUser);
      usersRepository.save.mockResolvedValue(savedUser);

      await expect(usersService.create(input)).resolves.toBe(savedUser);
      expect(usersRepository.create).toHaveBeenCalledWith(input);
      expect(usersRepository.save).toHaveBeenCalledWith(newUser);
    });

    it('propagates persistence errors', async () => {
      const input = {
        firebaseUid: 'firebase-uid',
        email: 'owner@example.com',
        role: 'restaurant',
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
        role: 'restaurant',
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
