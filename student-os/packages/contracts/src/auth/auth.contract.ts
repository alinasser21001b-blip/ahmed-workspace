import { z } from 'zod';
import {
  accountStatusSchema,
  emailSchema,
  localeSchema,
  passwordSchema,
  userRoleSchema,
  uuidSchema,
  verificationLevelSchema,
} from '../common/primitives.js';

/**
 * Auth contract.
 *
 * Token model: a short-lived JWT access token plus an opaque, rotating refresh
 * token. The refresh token is a bearer secret that the client stores in secure
 * storage; the server persists only its hash.
 */

export const signupRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  locale: localeSchema.default('ar'),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(20).max(500),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const authUserSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  role: userRoleSchema,
  verificationLevel: verificationLevelSchema,
  status: accountStatusSchema,
  locale: localeSchema,
  /**
   * Drives the post-login route: false sends the client into onboarding, true
   * into the app shell. Computed server-side so the rule lives in one place.
   */
  onboardingCompleted: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const authSessionSchema = z.object({
  user: authUserSchema,
  tokens: authTokensSchema,
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const logoutRequestSchema = z.object({
  refreshToken: z.string().min(20).max(500).optional(),
  /** Revoke every session for this user, not just the current one. */
  allDevices: z.boolean().default(false),
});
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
