import type { ConfigService } from '@nestjs/config';
import { isDeployedEnvironment } from '../../modules/identity-access/index.js';

// Límite de peticiones (Sprint 4, tarea 6.1.3). Las cifras son por ventana fija
// y por quien llama (ver request-tracker.ts). RATE_LIMIT_FACTOR las multiplica
// todas: sirve para la prueba de carga sin tocar el código.
export const RATE_LIMIT_FACTOR_MAX = 1000;
export const TRUST_PROXY_HOPS_MAX = 5;

// Nombres de los límites que una ruta pide con @RateLimit(...).
export const RATE_LIMIT_TAGS = [
  'account',
  'signup',
  'reservation',
  'checkIn',
  'geocode',
  'ai',
] as const;
export type RateLimitTag = (typeof RATE_LIMIT_TAGS)[number];

// The two global limits, which every HTTP route has.
export type GlobalRateLimit = 'ip' | 'caller';

export interface RateLimitRule {
  limit: number;
  ttlMs: number;
}

const MINUTE = 60_000;

// Por qué estas cifras (CLAUDE.md §11, "Límite de peticiones"):
// - ip: todo lo que llega desde una IP. Es alto a propósito: en la universidad
//   (o cualquier red con NAT) todos salen por la misma IP.
// - caller: lo de una cuenta (o de una IP sin sesión), en toda la API.
// - Los de las rutas sensibles van por cuenta y se suman a los globales.
export const RATE_LIMIT_RULES: Record<
  GlobalRateLimit | RateLimitTag,
  RateLimitRule
> = {
  ip: { limit: 1000, ttlMs: MINUTE },
  caller: { limit: 300, ttlMs: MINUTE },
  account: { limit: 20, ttlMs: MINUTE },
  signup: { limit: 10, ttlMs: 10 * MINUTE },
  reservation: { limit: 10, ttlMs: MINUTE },
  checkIn: { limit: 30, ttlMs: MINUTE },
  geocode: { limit: 20, ttlMs: MINUTE },
  ai: { limit: 10, ttlMs: MINUTE },
};

// Conexiones nuevas de WebSocket por IP. Alto por la misma razón que `ip`:
// una red con NAT junta a todos los teléfonos que se reconectan a la vez.
export const SOCKET_CONNECTION_RULE: RateLimitRule = {
  limit: 120,
  ttlMs: MINUTE,
};

export interface RateLimitSettings {
  enabled: boolean;
  factor: number;
  trustProxyHops: number;
}

export function scaled(rule: RateLimitRule, factor: number): RateLimitRule {
  return { limit: rule.limit * factor, ttlMs: rule.ttlMs };
}

// Sin definir: true. Otro valor (también vacío) impide que la app arranque.
export function parseRateLimitEnabled(raw: string | undefined): boolean {
  if (raw === undefined) {
    return true;
  }
  const text = raw.trim();
  if (text === 'true' || text === 'false') {
    return text === 'true';
  }
  throw new Error(
    'RATE_LIMIT_ENABLED debe ser true o false (o quitarla para usar true). Corrígela en la configuración del servicio.',
  );
}

export function parseRateLimitFactor(raw: string | undefined): number {
  return parseBoundedInteger(
    raw,
    'RATE_LIMIT_FACTOR',
    1,
    RATE_LIMIT_FACTOR_MAX,
    1,
  );
}

// Cuántos proxies hay delante de la API, para leer la IP real de
// X-Forwarded-For (el `trust proxy` de Express). Desplegado: 1 (el ingress de
// Azure Container Apps o el de Render). En local: 0 (nadie la reenvía).
export function parseTrustProxyHops(
  raw: string | undefined,
  deployed: boolean,
): number {
  return parseBoundedInteger(
    raw,
    'TRUST_PROXY_HOPS',
    0,
    TRUST_PROXY_HOPS_MAX,
    deployed ? 1 : 0,
  );
}

export function readRateLimitSettings(
  config: ConfigService,
): RateLimitSettings {
  return {
    enabled: parseRateLimitEnabled(config.get<string>('RATE_LIMIT_ENABLED')),
    factor: parseRateLimitFactor(config.get<string>('RATE_LIMIT_FACTOR')),
    trustProxyHops: parseTrustProxyHops(
      config.get<string>('TRUST_PROXY_HOPS'),
      isDeployedEnvironment(config),
    ),
  };
}

function parseBoundedInteger(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === undefined) {
    return fallback;
  }
  const text = raw.trim();
  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${name} debe ser un número entero entre ${min} y ${max} (o quitarla para usar ${fallback}). Corrígela en la configuración del servicio.`,
    );
  }
  return value;
}
