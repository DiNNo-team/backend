import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity.js';
import type { CurrentUserData } from './current-user-data.js';
import { CurrentUserResolver } from './current-user.resolver.js';

export const DEV_USER_HEADER = 'x-dev-user-id';

// Development-only user, until the real authentication (PBI 2) replaces it.
@Injectable()
export class DevUserResolver
  extends CurrentUserResolver
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(DevUserResolver.name);
  private readonly requested: boolean;
  private readonly deployed: boolean;
  private readonly defaultUserId: string | undefined;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    config: ConfigService,
  ) {
    super();
    this.requested = config.get<string>('DEV_USER_ENABLED') === 'true';
    // Render sets RENDER on every service; NODE_ENV covers other deployments.
    this.deployed =
      config.get<string>('RENDER') !== undefined ||
      config.get<string>('NODE_ENV') === 'production';
    this.defaultUserId = config.get<string>('DEV_USER_ID');
  }

  get enabled(): boolean {
    return this.requested && !this.deployed;
  }

  onApplicationBootstrap(): void {
    if (this.enabled) {
      this.logger.warn(
        `Usuario de desarrollo ACTIVO (DEV_USER_ID=${this.defaultUserId ?? 'sin definir'}, cabecera ${DEV_USER_HEADER}). Nunca debe verse en el ambiente desplegado.`,
      );
    } else if (this.requested) {
      this.logger.warn(
        'DEV_USER_ENABLED=true se ignora: el usuario de desarrollo no funciona en el ambiente desplegado.',
      );
    }
  }

  async resolve(request: Request): Promise<CurrentUserData> {
    if (!this.enabled) {
      throw new UnauthorizedException(
        'No hay una sesión activa. Inicia sesión para continuar.',
      );
    }

    const userId = this.parseUserId(
      request.headers[DEV_USER_HEADER] ?? this.defaultUserId,
    );
    const user = await this.users.findOneBy({ id: userId });
    if (!user) {
      throw new UnauthorizedException(
        `No existe el usuario de desarrollo con id ${userId}. Revisa DEV_USER_ID o la cabecera ${DEV_USER_HEADER}.`,
      );
    }

    return {
      userId: user.id,
      restaurantId: user.restaurantId,
      role: user.role,
    };
  }

  private parseUserId(value: string | string[] | undefined): number {
    const userId = typeof value === 'string' ? Number(value.trim()) : NaN;
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new UnauthorizedException(
        `No se pudo identificar el usuario de desarrollo. Define DEV_USER_ID o envía la cabecera ${DEV_USER_HEADER} con un id numérico.`,
      );
    }
    return userId;
  }
}
