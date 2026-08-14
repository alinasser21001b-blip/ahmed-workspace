import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Validated once at boot. A missing or malformed variable crashes the process
 * immediately with a readable message rather than surfacing as a confusing
 * runtime failure an hour later — and, critically, rather than silently
 * defaulting a security-relevant value.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  /**
   * Signing key for access tokens. No default: a hardcoded fallback secret is
   * the single most common way a deployment ships with forgeable tokens.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  CORS_ORIGINS: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  /**
   * Credential endpoints get their own, far tighter budget. The platform-wide
   * limit is sized for normal browsing and is much too generous for login
   * attempts.
   */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

  /**
   * Object storage. `local` writes to disk and is for development and test
   * only — a container filesystem is ephemeral, so a production deploy on
   * `local` would lose every upload on restart.
   *
   * `external` means the host supplies the driver by calling `setStorage()`
   * before the first request. That exists so a deployment target with its own
   * object store (Netlify Blobs, a platform bucket binding) can be honest about
   * where bytes live without this package taking a dependency on that platform.
   * If nothing registers a driver, `getStorage()` refuses rather than falling
   * back to disk.
   */
  STORAGE_DRIVER: z.enum(['local', 's3', 'external']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.storage'),
  /**
   * Signing key for media URLs. Separate from JWT_SECRET so that rotating one
   * does not invalidate the other, and defaulted to JWT_SECRET only in
   * development.
   */
  MEDIA_URL_SECRET: z.string().min(32).optional(),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),

  /** AI provider. Never exposed to clients; the gateway is server-side only. */
  AI_PROVIDER: z.enum(['anthropic', 'none']).default('none'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env;
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[] | true;
  /** Falls back to JWT_SECRET outside production, where a second secret is friction. */
  mediaUrlSecret: string;
}

let cached: AppConfig | null = null;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  // A production deploy that writes uploads to a container filesystem loses
  // them on the next restart. Fail at boot rather than at the first user
  // complaint about a missing image.
  if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'local') {
    throw new Error('STORAGE_DRIVER=local is not permitted in production.');
  }
  if (env.NODE_ENV === 'production' && !env.MEDIA_URL_SECRET) {
    throw new Error('MEDIA_URL_SECRET is required in production.');
  }

  return {
    env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    corsOrigins: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    mediaUrlSecret: env.MEDIA_URL_SECRET ?? env.JWT_SECRET,
  };
}

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test seam. */
export function resetConfigCache(): void {
  cached = null;
}
