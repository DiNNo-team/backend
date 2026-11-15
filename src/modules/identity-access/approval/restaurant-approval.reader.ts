import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { RestaurantApprovalStatus } from './restaurant-approval-status.js';

// Column read from the Restaurant entity of restaurant-operations, by entity
// name and read only (the same exception search-availability uses): this
// module cannot import restaurant-operations, which already imports it.
interface ApprovalRow {
  approvalStatus: RestaurantApprovalStatus;
}

// Approval status of the session user's restaurant. One read by primary key,
// only for a restaurant_admin with a restaurant (registered-identity.ts).
// The e2e tests replace it with .overrideProvider(RestaurantApprovalReader).
@Injectable()
export class RestaurantApprovalReader {
  constructor(private readonly dataSource: DataSource) {}

  async statusOf(restaurantId: string): Promise<RestaurantApprovalStatus> {
    const row = await this.dataSource
      .getRepository<ApprovalRow & { id: string }>('Restaurant')
      .findOne({
        where: { id: restaurantId },
        select: { approvalStatus: true },
      });
    if (!row) {
      // users.restaurant_id has a foreign key to restaurants: with valid data
      // this cannot happen. The global filter logs it and answers the 500.
      throw new Error(
        `Restaurant ${restaurantId} of the session user not found`,
      );
    }
    return row.approvalStatus;
  }
}
