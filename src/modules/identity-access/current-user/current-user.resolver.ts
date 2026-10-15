import type { Request } from 'express';
import type { RequestIdentity } from './current-user-data.js';

// IdentityAccessModule selects the local dev resolver or Firebase authentication.
// Must throw UnauthorizedException when there is no valid session. A valid
// Firebase account without a users row is not an error here: it resolves to
// an unregistered identity, and RolesGuard answers for it.
export abstract class CurrentUserResolver {
  abstract resolve(request: Request): Promise<RequestIdentity>;
}
