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
  /**
   * Whether this account is academically eligible to teach anywhere.
   *
   * Derived from `verificationLevel` by the policy layer rather than left for
   * the client to compute, for the same reason every other capability is
   * projected: a client that decides for itself which levels count will drift
   * from the server that enforces it, and the drift shows up as a button that
   * 403s. Classroom-scoped authoring still needs the room's own `canTeach` —
   * this flag only says whether offering to open a classroom makes sense.
   */
  teachingEligible: z.boolean(),
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

// --- password reset ----------------------------------------------------

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

/**
 * The response is a fixed message, not a decision. Whether the email belongs
 * to an account is never reflected in the response — same status, same body,
 * whichever branch the server actually took.
 */
export const forgotPasswordResponseSchema = z.object({
  message: z.string(),
});
export type ForgotPasswordResponse = z.infer<typeof forgotPasswordResponseSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(500),
  newPassword: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
