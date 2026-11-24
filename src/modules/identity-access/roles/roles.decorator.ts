import {
  applyDecorators,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from './roles.guard.js';
import type { UserRole } from './user-role.js';

export const ROLES_METADATA = 'identity-access:roles';

export function Roles(...roles: UserRole[]) {
  return applyDecorators(
    SetMetadata(ROLES_METADATA, roles),
    UseGuards(RolesGuard),
  );
}