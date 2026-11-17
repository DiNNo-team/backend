import { ApiProperty } from '@nestjs/swagger';
import {
  RESTAURANT_APPROVAL_STATUSES,
  SUSPENDED,
  type RestaurantApprovalStatus,
} from '../../../identity-access/index.js';
import type { Restaurant } from '../restaurant.entity.js';

// Open/closed state of the session restaurant (PBI 8), answered by both the
// GET and the PATCH of /v1/restaurants/me/status. Since the admin panel
// (Sprint 4) it also carries the approval state and, while suspended, the
// reason (additive: isOpen does not change).
export class RestaurantStatusResponseDto {
  @ApiProperty({
    description: 'true = Abierto, false = Cerrado.',
    example: true,
  })
  isOpen: boolean;

  @ApiProperty({
    description:
      'Estado de aprobación: pending, approved, rejected o suspended (suspendido por DiNNo).',
    enum: RESTAURANT_APPROVAL_STATUSES,
    example: 'approved',
  })
  approvalStatus: RestaurantApprovalStatus;

  @ApiProperty({
    description:
      'Motivo de la suspensión. Solo mientras está suspendido; si no, null.',
    type: String,
    nullable: true,
    example: null,
  })
  suspensionReason: string | null;

  static fromEntity(restaurant: Restaurant): RestaurantStatusResponseDto {
    return {
      isOpen: restaurant.isOpen,
      approvalStatus: restaurant.approvalStatus,
      suspensionReason:
        restaurant.approvalStatus === SUSPENDED
          ? (restaurant.suspensionReason ?? null)
          : null,
    };
  }
}
