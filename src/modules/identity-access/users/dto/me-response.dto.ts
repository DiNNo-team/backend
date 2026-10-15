import { ApiProperty } from '@nestjs/swagger';
import { USER_ROLES, UserRole } from '../../roles/user-role.js';
import type { User } from '../user.entity.js';

// The session account, as GET /v1/me and POST /v1/diners/me answer it.
export class MeResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718',
  })
  id: string;

  @ApiProperty({ example: 'ana@example.com' })
  email: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Ana',
    description:
      'Nombre para mostrar (comensales). null en cuentas de restaurante: la app muestra la parte del correo antes de @.',
  })
  displayName: string | null;

  @ApiProperty({
    enum: USER_ROLES,
    example: UserRole.DINER,
    description:
      'restaurant_admin = restaurante (solo web), diner = comensal (solo app).',
  })
  role: UserRole;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description:
      'Restaurante del usuario; null en comensales y en restaurantes que todavía no lo registran.',
  })
  restaurantId: string | null;

  static fromUser(user: User): MeResponseDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      restaurantId: user.restaurantId,
    };
  }
}
