import type { Request } from 'express';
import type { CurrentUserData } from './current-user-data.js';

// IdentityAccessModule selects the local dev resolver or Firebase authentication.
// Must throw UnauthorizedException when there is no resolvable user.
export abstract class CurrentUserResolver {
  abstract resolve(request: Request): Promise<CurrentUserData>;
}
