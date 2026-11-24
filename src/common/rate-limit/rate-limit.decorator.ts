import { SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { RateLimitTag } from './rate-limit.settings.js';

export const RATE_LIMIT_TAGS_METADATA = 'rate-limit:tags';

// Adds a stricter limit to a route, on top of the two global ones (CLAUDE.md
// §11, "Límite de peticiones"). Routes with the same tag share one counter per
// caller: creating and cancelling a reservation count together.
export function RateLimit(...tags: RateLimitTag[]) {
  return SetMetadata(RATE_LIMIT_TAGS_METADATA, tags);
}

export function routeRateLimitTags(context: ExecutionContext): RateLimitTag[] {
  const fromHandler = Reflect.getMetadata(
    RATE_LIMIT_TAGS_METADATA,
    context.getHandler(),
  ) as RateLimitTag[] | undefined;
  const fromClass = Reflect.getMetadata(
    RATE_LIMIT_TAGS_METADATA,
    context.getClass(),
  ) as RateLimitTag[] | undefined;
  return [...(fromClass ?? []), ...(fromHandler ?? [])];
}
