import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  PAGE_INVALID,
  pageSizeInvalid,
} from '../../../../common/dto/page-query.js';
import {
  ADMIN_PAGE_SIZE_MAX,
  AdminRestaurantsQueryDto,
  APPROVAL_STATUS_INVALID,
} from './admin-restaurants-query.dto.js';
import {
  REJECTION_REASON_INVALID,
  RejectRestaurantDto,
} from './reject-restaurant.dto.js';
import {
  SUSPENSION_REASON_INVALID,
  SuspendRestaurantDto,
} from './suspend-restaurant.dto.js';

async function messagesOf<T extends object>(
  type: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, plain));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('SuspendRestaurantDto', () => {
  it('accepts a reason of 10 to 300 characters and trims it', async () => {
    const dto = plainToInstance(SuspendRestaurantDto, {
      reason: '   Reportes de mesas falsas.  ',
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.reason).toBe('Reportes de mesas falsas.');
    expect(
      await messagesOf(SuspendRestaurantDto, { reason: 'a'.repeat(300) }),
    ).toEqual([]);
  });

  it.each([
    ['missing', {}],
    ['not text', { reason: 1234567890 }],
    ['only spaces', { reason: '                 ' }],
    ['9 characters after trimming', { reason: '  123456789  ' }],
    ['301 characters', { reason: 'a'.repeat(301) }],
  ])('rejects a reason %s', async (_case, plain) => {
    expect(new Set(await messagesOf(SuspendRestaurantDto, plain))).toEqual(
      new Set([SUSPENSION_REASON_INVALID]),
    );
  });
});

describe('RejectRestaurantDto', () => {
  it('accepts a reason of 10 to 300 characters and trims it', async () => {
    const dto = plainToInstance(RejectRestaurantDto, {
      reason: '   Faltan datos.  ',
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.reason).toBe('Faltan datos.');
  });

  it.each([
    ['missing', {}],
    ['not text', { reason: 1234567890 }],
    ['only spaces', { reason: '                 ' }],
    ['9 characters after trimming', { reason: '  123456789  ' }],
    ['301 characters', { reason: 'a'.repeat(301) }],
    ['null', { reason: null }],
  ])(
    'rejects a reason that is %s, with the message in Spanish',
    async (_, body) => {
      const messages = await messagesOf(RejectRestaurantDto, body);

      expect(messages.length).toBeGreaterThan(0);
      expect(new Set(messages)).toEqual(new Set([REJECTION_REASON_INVALID]));
    },
  );

  it('accepts exactly 10 and exactly 300 characters', async () => {
    expect(
      await messagesOf(RejectRestaurantDto, { reason: 'a'.repeat(10) }),
    ).toEqual([]);
    expect(
      await messagesOf(RejectRestaurantDto, { reason: 'a'.repeat(300) }),
    ).toEqual([]);
  });
});

describe('AdminRestaurantsQueryDto', () => {
  it('everything is optional', async () => {
    expect(await messagesOf(AdminRestaurantsQueryDto, {})).toEqual([]);
  });

  it('turns page and pageSize into numbers', async () => {
    const dto = plainToInstance(AdminRestaurantsQueryDto, {
      status: 'rejected',
      page: '2',
      pageSize: '100',
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto).toEqual({ status: 'rejected', page: 2, pageSize: 100 });
  });

  it('rejects an unknown status', async () => {
    expect(
      await messagesOf(AdminRestaurantsQueryDto, { status: 'archived' }),
    ).toEqual([APPROVAL_STATUS_INVALID]);
  });

  it('accepts the suspended restaurants (panel del administrador)', async () => {
    expect(
      await messagesOf(AdminRestaurantsQueryDto, { status: 'suspended' }),
    ).toEqual([]);
  });

  it.each(['0', '-1', '1.5', '', '0x10', '1e1', 'abc'])(
    'rejects page %j',
    async (page) => {
      expect(
        new Set(await messagesOf(AdminRestaurantsQueryDto, { page })),
      ).toEqual(new Set([PAGE_INVALID]));
    },
  );

  it.each(['0', '101', '2.5', ''])('rejects pageSize %j', async (pageSize) => {
    expect(
      new Set(await messagesOf(AdminRestaurantsQueryDto, { pageSize })),
    ).toEqual(new Set([pageSizeInvalid(ADMIN_PAGE_SIZE_MAX)]));
  });
});
