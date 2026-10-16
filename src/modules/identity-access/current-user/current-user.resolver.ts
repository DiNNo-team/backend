import type { RequestIdentity } from './current-user-data.js';

// The only part of a request the resolvers read: the headers (Authorization
// and, locally, x-dev-user-id). An Express request fits as is; the WebSocket
// handshake builds one from its auth payload (DinerSocketAuthenticator).
export interface IdentityRequest {
  headers: Record<string, string | string[] | undefined>;
}

// IdentityAccessModule selects the local dev resolver or Firebase authentication.
// Must throw UnauthorizedException when there is no valid session. A valid
// Firebase account without a users row is not an error here: it resolves to
// an unregistered identity, and RolesGuard answers for it.
export abstract class CurrentUserResolver {
  abstract resolve(request: IdentityRequest): Promise<RequestIdentity>;
}
