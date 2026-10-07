import { EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';
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

    it('propagates manager errors without swallowing them', async () => {
      const driverError = Object.assign(new Error('foreign key violation'), {
        code: '23503',
        constraint: 'FK_users_restaurant_id',
      });
      const error = new QueryFailedError('UPDATE users', [], driverError);
      const manager = {
        update: vi.fn().mockRejectedValue(error),
      } as unknown as EntityManager & { update: ReturnType<typeof vi.fn> };

      await expect(
        usersService.assignRestaurantIfNone(userId, restaurantId, manager),
      ).rejects.toBe(error);
    });
  });

  describe('linkFirebaseUid', () => {
    const firebaseUid = 'firebase-uid';
    const originalUser = {
      id: 'user-id',
      firebaseUid: null,
      email: 'owner@example.com',
      role: 'restaurant_admin',
      restaurantId: null,
    } as User;

    function uniqueViolation(constraint: string): QueryFailedError {
      const driverError = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint,
      });
      return new QueryFailedError('UPDATE users', [], driverError);
    }

    it('returns the user found by Firebase UID after a matching unique conflict', async () => {
      const linkedUser = { ...originalUser, firebaseUid } as User;
      usersRepository.save.mockRejectedValueOnce(
        uniqueViolation('UQ_users_firebase_uid'),
      );
      usersRepository.findOneBy.mockResolvedValueOnce(linkedUser);

      await expect(
        usersService.linkFirebaseUid(originalUser, firebaseUid),
      ).resolves.toBe(linkedUser);
      expect(usersRepository.findOneBy).toHaveBeenCalledWith({ firebaseUid });
    });

    it('rethrows the original unique error when no linked user is found', async () => {
      const error = uniqueViolation('UQ_users_firebase_uid');
      usersRepository.save.mockRejectedValueOnce(error);
      usersRepository.findOneBy.mockResolvedValueOnce(null);

      await expect(
        usersService.linkFirebaseUid(originalUser, firebaseUid),
      ).rejects.toBe(error);
    });

    it('rethrows a unique error from a different constraint without searching', async () => {
      const error = uniqueViolation('UQ_users_email');
      usersRepository.save.mockRejectedValueOnce(error);

      await expect(
        usersService.linkFirebaseUid(originalUser, firebaseUid),
      ).rejects.toBe(error);
      expect(usersRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('propagates errors that are not unique violations', async () => {
      const error = new QueryFailedError(
        'UPDATE users',
        [],
        Object.assign(new Error('foreign key violation'), {
          code: '23503',
          constraint: 'FK_users_restaurant_id',
        }),
      );
      usersRepository.save.mockRejectedValueOnce(error);

      await expect(
        usersService.linkFirebaseUid(originalUser, firebaseUid),
      ).rejects.toBe(error);
      expect(usersRepository.findOneBy).not.toHaveBeenCalled();
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
