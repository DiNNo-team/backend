import type { DataSource } from 'typeorm';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import type { CurrentUserData } from '../current-user/current-user-data.js';
import { registeredIdentity } from '../current-user/registered-identity.js';
import {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_ERROR_MESSAGES,
} from '../roles/account-errors.js';
import { USER_ROLES, UserRole } from '../roles/user-role.js';
import type { User } from '../users/user.entity.js';
import { RestaurantApprovalReader } from './restaurant-approval.reader.js';
import { RESTAURANT_APPROVAL_STATUSES } from './restaurant-approval-status.js';
import { unapprovedCode } from './unapproved-code.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';

function user(role: UserRole, restaurantId: string | null): User {
  return { id: 'user-id', role, restaurantId } as User;
}

function readerReturning(status: string | null) {
  const findOne = vi
    .fn()
    .mockResolvedValue(status === null ? null : { approvalStatus: status });
  const getRepository = vi.fn(() => ({ findOne }));
  const reader = new RestaurantApprovalReader({
    getRepository,
  } as unknown as DataSource);
  return { reader, findOne, getRepository };
}

// Swagger metadata of ErrorResponseDto.errorCode: the closed list of codes.
function documentedErrorCodes(): string[] {
  const properties = Reflect.getMetadata(
    'swagger/apiModelPropertiesArray',
    ErrorResponseDto.prototype,
  ) as string[] | undefined;
  expect(properties).toContain(':errorCode');
  const metadata = Reflect.getMetadata(
    'swagger/apiModelProperties',
    ErrorResponseDto.prototype,
    'errorCode',
  ) as { enum: string[] };
  return metadata.enum;
}

describe('restaurant approval constants', () => {
  it('has exactly the three approval states', () => {
    expect(RESTAURANT_APPROVAL_STATUSES).toEqual([
      'pending',
      'approved',
      'rejected',
    ]);
  });

  it('adds platform_admin to the account roles', () => {
    expect(USER_ROLES).toEqual(['restaurant_admin', 'diner', 'platform_admin']);
  });

  it('has the three new account codes with their contract texts', () => {
    expect(ACCOUNT_ERROR_MESSAGES).toMatchObject({
      ACCOUNT_PENDING_APPROVAL:
        'Tu solicitud está en revisión. Te avisaremos cuando tu cuenta esté aprobada.',
      ACCOUNT_REJECTED:
        'Tu solicitud no fue aprobada. Revisa el motivo, corrige tus datos y vuelve a enviarla.',
      ADMIN_ACCOUNT:
        'Esta es una cuenta de administrador de DiNNo. Usa el panel de administración en la web.',
    });
  });

  it('documents every account code in the closed errorCode enum of the API', () => {
    const documented = documentedErrorCodes();

    for (const code of ACCOUNT_ERROR_CODES) {
      expect(documented).toContain(code);
    }
  });
});

describe('unapprovedCode', () => {
  const owner = (
    restaurantApproval: CurrentUserData['restaurantApproval'],
  ): CurrentUserData => ({
    userId: 'u',
    restaurantId: RESTAURANT_ID,
    role: UserRole.RESTAURANT_ADMIN,
    restaurantApproval,
  });

  it.each([
    ['approved', null],
    ['pending', 'ACCOUNT_PENDING_APPROVAL'],
    ['rejected', 'ACCOUNT_REJECTED'],
  ] as const)('a restaurant %s → %s', (status, expected) => {
    expect(unapprovedCode(owner(status))).toBe(expected);
  });

  it('is null for a restaurant_admin without a restaurant, a diner and a DiNNo admin', () => {
    expect(unapprovedCode({ ...owner(null), restaurantId: null })).toBeNull();
    expect(
      unapprovedCode({
        userId: 'u',
        restaurantId: null,
        role: UserRole.DINER,
        restaurantApproval: null,
      }),
    ).toBeNull();
    expect(
      unapprovedCode({
        userId: 'u',
        restaurantId: null,
        role: UserRole.PLATFORM_ADMIN,
        restaurantApproval: null,
      }),
    ).toBeNull();
  });
});

describe('RestaurantApprovalReader', () => {
  it('reads only approval_status of the restaurant, by entity name and id', async () => {
    const { reader, findOne, getRepository } = readerReturning('pending');

    await expect(reader.statusOf(RESTAURANT_ID)).resolves.toBe('pending');
    expect(getRepository).toHaveBeenCalledWith('Restaurant');
    expect(findOne).toHaveBeenCalledWith({
      where: { id: RESTAURANT_ID },
      select: { approvalStatus: true },
    });
  });

  it('throws (500 by the global filter) when the restaurant is missing', async () => {
    const { reader } = readerReturning(null);

    await expect(reader.statusOf(RESTAURANT_ID)).rejects.toThrow(
      `Restaurant ${RESTAURANT_ID} of the session user not found`,
    );
  });
});

describe('registeredIdentity', () => {
  it('loads the approval of a restaurant_admin with a restaurant', async () => {
    const approvals = { statusOf: vi.fn().mockResolvedValue('rejected') };

    await expect(
      registeredIdentity(
        user(UserRole.RESTAURANT_ADMIN, RESTAURANT_ID),
        approvals as unknown as RestaurantApprovalReader,
      ),
    ).resolves.toEqual({
      kind: 'registered',
      user: {
        userId: 'user-id',
        restaurantId: RESTAURANT_ID,
        role: UserRole.RESTAURANT_ADMIN,
        restaurantApproval: 'rejected',
      },
    });
    expect(approvals.statusOf).toHaveBeenCalledWith(RESTAURANT_ID);
  });

  it.each([
    [
      'a restaurant_admin without a restaurant',
      user(UserRole.RESTAURANT_ADMIN, null),
    ],
    ['a diner', user(UserRole.DINER, null)],
    ['a DiNNo admin', user(UserRole.PLATFORM_ADMIN, null)],
  ])('does not query anything for %s', async (_case, row) => {
    const approvals = { statusOf: vi.fn() };

    const identity = await registeredIdentity(
      row,
      approvals as unknown as RestaurantApprovalReader,
    );

    expect(
      identity.kind === 'registered' && identity.user.restaurantApproval,
    ).toBeNull();
    expect(approvals.statusOf).not.toHaveBeenCalled();
  });
});
