import type { Request } from 'express';
import type { CurrentUserData } from './current-user-data.js';

// Swap point: today DevUserResolver, later the real authentication provider.
// Must throw UnauthorizedException when there is no resolvable user.
export abstract class CurrentUserResolver {
  abstract resolve(request: Request): Promise<CurrentUserData>;
}
