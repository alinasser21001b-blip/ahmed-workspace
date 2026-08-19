// ════════════════════════════════════════════════════════════════════════
//  src/api/server.ts
//
//  Hono application factory.
//
//  Routes (43):
//    Web UI        GET /  GET /login  GET /dashboard  GET /campaigns
//                  GET /recommendations  GET /workspace  GET /ai  GET /settings
//    Auth          POST /api/auth/register
//                  POST /api/auth/login
//                  GET  /api/auth/me
//                  PATCH /api/auth/profile
//                  POST  /api/auth/password
//                  DELETE /api/auth/account
//    Health        GET  /api/health
//    Data Observer GET  /api/workspaces/:workspaceId/data-health
//    Dashboard     GET  /api/dashboard/:workspaceId
//    Settings      GET  /api/workspaces/:workspaceId
//                  PATCH /api/workspaces/:workspaceId
//    Members       GET  /api/workspaces/:workspaceId/members
//                  POST /api/workspaces/:workspaceId/members
//                  POST /api/workspaces/:workspaceId/members/invite
//                  PATCH /api/workspaces/:workspaceId/members/:memberId
//                  DELETE /api/workspaces/:workspaceId/members/:memberId
//    Campaigns     GET  /api/workspaces/:workspaceId/campaigns
//                  GET  /api/workspaces/:workspaceId/campaigns/:campaignId
//    Ad Sets       GET  /api/workspaces/:workspaceId/campaigns/:campaignId/adsets
//                  GET  /api/workspaces/:workspaceId/adsets/:adSetId
//    Ads           GET  /api/workspaces/:workspaceId/adsets/:adSetId/ads
//                  GET  /api/workspaces/:workspaceId/ads/:adId
//    Insights      GET  /api/workspaces/:workspaceId/insights
//                  GET  /api/workspaces/:workspaceId/insights/trends
//    Recs/Issues   GET  /api/workspaces/:workspaceId/recommendations
//                  GET  /api/workspaces/:workspaceId/issues
//    AI            POST /api/workspaces/:workspaceId/ai/chat
//    Sync          POST /api/workspaces/:workspaceId/sync
// ════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { EntityType, WorkspaceRole, SyncJobStatus } from '@prisma/client';
import { signToken, verifyToken, verifyPassword, hashPassword } from '../services/jwtAuth';
import type { PrismaClient } from '@prisma/client';
import { honoToApiRequest } from './adapter';
import { getDashboard, getDashboardPulse, loadCurrentIssues, DashboardStageTimeoutError } from '../services/getDashboard';
import { diagnoseRelevance, rankingLabel } from '../knowledge/adRelevanceIntelligence';
import { generateWeeklyReport } from '../services/weeklyReport';
import { attributeChange } from '../engines/analytics/attributeChange';
import { getPlatformStats, bustPlatformStatsCache } from '../services/getPlatformStats';
import { requirePlatformAdmin, isPlatformAdminEmail } from './adminGuard';
import { requireActiveUser } from '../services/accountAccess';
import { getStripe, getStripeWebhookSecret, StripeNotConfiguredError } from '../services/stripeClient';
import { handleStripeWebhookEvent, activateManual, cancelManual, extendSubscription } from '../services/subscriptionService';
import {
  createCustomer,
  listCustomers,
  getCustomerDetail,
  updateCustomerUser,
  setCustomerActive,
  adminResetPassword,
  deleteCustomer,
  listSubscriptions,
  listRecentPaymentEvents,
  adminOverview,
} from '../services/adminConsole';
import { buildWhatsappLink } from '../services/whatsappLink';
import { buildActivationWhatsappLink } from '../services/activationWhatsappLink';
import type { SubscriptionTier } from '@prisma/client';
import { adminDashboardPage } from '../web/pages/adminDashboardPage';
import { adminConsolePage } from '../web/pages/adminConsolePage';
import { adminInboxPage } from '../web/pages/adminInboxPage';
import { supportPage } from '../web/pages/supportPage';
import { metaReadinessPage } from '../web/pages/metaReadinessPage';
import { addClientPage } from '../web/pages/addClientPage';
import { listSettings, getSetting, upsertSetting, deleteSetting, seedDefaults, SETTING_DEFAULTS } from '../services/platformSettings';
import {
  createTicket, replyToTicket, getTicketWithMessages, adminListTickets,
  adminInboxCounts, customerListTickets, updateTicketStatus, updateTicketPriority,
  toggleTicketPin, toggleTicketStar, markMessagesRead, getUnreadCount,
} from '../services/supportService';
import type { TicketCategory, TicketStatus, TicketPriority } from '@prisma/client';
import { SyncAccountWorker } from '../workers/syncAccount';
import { runEngines } from '../workers/runEngines';
import { runBrainOrchestrator } from '../workers/runBrainOrchestrator';
import { staleSyncJobThresholdMs } from '../workers/backgroundScheduler';
import { runRefresh } from '../services/refresh/refreshEngine';
import { MetaClient, MetaApiError } from '../services/metaClient';
import { getMetaUsageStats } from '../services/metaUsageTracker';
import { loginPage } from '../web/pages/loginPage';
import { registerPage } from '../web/pages/registerPage';
import { dashboardPage } from '../web/pages/dashboardPage';
import { beginnerDashboardPage } from '../web/pages/beginnerDashboardPage';
import { campaignsPage } from '../web/pages/campaignsPage';
import { recommendationsPage } from '../web/pages/recommendationsPage';
import { workspacePage } from '../web/pages/workspacePage';
import { aiPage } from '../web/pages/aiPage';
import { adAnalysisPage } from '../web/pages/adAnalysisPage';
import { runAdAssessment, searchAdLibraryTrends } from '../adAssessor/assessService';
import {
  assembleAdlyticAssessmentContext,
  listCampaignsForAssessor,
} from '../adAssessor/adlyticContext';
import { settingsPage } from '../web/pages/settingsPage';
import { metaConnectPage } from '../web/pages/metaConnectPage';
import { purgeAccountAnalytics } from '../services/accountDataPurge';
import { parseSignedRequest, handleMetaDataDeletion } from '../services/metaDataDeletion';
import { welcomePage } from '../web/pages/welcomePage';
import { pendingActivationPage } from '../web/pages/pendingActivationPage';
import { privacyPage } from '../web/pages/privacyPage';
import { dataDeletionPage } from '../web/pages/dataDeletionPage';
import { buildAiContext } from '../services/aiContextBuilder';
import { buildAiContextV5 } from '../services/aiContextBuilderV5';
import { buildAiCampaignContext, mergeCampaignBlockIntoContext } from '../services/aiCampaignContext';
import { askClaude } from '../services/claudeClient';
import { buildAiUnavailableReply } from '../services/aiOfflineReply';
import { generateText, isAIAvailable } from '../services/ai/aiService';
import { getActiveProviderName } from '../services/ai/providerManager';
import { classifyLlmError } from '../lib/llmErrors';
import { encryptToken, decryptToken, TokenDecryptError, tokenDecryptErrorJson } from '../services/tokenEncryption';
// MetaConnection is the single source of auth truth for Meta — the upsert
// lives in one shared module so the orchestrator writes identical rows.
import { upsertMetaConnection } from '../services/metaConnectionStore';
import { recordMetaAuditEvent, listMetaAuditEvents } from '../services/metaAudit';
import {
  getCachedWorkspaceTokenHealth,
  invalidateCachedTokenHealth,
} from '../services/cachedTokenHealth';
import {
  saveOAuthSession,
  getOAuthSession,
  deleteOAuthSession,
  pruneOAuthSessions,
} from '../services/oauthSessionStore';
import { resolveAccountToken, handleMeta190 } from '../services/accountToken';
import { verifyMetaSignature, processMetaWebhookEvent } from '../services/metaWebhook';
import { config } from '../config';
import { enqueueOrFallback, getQueues } from '../lib/queue';
import { kickoffInitialSync as kickoffInitialSyncImpl } from '../lib/initialSync';
// ── Connection Orchestrator (see src/orchestrator/contracts.ts) ──────────
import {
  createOnboarding,
  advance as advanceOnboarding,
  reconcile as reconcileOnboarding,
} from '../orchestrator/engine';
import { getTimeline } from '../orchestrator/timeline';
import { metaAdapter } from '../orchestrator/adapters/metaAdapter';
import { buildMetaOAuth, getMetaOAuthConfigStatus, fetchMetaAdAccountsByToken, MetaOAuth } from '../services/metaOAuth';
import { isMockAuthEnabled, MOCK_ACCESS_TOKEN, MOCK_ACCOUNTS, seedMockAdAccountData } from '../services/mockMeta';
import { RecommendationService } from '../services/recommendation.service';
import { ExecutionService } from '../services/execution.service';
import { currencyFactorNeedsHeal, currencyMinorFactorFor, resolveCurrencyMinorFactor } from '../lib/currency';
import { healAccountCurrencyAndSpend } from '../lib/iqdRepair';
import { healIqdAccountFactors, rescaleIqdSpendFromRaw } from '../lib/iqdRepair';
import { isCurrentlySpending, accountLocalTodayFloor, accountLocalDateFloor, getAccountLocalDateString } from '../lib/campaignSpending';
import { classifyCampaignDelivery, matchesCampaignScope, type CampaignScopeFilter } from '../lib/campaignLifecycle';
import {
  efficiencyForObjective,
  resultCountForObjective,
  signalGoodDirection,
  type ObjectiveKpiFamily,
  type SignalMetricKey,
  type WindowTotals,
} from '../lib/objectiveKpis';
import { resolveCampaignPurpose } from '../lib/campaignPurpose';
import { cleanupOrphanedCampaignStats, runDataIntegrityCheck } from '../services/dataIntegrityMonitor';
import { campaignsToCsv, insightsToCsv } from '../services/reports/csvExport';

/** Map resolved purpose family → objective key for KPI math helpers. */
function purposeToObjectiveKey(
  family: ObjectiveKpiFamily,
  fallbackObjective: string | null | undefined,
): string {
  switch (family) {
    case 'awareness': return 'OUTCOME_AWARENESS';
    case 'traffic': return 'OUTCOME_TRAFFIC';
    case 'engagement': return 'OUTCOME_ENGAGEMENT';
    case 'leads': return 'OUTCOME_LEADS';
    case 'sales': return 'OUTCOME_SALES';
    case 'messaging': return 'MESSAGES';
    case 'app': return 'OUTCOME_APP_PROMOTION';
    default: return fallbackObjective || 'MESSAGES';
  }
}

// ── Background sync window policy ─────────────────────────────────────────
/** Default window when a user triggers a "refresh" sync from the dashboard. */
const DEFAULT_INCREMENTAL_BACKFILL_DAYS = 3;
/** Hard cap on backfill window; Meta's reporting window of relevance fits in here. */
const MAX_BACKFILL_DAYS = 365;
/** First-time backfill on Meta account connect. */
const INITIAL_BACKFILL_DAYS = 180;

// ── Country derivation ────────────────────────────────────────────────────
// Maps IANA timezone names → ISO 3166-1 alpha-2 country codes.
// Derived silently from Meta's timezone_name at account connection time.
// Known limitation: timezones that span multiple countries (e.g. Europe/London
// covers GB and IE) default to the dominant market. Extend as needed.
const TZ_TO_COUNTRY: Record<string, string> = {
  'Asia/Baghdad':        'IQ',
  'Asia/Riyadh':         'SA',
  'Asia/Dubai':          'AE',
  'Africa/Cairo':        'EG',
  'Asia/Amman':          'JO',
  'Asia/Beirut':         'LB',
  'Asia/Kuwait':         'KW',
  'Asia/Qatar':          'QA',
  'Africa/Casablanca':   'MA',
  'Africa/Tunis':        'TN',
  'Africa/Tripoli':      'LY',
  'Asia/Muscat':         'OM',
  'Asia/Aden':           'YE',
  'Africa/Khartoum':     'SD',
  'Asia/Tehran':         'IR',
  'Europe/Istanbul':     'TR',
  'Asia/Karachi':        'PK',
  'Asia/Kolkata':        'IN',
  'America/New_York':    'US',
  'America/Chicago':     'US',
  'America/Denver':      'US',
  'America/Los_Angeles': 'US',
  'Europe/London':       'GB',
  'Europe/Paris':        'FR',
  'Europe/Berlin':       'DE',
  'Asia/Singapore':      'SG',
  'Australia/Sydney':    'AU',
};

/** Derive ISO country code from a Meta timezone_name. Returns null when unknown. */
function tzToCountry(timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  return TZ_TO_COUNTRY[timezone] ?? null;
}

// ── Route count ───────────────────────────────────────────────────────────

export const ROUTE_COUNT = 130;

// ── Rate limiting ─────────────────────────────────────────────────────────
// In-memory per-IP rate limiter. Single-instance; sufficient for Phase 1.

interface RateEntry { count: number; resetAt: number; }
const _loginRateMap    = new Map<string, RateEntry>(); // 10 req / 15 min per IP
const _registerRateMap = new Map<string, RateEntry>(); // 5 req  / 60 min per IP
const _passwordRateMap = new Map<string, RateEntry>(); // 5 req  / 15 min per user
const _aiRateMap       = new Map<string, RateEntry>(); // LLM endpoints per user
const _supportRateMap  = new Map<string, RateEntry>(); // 10 tickets / 60 min per user
const _syncRateMap     = new Map<string, RateEntry>(); // 3 syncs / 15 min per workspace
const _discoverRateMap = new Map<string, RateEntry>(); // 5 on-demand creative fetches / 15 min per campaign
const _clientErrRateMap = new Map<string, RateEntry>(); // 30 error posts / 5 min per IP

function checkRateLimit(
  map: Map<string, RateEntry>,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  // Bound memory: prune expired entries once the map grows past a few
  // thousand keys (each new IP/user adds one entry that would otherwise
  // live forever).
  if (map.size > 5000) {
    for (const [k, v] of map) if (v.resetAt < now) map.delete(k);
  }
  const entry = map.get(key);
  if (!entry || entry.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// ── Meta OAuth state + session ────────────────────────────────────────────
// OAuth `state` (CSRF token) is persisted in the DB (model OAuthState) with a
// ~10-min TTL so the start→callback handshake survives Railway redeploys and
// multi-instance deploys. Sessions are stored in Redis (30-min TTL) with an
// in-process Map fallback when Redis is unavailable.

/** TTL for a persisted OAuth state row (start → callback window). */
const OAUTH_STATE_TTL_MS = 10 * 60_000;

// ── Utilities ─────────────────────────────────────────────────────────────

/**
 * Replacer that converts non-serializable Prisma types to plain JS values:
 *   BigInt   → Number   (Prisma uses BigInt for Int/BigInt fields with driver adapters)
 *   Decimal  → Number   (Prisma Decimal inherits from decimal.js — has .toNumber())
 * Date objects are handled natively by JSON.stringify via .toJSON().
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    // Preserve precision for values outside Number.MAX_SAFE_INTEGER
    // (heavy IQD spend / large impression totals) by serializing as string.
    const asNum = Number(value);
    if (Number.isSafeInteger(asNum)) return asNum;
    return value.toString();
  }
  // Prisma Decimal (decimal.js): any object with a toNumber() method
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (typeof v['toNumber'] === 'function') return (v as any).toNumber();
  }
  return value;
}

/**
 * Serialize a Prisma query result to a JSON-safe plain object.
 * Throws a typed error on failure so routes can return a proper 500 JSON
 * body instead of a poison 200 that the dashboard treats as a DTO.
 */
function safeJson(obj: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(obj, bigintReplacer)) as unknown;
  } catch (e) {
    console.error('[safeJson] serialization failed:', e);
    const err = new Error('Response serialization failed');
    (err as Error & { code?: string }).code = 'SERIALIZATION_ERROR';
    throw err;
  }
}

/**
 * Server-computed relevance view for an Ad row. Translates Meta's raw grades
 * into an advisor diagnosis so the client renders a sentence, never an enum.
 * Returns null when Meta hasn't graded the ad (keeps the UI quiet).
 */
function buildAdRelevanceView(ad: {
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
  rankingsSyncedAt: Date | null;
}): {
  code: string; severity: string; confidence: number;
  titleAr: string; bodyAr: string; actionAr: string;
  grades: { quality: string; engagement: string; conversion: string };
} | null {
  if (!ad.qualityRanking && !ad.engagementRanking && !ad.conversionRanking) return null;
  const d = diagnoseRelevance({
    quality: (ad.qualityRanking ?? 'unknown') as any,
    engagement: (ad.engagementRanking ?? 'unknown') as any,
    conversion: (ad.conversionRanking ?? 'unknown') as any,
  });
  if (d.code === 'RELEVANCE_UNKNOWN') return null;
  return {
    code: d.code,
    severity: d.severity,
    confidence: d.confidence,
    titleAr: d.titleAr,
    bodyAr: d.bodyAr,
    actionAr: d.actionAr,
    grades: {
      quality: rankingLabel((ad.qualityRanking ?? 'unknown') as any, 'AR'),
      engagement: rankingLabel((ad.engagementRanking ?? 'unknown') as any, 'AR'),
      conversion: rankingLabel((ad.conversionRanking ?? 'unknown') as any, 'AR'),
    },
  };
}

/**
 * Normalize operator-provided env tokens to reduce common formatting mistakes:
 * - trims surrounding whitespace/newlines
 * - strips wrapping single/double quotes
 * - strips optional "Bearer " prefix
 */
function normalizeEnvAccessToken(rawToken: string | null | undefined): string {
  if (!rawToken) return '';
  let token = rawToken.trim().replace(/[\r\n]+/g, '');
  if (!token) return '';
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  token = token.replace(/^bearer\s+/i, '').trim();
  return token;
}

/** Keep Meta auth diagnostics readable and single-line in logs. */
function summarizeMetaAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').trim().slice(0, 280);
}

// ── Dead env-token negative cache ─────────────────────────────────────────
// META_DIRECT_TOKEN / META_SYSTEM_USER_TOKEN can only change on a process
// restart, so once Meta rejects one as PERMANENTLY invalid (expired, session
// invalidated by logout, deauthorized) there is no point re-validating it on
// every /start click — it just adds a Graph round-trip of latency and a
// [META_AUTH_FAILURE] line per attempt. Keyed by token value; never logged.
const deadEnvTokens = new Set<string>();

/** True for Meta auth errors that are permanent for a given token string
 *  (expiry / logout / invalidation), as opposed to transient network/5xx. */
function isPermanentTokenError(msg: string): boolean {
  return /error validating access token|session is invalid|session has expired|access token could not be decrypted|has not authorized application|token is not valid/i.test(msg);
}

/**
 * Verify + decode a Meta `signed_request` (used by the Data Deletion callback).
 * Format is `<base64url-signature>.<base64url-json-payload>`; the signature is
 * HMAC-SHA256(payload, appSecret). Uses a constant-time comparison to reject
 * forged requests. Returns the decoded JSON payload on success.
 */
function parseMetaSignedRequest(
  signedRequest: string,
  appSecret: string,
): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string } {
  const parts = signedRequest.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'Malformed signed_request' };
  const [encodedSig, encodedPayload] = parts as [string, string];

  let expected: Buffer;
  let provided: Buffer;
  try {
    provided = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expected = createHmac('sha256', appSecret).update(encodedPayload).digest();
  } catch {
    return { ok: false, reason: 'Invalid signature encoding' };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'Bad signature' };
  }

  try {
    const json = Buffer.from(
      encodedPayload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'Invalid payload JSON' };
  }
}

// ── Application factory ───────────────────────────────────────────────────

export function buildRoutes(prisma: PrismaClient): Hono {
  const app = new Hono();
  const recService = new RecommendationService(prisma);
  const execService = new ExecutionService(prisma);

  // ── Middleware ───────────────────────────────────────────────────────────

  // ── CORS — locked to ALLOWED_ORIGINS in production ────────────────────
  const _allowedOrigins = config.cors.allowedOrigins;

  app.use(
    '*',
    cors({
      origin: _allowedOrigins.length
        ? (origin) => (_allowedOrigins.includes(origin) ? origin : null)
        : '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    })
  );

  app.use('*', logger());

  // Cap API request bodies at 1 MB — the largest legitimate payload (AI chat
  // history) is well under this; anything bigger is abuse or a bug.
  app.use('/api/*', bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: 'Request body too large' }, 413),
  }));

  // ── Self-hosted fonts (Tajawal + El Messiri woff2) ────────────────────
  // Self-hosted so the CSP below never needs a third-party font-src/style-src
  // exception. Files live in ./public/fonts, resolved relative to process
  // cwd — stable both under `tsx src/api/serve.ts` (dev) and the production
  // start command `node dist/src/api/serve.js` (both run from the repo
  // root). Immutable cache: filenames are content-stable per font version,
  // never rewritten in place.
  app.use('/fonts/*', serveStatic({ root: './public' }));
  app.use('/fonts/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });

  // PWA assets: manifest, service worker, icons
  app.use('/manifest.json', serveStatic({ root: './public' }));
  app.use('/sw.js', serveStatic({ root: './public' }));
  app.use('/icons/*', serveStatic({ root: './public' }));
  // Self-hosted JS libraries (Chart.js). Served same-origin so charts never
  // depend on a third-party CDN — jsdelivr is unreachable on some regional
  // mobile networks, which left every chart card empty while the rest of the
  // page rendered fine.
  app.use('/vendor/*', serveStatic({ root: './public' }));

  // ── Security headers ───────────────────────────────────────────────────
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options',  'nosniff');
    c.header('X-Frame-Options',         'DENY');
    c.header('Referrer-Policy',         'strict-origin-when-cross-origin');
    c.header('Permissions-Policy',      'camera=(), microphone=(), geolocation=()');
    c.header('X-XSS-Protection',        '0'); // rely on CSP instead
    // HSTS: only set over HTTPS (Railway sets X-Forwarded-Proto; check proto header)
    const proto = c.req.header('x-forwarded-proto') ?? '';
    if (proto === 'https') {
      c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    c.header(
      'Content-Security-Policy',
      // script-src no longer needs cdn.jsdelivr.net — Chart.js is self-hosted
      // under /vendor (same origin), so third-party script execution is now
      // fully blocked.
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "font-src 'self' data:; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none'; " +
      "object-src 'none'; " +
      "base-uri 'self';"
    );
  });

  // ════════════════════════════════════════════════════════════════════════
  //  WEB UI — server-rendered HTML pages
  // ════════════════════════════════════════════════════════════════════════

  app.get('/',               (c) => c.redirect('/dashboard'));
  app.get('/favicon.ico',    (c) => c.body(null, 204)); // suppress browser 404 noise
  app.get('/login',          (c) => c.html(loginPage()));
  app.get('/register',       (c) => c.html(registerPage()));
  app.get('/pending-activation', (c) => c.html(pendingActivationPage()));
  app.get('/welcome',        (c) => c.html(welcomePage()));
  // Public legal pages — no auth. Required by Meta App Review (Privacy Policy URL
  // + Data Deletion Instructions URL, both on the app's own domain).
  app.get('/privacy',        (c) => c.html(privacyPage()));
  app.get('/data-deletion',  (c) => c.html(dataDeletionPage(c.req.query('code') ?? undefined)));
  // /dashboard switches between the Pro view and the Beginner view based on a
  // dashboard_mode cookie. The cookie is per-user-agent (httpOnly=false so the
  // toggle JS can read it for the active-pill state on first load). Default is
  // 'pro' to preserve the existing experience for everyone who hasn't opted in.
  app.get('/dashboard', (c) => {
    const cookieHeader = c.req.header('cookie') ?? '';
    const m = /(?:^|;\s*)dashboard_mode=([^;]+)/.exec(cookieHeader);
    const mode = m && m[1] === 'beginner' ? 'beginner' : 'pro';
    return c.html(mode === 'beginner' ? beginnerDashboardPage() : dashboardPage());
  });
  // POST /api/dashboard-mode { mode: 'pro' | 'beginner' } — sets the cookie.
  // We accept the body via raw JSON parse since this is one of the few
  // endpoints that doesn't require a bearer token (the choice is presentation-
  // only and not tied to any workspace data). Cookie scope: site-wide, 1y TTL.
  app.post('/api/dashboard-mode', async (c) => {
    let body: { mode?: string } = {};
    try { body = await c.req.json(); } catch { /* no body / bad json */ }
    const mode = body.mode === 'beginner' ? 'beginner' : 'pro';
    // 1-year persistence; SameSite=Lax is sufficient (no cross-site POSTs need
    // this cookie). Not HttpOnly so the SHARED_JS toggle can read it for the
    // active-pill state without a round trip.
    c.header(
      'Set-Cookie',
      `dashboard_mode=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
    return c.json({ ok: true, mode });
  });
  app.get('/campaigns',      (c) => c.html(campaignsPage()));
  app.get('/ad-analysis',    (c) => c.html(adAnalysisPage()));
  app.get('/recommendations',(c) => c.html(recommendationsPage()));
  app.get('/workspace',      (c) => c.html(workspacePage()));
  app.get('/ai',             (c) => c.html(aiPage()));
  app.get('/settings',       (c) => c.html(settingsPage()));
  app.get('/support',        (c) => c.html(supportPage()));
  app.get('/admin',          (c) => c.html(adminConsolePage()));
  app.get('/admin/inbox',    (c) => c.html(adminInboxPage()));
  app.get('/admin/observability', (c) => c.html(adminDashboardPage()));
  app.get('/admin/meta-readiness', (c) => c.html(metaReadinessPage()));
  app.get('/admin/add-client', (c) => c.html(addClientPage()));
  app.get('/meta/connect',   (c) => c.html(metaConnectPage(c.req.query('session') ?? '')));

  // ── Auth helpers ──────────────────────────────────────────────────────────

  /**
   * Verify a JWT bearer token and confirm tokenVersion matches the DB row.
   * Returns the userId on success, null on any failure (expired, wrong sig,
   * revoked by password change or logout-all, user deleted).
   * The DB lookup is intentional — it is the revocation check.
   */
  async function getUserId(bearerToken: string | null): Promise<string | null> {
    if (!bearerToken) return null;
    const payload = verifyToken(bearerToken);
    if (!payload) return null;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { tokenVersion: true },
    });
    if (!user || user.tokenVersion !== payload.ver) return null;
    return payload.sub;
  }

  /**
   * Verify that userId is a member of workspaceId.
   * Returns the WorkspaceMember row, or null if not a member.
   * Used by every workspace-scoped route to prevent cross-workspace data leakage.
   */
  async function checkMember(userId: string, workspaceId: string) {
    if (!userId || !workspaceId) return null;
    return prisma.workspaceMember.findFirst({ where: { userId, workspaceId } });
  }

  /**
   * Look up an existing AdAccount by (platform, externalAccountId) and assert
   * that — if it exists — it belongs to the workspace the caller is currently
   * acting in. Returns `{ kind: 'none' }` when no row exists, `{ kind: 'owned',
   * existing }` when we own it, and `{ kind: 'conflict', ownedBy }` when a
   * DIFFERENT workspace already owns it.
   *
   * Why this exists (Phase 6a finding R-1):
   *   Without this guard, three OAuth/connect call sites used to do
   *   `findFirst({ platform, externalAccountId })` then `update({ data: { ...,
   *   workspaceId } })`. When two Adlytic workspaces shared agency access to
   *   the same Meta ad account, the second reconnect SILENTLY HIJACKED the
   *   row — workspaceId was overwritten and the first workspace lost the
   *   account. This helper makes that case explicit (409) instead of silent.
   */
  async function findExistingAdAccountForWorkspace(
    externalAccountId: string,
    workspaceId: string,
  ): Promise<
    | { kind: 'none' }
    | { kind: 'owned'; existing: { id: string; workspaceId: string; name: string } }
    | { kind: 'conflict'; ownedBy: string }
  > {
    const row = await prisma.adAccount.findFirst({
      where: { platform: 'META', externalAccountId },
      select: { id: true, workspaceId: true, name: true },
    });
    if (!row) return { kind: 'none' };
    if (row.workspaceId === workspaceId) return { kind: 'owned', existing: row };
    return { kind: 'conflict', ownedBy: row.workspaceId };
  }

  /** Canonical 409 payload for the cross-workspace hijack guard above. */
  const AD_ACCOUNT_CONFLICT_JSON = {
    error:
      'This Meta ad account is already linked to another Adlytic workspace. ' +
      'Please contact support to initiate an explicit account transfer.',
    code: 'AD_ACCOUNT_ALREADY_LINKED_ELSEWHERE',
  } as const;

  /** Paths inactive (pending-activation) users may call with a bearer token. */
  const INACTIVE_ALLOWED_API = new Set([
    '/api/auth/me',
    '/api/activation/whatsapp-link',
  ]);

  // Block inactive accounts from all authenticated APIs except the allowlist above.
  app.use('/api/*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/api/auth/register' ||
      path === '/api/auth/login' ||
      path === '/api/health' ||
      path.startsWith('/api/admin/') ||
      INACTIVE_ALLOWED_API.has(path)
    ) {
      return next();
    }

    const authHeader = c.req.header('authorization') ?? c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return next();

    const userId = await getUserId(authHeader.slice(7));
    if (!userId) return next();

    const gate = await requireActiveUser(prisma, userId);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403);
    return next();
  });

  // ── Shared helper ────────────────────────────────────────────────────────

  /** Resolve the primary AdAccount for a workspace (Phase 1: one account). */
  async function getAccount(workspaceId: string) {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: { adAccounts: { orderBy: { createdAt: 'asc' } } },
    });
    const account = ws.adAccounts[0] ?? null;
    if (account && currencyFactorNeedsHeal(account.currency, account.currencyMinorFactor)) {
      const healed = await healAccountCurrencyAndSpend(prisma, account);
      account.currencyMinorFactor = healed;
    }
    return { workspace: ws, account };
  }

  /** Fire-and-forget initial backfill after account connect (OAuth or manual).
   *  Thin closure-bound wrapper around the extracted module-level impl in
   *  src/lib/initialSync.ts so existing call sites keep their 2-arg shape
   *  while the heavy lifting + queue-vs-setImmediate decision lives in one
   *  place that the BullMQ maintenance worker can also call. */
  async function kickoffInitialSync(
    adAccountId: string,
    triggeredBy: string,
  ): Promise<void> {
    return kickoffInitialSyncImpl(prisma, adAccountId, triggeredBy);
  }

  // ── Phase 2: System User / FB Login for Business helpers ──────────────────
  // These run only on the flag-gated System User code paths. They are no-ops
  // for the legacy OAuth flow, which never calls them.

  /**
   * Resolve the owning Business Manager (id + name) for a MetaConnection.
   * MetaConnection requires a non-null businessId. Resolution order:
   *   1. An already-known businessId (typically from the ad account's
   *      `business{id,name}` field) is authoritative — use it as-is.
   *   2. Otherwise call Graph `/me/businesses` with the System User token to
   *      discover the owning BM (id + name).
   *   3. Only when both yield nothing do we fall back to a stable,
   *      system-user-derived id (`su_<id>`) or 'unknown', logging a warning so
   *      operators know the BM could not be resolved.
   */
  async function resolveBusinessId(params: {
    businessId?:   string | null;
    businessName?: string | null;
    systemUserId?: string | null;
    token:         string;
    oauth:         MetaOAuth | null;
  }): Promise<{ id: string; name: string | null }> {
    if (params.businessId) {
      return { id: params.businessId, name: params.businessName ?? null };
    }
    if (params.oauth) {
      try {
        const businesses = await params.oauth.getOwnedBusinesses(params.token);
        if (businesses.length > 0 && businesses[0]?.id) {
          return { id: businesses[0].id, name: businesses[0].name ?? params.businessName ?? null };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[adlytic:meta-oauth] Business Manager lookup (/me/businesses) failed: ${msg}`);
      }
    }
    const fallback = params.systemUserId ? `su_${params.systemUserId}` : 'unknown';
    console.warn(`[adlytic:meta-oauth] Could not resolve a Business Manager id from Meta — falling back to "${fallback}". The MetaConnection will use this placeholder business id.`);
    return { id: fallback, name: params.businessName ?? null };
  }

  // ── Persistent OAuth state (replaces the in-memory Map) ───────────────────
  // Survives redeploys / multiple instances by storing the CSRF `state` in the
  // DB with a short TTL. Used by BOTH the legacy and System User flows.

  /** Generate + persist a one-time OAuth state row. Returns the state token. */
  async function createOAuthState(params: {
    workspaceId: string;
    userId:      string;
    kind:        'legacy' | 'system_user';
  }): Promise<string> {
    const state = (await import('node:crypto')).randomBytes(32).toString('hex');
    await prisma.oAuthState.create({
      data: {
        state,
        workspaceId: params.workspaceId,
        userId:      params.userId,
        kind:        params.kind,
        expiresAt:   new Date(Date.now() + OAUTH_STATE_TTL_MS),
      },
    });
    // Opportunistic cleanup of expired rows so the table never grows unbounded.
    prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch((err: unknown) => console.warn('[adlytic:meta-oauth] oauth_states prune failed:', err));
    return state;
  }

  /**
   * Look up a state row and delete it (one-time use). Returns the stored
   * workspace/user/kind, or null when the state is unknown or expired.
   */
  async function consumeOAuthState(state: string): Promise<{ workspaceId: string; userId: string; kind: string } | null> {
    const row = await prisma.oAuthState.findUnique({ where: { state } });
    if (!row) return null;
    // One-time use: delete regardless of expiry so a replay can't reuse it.
    await prisma.oAuthState.delete({ where: { state } })
      .catch((err: unknown) => console.warn('[adlytic:meta-oauth] oauth_state delete failed:', err));
    if (row.expiresAt < new Date()) return null;
    return { workspaceId: row.workspaceId, userId: row.userId, kind: row.kind };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  AUTH — bcrypt passwords, JWT access tokens (7-day TTL + tokenVersion
  //  revocation), rate-limited login and registration.
  // ════════════════════════════════════════════════════════════════════════

  /** POST /api/auth/register — create a new user account. */
  app.post('/api/auth/register', async (c) => {
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (!checkRateLimit(_registerRateMap, clientIp, 5, 60 * 60_000)) {
      return c.json({ error: 'Too many registration attempts. Please try again later.' }, 429);
    }
    let body: { email?: string; password?: string; name?: string };
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid request body' }, 400); }
    if (!body.email || !body.password) return c.json({ error: 'email and password are required' }, 400);
    if (body.password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
    if (body.password.length > 128) return c.json({ error: 'Password too long' }, 400);
    const email = body.email.toLowerCase().trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: 'Invalid email address' }, 400);
    }
    if (body.name && body.name.length > 100) return c.json({ error: 'Name too long (max 100 chars)' }, 400);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return c.json({ error: 'Email already in use' }, 409);
    const passwordHash = await hashPassword(body.password);
    let user: { id: string; email: string; name: string | null; tokenVersion: number };
    let workspace: { id: string };
    try {
      // Atomic: never leave a user row without an OWNER workspace membership.
      const created = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: { email, name: body.name ?? email.split('@')[0]!, passwordHash },
        });
        const ws = await tx.workspace.create({
          data: {
            name: `${body.name ?? email.split('@')[0]}'s Workspace`,
            members: { create: { userId: u.id, role: WorkspaceRole.OWNER } },
          },
        });
        return { user: u, workspace: ws };
      });
      user = created.user;
      workspace = created.workspace;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        return c.json({ error: 'Email already in use' }, 409);
      }
      throw err;
    }
    const token = signToken({ sub: user.id, email: user.email, ver: user.tokenVersion });
    return c.json({ token, user: { id: user.id, email: user.email, name: user.name ?? null }, workspaceId: workspace.id }, 201);
  });

  /** POST /api/auth/login — exchange credentials for a JWT. */
  app.post('/api/auth/login', async (c) => {
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (!checkRateLimit(_loginRateMap, clientIp, 10, 15 * 60_000)) {
      return c.json({ error: 'Too many login attempts. Please try again in 15 minutes.' }, 429);
    }
    let body: { email?: string; password?: string };
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid request body' }, 400); }
    if (!body.email || !body.password) return c.json({ error: 'email and password are required' }, 400);
    if (body.password.length > 128) return c.json({ error: 'Invalid credentials' }, 401);
    const email = body.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Spend bcrypt time to prevent user-enumeration via timing oracle
      await hashPassword('dummy-constant-time-guard');
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    const { ok, needsUpgrade } = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return c.json({ error: 'Invalid credentials' }, 401);
    // Transparent SHA-256 → bcrypt upgrade on successful login
    if (needsUpgrade) {
      const upgraded = await hashPassword(body.password);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
    }
    const token = signToken({ sub: user.id, email: user.email, ver: user.tokenVersion });
    return c.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  /** GET /api/auth/me — resolve bearer token to a user record. */
  app.get('/api/auth/me', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    // findUnique (not OrThrow) — deleted users return null → 401, not 500
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, locale: true, createdAt: true, isActive: true,
        memberships: {
          include: { workspace: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    // Surface platform-admin flag for UI hints (sidebar link visibility).
    // The flag is advisory only — every admin route still calls requirePlatformAdmin.
    return c.json({
      ...(safeJson(user) as object),
      isPlatformAdmin: isPlatformAdminEmail(user.email),
    });
  });

  /**
   * GET /api/activation/whatsapp-link — pre-filled wa.me link for manual account
   * activation. Auth required; available to inactive users (pending page).
   */
  app.get('/api/activation/whatsapp-link', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true },
    });
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    if (user.isActive) return c.json({ error: 'Account is already active' }, 400);
    try {
      const link = buildActivationWhatsappLink(user.email);
      return c.json(link);
    } catch (err) {
      console.error('[activation] SUPPORT_WHATSAPP_NUMBER misconfigured:', err);
      return c.json({ error: 'WhatsApp support is not configured on this server' }, 503);
    }
  });

  /** PATCH /api/auth/profile — update display name. */
  app.patch('/api/auth/profile', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const body = req.body as { name?: string };
    if (!body.name?.trim()) return c.json({ error: 'Name is required' }, 400);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { name: body.name.trim() },
      select: { id: true, name: true, email: true },
    });
    return c.json(safeJson(user));
  });

  /** POST /api/auth/password — change password (requires current password). */
  app.post('/api/auth/password', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    // Per-user limit: a stolen session token must not allow brute-forcing the
    // current password out of this endpoint.
    if (!checkRateLimit(_passwordRateMap, userId, 5, 15 * 60_000)) {
      return c.json({ error: 'Too many attempts. Please try again in 15 minutes.' }, 429);
    }
    const body = req.body as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword) return c.json({ error: 'Both passwords are required' }, 400);
    if (body.newPassword.length < 8) return c.json({ error: 'New password must be at least 8 characters' }, 400);
    if (body.newPassword.length > 128) return c.json({ error: 'Password too long' }, 400);
    if (body.currentPassword.length > 128) return c.json({ error: 'Password too long' }, 400);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const { ok } = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!ok) return c.json({ error: 'Current password is incorrect' }, 403);
    const newHash = await hashPassword(body.newPassword);
    // Increment tokenVersion to revoke all existing sessions (logout all devices)
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
    });
    return c.json({ success: true });
  });

  /** POST /api/auth/logout-all — revoke all sessions by incrementing tokenVersion. */
  app.post('/api/auth/logout-all', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return c.json({ success: true });
  });

  /** GET /api/auth/export — GDPR data export for the authenticated user. */
  app.get('/api/auth/export', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, locale: true,
        createdAt: true, updatedAt: true,
        memberships: {
          include: {
            workspace: {
              select: {
                id: true, name: true, plan: true, createdAt: true,
                adAccounts: {
                  select: { id: true, name: true, platform: true, currency: true, createdAt: true },
                },
              },
            },
          },
        },
      },
    });
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    c.header('Content-Disposition', `attachment; filename="adlytic-export-${userId}.json"`);
    return c.json(safeJson({ exportedAt: new Date().toISOString(), user }));
  });

  /** DELETE /api/auth/account — permanently delete the authenticated user.
   *  Requires the current password so a stolen JWT alone cannot erase data. */
  app.delete('/api/auth/account', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);

    const body = (req.body ?? {}) as { password?: string };
    if (!body.password || typeof body.password !== 'string') {
      return c.json({ error: 'Password confirmation is required to delete your account' }, 400);
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const { ok } = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return c.json({ error: 'Incorrect password' }, 403);

    // Find workspaces where this user is the only OWNER — these become orphaned on deletion
    const ownedMemberships = await prisma.workspaceMember.findMany({
      where: { userId, role: WorkspaceRole.OWNER },
      select: { workspaceId: true },
    });

    for (const m of ownedMemberships) {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId: m.workspaceId, role: WorkspaceRole.OWNER },
      });
      if (ownerCount <= 1) {
        // Clean up analytics data (no FK cascade on entityId-based tables)
        const accounts = await prisma.adAccount.findMany({
          where: { workspaceId: m.workspaceId },
          select: { id: true },
        });
        for (const acct of accounts) {
          // Canonical erasure — covers every entityId-keyed analytics table
          // (incl. breakdown_stats) at both account and campaign level.
          await purgeAccountAnalytics(prisma, acct.id);
        }
        await prisma.workspace.delete({ where: { id: m.workspaceId } });
      }
    }

    await prisma.user.delete({ where: { id: userId } });
    return c.json({ success: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  CLIENT ERROR REPORTING
  // ════════════════════════════════════════════════════════════════════════

  app.post('/api/client-errors', async (c) => {
    // Unauthenticated by design (errors fire before/around auth), so cap by IP
    // to keep it from becoming a log-flood vector. Silent 200 on limit — a
    // noisy client must never learn it is being throttled.
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (!checkRateLimit(_clientErrRateMap, clientIp, 30, 5 * 60_000)) {
      return c.json({ ok: true }, 200);
    }
    const req = await honoToApiRequest(c);
    const userId = req.bearerToken ? await getUserId(req.bearerToken) : null;
    const body = req.body as { errors?: Array<{ msg?: string; src?: string; line?: number }>; url?: string } | null;
    if (!body?.errors?.length) return c.json({ ok: true }, 200);
    const tag = `[client-error] user=${userId ?? 'anon'} page=${body.url ?? '?'}`;
    for (const err of body.errors.slice(0, 5)) {
      console.warn(`${tag} ${err.msg ?? '?'} (${err.src ?? ''}:${err.line ?? 0})`);
    }
    return c.json({ ok: true }, 200);
  });

  // ════════════════════════════════════════════════════════════════════════
  //  HEALTH
  // ════════════════════════════════════════════════════════════════════════

  /** GET /api/health — process liveness + DB readiness. */
  app.get('/api/health', async (c) => {
    // role/bullmq are surfaced so `curl /api/health` on each Railway service
    // confirms which one is the API and which runs background sync.
    const roleInfo = {
      role: config.role,
      runsBackgroundSync: config.role !== 'api',
      bullmq: config.features.bullmqEnabled ? 'enabled' : 'disabled',
    };
    try {
      await prisma.$queryRaw`SELECT 1`;
      return c.json({
        status: 'ok',
        service: 'adlytic',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        db: 'ok',
        ...roleInfo,
      });
    } catch {
      return c.json({
        status: 'degraded',
        service: 'adlytic',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        db: 'unavailable',
        ...roleInfo,
      }, 503);
    }
  });

  /** GET /api/health/ai — live AI provider self-test.
   *
   *  The one endpoint that ends "why is the assistant offline?" guessing:
   *  it reports which keys exist on THIS service, which provider/model chat
   *  resolves to, and the classified result of a real 8-token ping — so a
   *  worker-has-key-but-api-doesn't split, a dead key, or a retired model ID
   *  is visible in one browser tab without Railway log access. No secrets:
   *  booleans + classified codes; provider text is truncated and key-redacted.
   *  Result cached 5 minutes so it cannot be used to burn credits. */
  let aiHealthCache: { at: number; body: Record<string, unknown> } | null = null;
  app.get('/api/health/ai', async (c) => {
    if (aiHealthCache && Date.now() - aiHealthCache.at < 5 * 60_000) {
      return c.json(aiHealthCache.body);
    }
    const body: Record<string, unknown> = {
      service: config.role,
      anthropicKeyPresent: !!process.env['ANTHROPIC_API_KEY'],
      openaiKeyPresent: !!process.env['OPENAI_API_KEY'],
      chatProvider: getActiveProviderName('chat-agent'),
      checkedAt: new Date().toISOString(),
    };
    if (!isAIAvailable()) {
      body['ok'] = false;
      body['code'] = 'AI_AUTH_FAILED';
      body['reasonAr'] = 'لا يوجد مفتاح ذكاء اصطناعي على خدمة الويب — أضف ANTHROPIC_API_KEY لهذه الخدمة تحديداً في Railway (وليس فقط لخدمة الـ worker).';
    } else {
      try {
        const ping = await generateText({
          task: 'chat-agent',
          system: 'Reply with the single word OK.',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 8,
          timeoutMs: 12_000,
        });
        body['ok'] = true;
        body['provider'] = ping.provider;
        body['model'] = ping.model;
      } catch (err) {
        const classified = classifyLlmError(err);
        body['ok'] = false;
        body['code'] = classified.code;
        body['reasonAr'] = classified.messageAr;
        body['providerMessage'] = classified.providerMessage
          .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
          .slice(0, 200);
      }
    }
    aiHealthCache = { at: Date.now(), body };
    return c.json(body);
  });

  // ════════════════════════════════════════════════════════════════════════
  //  DATA OBSERVER — reconciliation & cleanup
  // ════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/workspaces/:workspaceId/data-health — data consistency observer.
   * Compares account-level vs sum-of-campaign stats, dormant ACTIVE inflation,
   * and orphaned historical rows. ?cleanup=true removes orphaned stats.
   */
  app.get('/api/workspaces/:workspaceId/data-health', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const membership = await checkMember(userId, req.params['workspaceId']);
    if (!membership) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'No ad account linked' }, 404);

    const doCleanup = req.query['cleanup'] === 'true';
    // Destructive cleanup is OWNER/MANAGER only — viewers may observe, not mutate.
    if (doCleanup && membership.role === 'VIEWER') {
      return c.json({ error: 'Insufficient permissions to run cleanup' }, 403);
    }
    const report = await runDataIntegrityCheck(prisma, req.params['workspaceId'], account);

    let orphanedRowsDeleted = 0;
    if (doCleanup && report.orphanedCount > 0) {
      orphanedRowsDeleted = await cleanupOrphanedCampaignStats(prisma);
    }

    return c.json({
      window: `${report.windowDays}d`,
      accountId: report.accountId,
      checkedAt: report.checkedAt,
      overallStatus: report.overallStatus,
      checks: report.checks,
      campaignCounts: report.campaignCounts,
      activeCampaigns: report.campaignCounts.deliveringInWindow,
      metaActiveCampaigns: report.campaignCounts.activeStatus,
      dormantActiveCampaigns: report.campaignCounts.dormantActive,
      divergencePct: report.divergencePct,
      divergenceStatus: report.divergenceStatus,
      orphanedCampaignIds: report.orphanedCampaignIds,
      orphanedCount: report.orphanedCount,
      staleActiveCount: report.staleActiveCount,
      syncAgeHours: report.syncAgeHours,
      ...(doCleanup ? { orphanedRowsDeleted } : {}),
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  DASHBOARD — existing getDashboard service
  // ════════════════════════════════════════════════════════════════════════

  /** GET /api/dashboard/:workspaceId — full dashboard DTO. */
  app.get('/api/dashboard/:workspaceId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const workspaceId = req.params['workspaceId'];
    if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const member = await checkMember(userId, workspaceId);
    if (!member) return c.json({ error: 'Access denied' }, 403);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    try {
      const dto = await getDashboard(workspaceId, { prisma, locale: user?.locale });
      return c.json(safeJson(dto));
    } catch (e: any) {
      if (e?.message?.includes('no ad account') || e?.code === 'P2025') {
        return c.json({ empty: true, workspace: { id: workspaceId } }, 200);
      }
      // Circuit breaker tripped: a getDashboard stage stalled past its budget.
      // Return 504 with the offending stage so the client stops spinning and
      // can show an error state, and so logs pinpoint the bottleneck.
      if (e instanceof DashboardStageTimeoutError) {
        console.error(`[api:dashboard] timeout serving ${workspaceId}: stage=${e.stage} timeoutMs=${e.timeoutMs}`);
        return c.json(
          {
            error: 'Dashboard timed out while loading live data.',
            code: 'DASHBOARD_TIMEOUT',
          },
          504,
        );
      }
      throw e;
    }
  });

  /**
   * GET /api/dashboard/pulse/:workspaceId — lean polling endpoint.
   *
   * Returns ONLY the volatile fields the dashboard refreshes every 60s.
   * Decoupled from the heavy `getDashboard` path so polling stays cheap.
   * 200 with `{ empty: true }` when no ad account is linked yet.
   */
  app.get('/api/dashboard/pulse/:workspaceId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const workspaceId = req.params['workspaceId'];
    if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const member = await checkMember(userId, workspaceId);
    if (!member) return c.json({ error: 'Access denied' }, 403);
    const pulse = await getDashboardPulse(workspaceId, { prisma });
    if (!pulse) return c.json({ empty: true, workspaceId }, 200);
    return c.json(safeJson(pulse));
  });

  app.get('/api/weekly-report/:workspaceId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const workspaceId = req.params['workspaceId'];
    if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const member = await checkMember(userId, workspaceId);
    if (!member) return c.json({ error: 'Access denied' }, 403);
    const report = await generateWeeklyReport(prisma, workspaceId);
    if (!report) return c.json({ empty: true }, 200);
    return c.json(safeJson(report));
  });

  // ════════════════════════════════════════════════════════════════════════
  //  ADMIN — platform-wide read-only analytics (gated by PLATFORM_ADMIN_EMAILS)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/admin/platform-stats — aggregate reach + budgets + brain health.
   *
   * Gated by `requirePlatformAdmin`. Served from an in-memory 1h TTL cache
   * (see `getPlatformStats.ts`); the DTO carries `fromCache` so admins can
   * see whether they're looking at a fresh or cached row.
   */
  app.get('/api/admin/platform-stats', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const stats = await getPlatformStats(prisma);
    return c.json(safeJson(stats));
  });

  /**
   * POST /api/admin/cache/bust — manual invalidation of the platform-stats cache.
   *
   * Use after a hot fix to force the next `/api/admin/platform-stats` to recompute.
   */
  app.post('/api/admin/cache/bust', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    bustPlatformStatsCache();
    return c.json({ ok: true, bustedAt: Date.now() });
  });

  /**
   * GET /api/admin/users — list users with activation status for manual review.
   * Supports ?q=&status=active|pending|all&tier=FREE|PREMIUM|all&take=&skip=
   */
  app.get('/api/admin/users', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const q = c.req.query('q') ?? undefined;
    const statusRaw = c.req.query('status') ?? 'all';
    const status = statusRaw === 'active' || statusRaw === 'pending' ? statusRaw : 'all';
    const tierRaw = c.req.query('tier') ?? 'all';
    const tier = tierRaw === 'FREE' || tierRaw === 'PREMIUM' ? tierRaw : 'all';
    const take = Number(c.req.query('take') ?? 50);
    const skip = Number(c.req.query('skip') ?? 0);

    // Legacy shape for the old observability page: { users: [...] }
    // New console prefers /api/admin/customers — keep this enriched.
    const result = await listCustomers(prisma, { q, status, tier, take, skip });
    return c.json(safeJson({
      users: result.customers.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isActive: u.isActive,
        activatedAt: u.activatedAt,
        createdAt: u.createdAt,
        hasPremium: u.hasPremium,
        workspaces: u.workspaces,
      })),
      total: result.total,
      take: result.take,
      skip: result.skip,
    }));
  });

  /**
   * POST /api/admin/users/activate — manually activate a pending user account.
   */
  app.post('/api/admin/users/activate', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const body = req.body as { userId?: string };
    const targetUserId = body.userId?.trim();
    if (!targetUserId) return c.json({ error: 'userId is required' }, 400);

    const existing = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, isActive: true },
    });
    if (!existing) return c.json({ error: 'User not found' }, 404);
    if (existing.isActive) {
      return c.json({ ok: true, alreadyActive: true, user: existing });
    }

    const user = await setCustomerActive(prisma, targetUserId, true, gate.userId);
    return c.json({ ok: true, user: safeJson(user) });
  });

  /**
   * POST /api/admin/users/deactivate — suspend a customer account.
   */
  app.post('/api/admin/users/deactivate', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const body = req.body as { userId?: string };
    const targetUserId = body.userId?.trim();
    if (!targetUserId) return c.json({ error: 'userId is required' }, 400);
    if (targetUserId === gate.userId) {
      return c.json({ error: 'Cannot deactivate your own admin account' }, 400);
    }

    const existing = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!existing) return c.json({ error: 'User not found' }, 404);

    const user = await setCustomerActive(prisma, targetUserId, false, gate.userId);
    return c.json({ ok: true, user: safeJson(user) });
  });

  /**
   * GET /api/admin/overview — owner console KPI strip.
   */
  app.get('/api/admin/overview', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const overview = await adminOverview(prisma);
    return c.json(safeJson(overview));
  });

  /**
   * GET /api/admin/customers — searchable customer list for the owner console.
   */
  app.get('/api/admin/customers', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const q = c.req.query('q') ?? undefined;
    const statusRaw = c.req.query('status') ?? 'all';
    const status = statusRaw === 'active' || statusRaw === 'pending' ? statusRaw : 'all';
    const tierRaw = c.req.query('tier') ?? 'all';
    const tier = tierRaw === 'FREE' || tierRaw === 'PREMIUM' ? tierRaw : 'all';
    const take = Number(c.req.query('take') ?? 50);
    const skip = Number(c.req.query('skip') ?? 0);
    const result = await listCustomers(prisma, { q, status, tier, take, skip });
    return c.json(safeJson(result));
  });

  /**
   * POST /api/admin/customers — create a customer account + workspace.
   */
  app.post('/api/admin/customers', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const body = req.body as {
      email?: string;
      name?: string;
      password?: string;
      workspaceName?: string;
      locale?: 'AR' | 'EN';
      activateAccount?: boolean;
      grantPremium?: boolean;
      premiumDays?: number;
      premiumNote?: string;
    };

    try {
      const premiumDays = Math.max(1, Math.min(730, Number(body.premiumDays ?? 30)));
      const result = await createCustomer(prisma, {
        email: body.email ?? '',
        name: body.name ?? '',
        password: body.password ?? '',
        workspaceName: body.workspaceName ?? '',
        locale: body.locale === 'EN' ? 'EN' : 'AR',
        activateAccount: body.activateAccount !== false,
        grantPremium: body.grantPremium === true,
        premiumExpiresAt: body.grantPremium
          ? new Date(Date.now() + premiumDays * 864e5)
          : undefined,
        premiumNote: body.premiumNote,
        triggeredBy: gate.userId,
      });
      return c.json(safeJson({ ok: true, ...result }), 201);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'CREATE_FAILED';
      const map: Record<string, { status: 400 | 409; error: string }> = {
        INVALID_EMAIL: { status: 400, error: 'البريد الإلكتروني غير صالح' },
        INVALID_NAME: { status: 400, error: 'الاسم مطلوب' },
        WEAK_PASSWORD: { status: 400, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' },
        EMAIL_TAKEN: { status: 409, error: 'هذا البريد مسجّل مسبقاً' },
      };
      const mapped = map[code] ?? { status: 400 as const, error: 'تعذّر إنشاء الحساب' };
      return c.json({ error: mapped.error, code }, mapped.status);
    }
  });

  /**
   * GET /api/admin/customers/:userId — customer detail + activity.
   */
  app.get('/api/admin/customers/:userId', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const userId = req.params['userId'];
    if (!userId) return c.json({ error: 'Missing userId' }, 400);
    const detail = await getCustomerDetail(prisma, userId);
    if (!detail) return c.json({ error: 'User not found' }, 404);
    return c.json(safeJson(detail));
  });

  /**
   * PATCH /api/admin/customers/:userId — edit name/email/locale.
   */
  app.patch('/api/admin/customers/:userId', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const userId = req.params['userId'];
    if (!userId) return c.json({ error: 'Missing userId' }, 400);
    const body = req.body as { name?: string; email?: string; locale?: 'AR' | 'EN' };
    try {
      const user = await updateCustomerUser(prisma, userId, body);
      return c.json(safeJson({ ok: true, user }));
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UPDATE_FAILED';
      if (code === 'EMAIL_TAKEN') return c.json({ error: 'هذا البريد مسجّل مسبقاً', code }, 409);
      if (code === 'INVALID_EMAIL') return c.json({ error: 'البريد غير صالح', code }, 400);
      if (code === 'INVALID_NAME') return c.json({ error: 'الاسم مطلوب', code }, 400);
      return c.json({ error: 'تعذّر التحديث', code }, 400);
    }
  });

  /**
   * POST /api/admin/customers/:userId/reset-password
   */
  app.post('/api/admin/customers/:userId/reset-password', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const userId = req.params['userId'];
    if (!userId) return c.json({ error: 'Missing userId' }, 400);
    const body = req.body as { password?: string };
    try {
      const user = await adminResetPassword(prisma, userId, body.password ?? '');
      return c.json(safeJson({ ok: true, user }));
    } catch (err) {
      const code = err instanceof Error ? err.message : 'RESET_FAILED';
      if (code === 'WEAK_PASSWORD') {
        return c.json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل', code }, 400);
      }
      return c.json({ error: 'تعذّر إعادة تعيين كلمة المرور', code }, 400);
    }
  });

  /**
   * DELETE /api/admin/customers/:userId — permanently delete a customer.
   *
   * Irreversible: purges every workspace the user OWNS (ad accounts,
   * campaigns, ads, analytics, payment ledger, AI history) and the user
   * row itself. Platform-admin only; no extra confirmation step.
   */
  app.delete('/api/admin/customers/:userId', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const userId = req.params['userId'];
    if (!userId) return c.json({ error: 'Missing userId' }, 400);

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!target) return c.json({ error: 'User not found' }, 404);

    try {
      const result = await deleteCustomer(prisma, userId);
      return c.json(safeJson({ ok: true, ...result }));
    } catch (err) {
      const code = err instanceof Error ? err.message : 'DELETE_FAILED';
      if (code === 'USER_NOT_FOUND') return c.json({ error: 'User not found', code }, 404);
      return c.json({ error: 'تعذّر حذف الحساب', code }, 500);
    }
  });

  /**
   * GET /api/admin/subscriptions — all workspaces with billing state.
   */
  app.get('/api/admin/subscriptions', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const take = Number(c.req.query('take') ?? 100);
    const rows = await listSubscriptions(prisma, take);
    return c.json(safeJson({ subscriptions: rows }));
  });

  /**
   * GET /api/admin/payment-events — recent ledger rows.
   */
  app.get('/api/admin/payment-events', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const take = Number(c.req.query('take') ?? 50);
    const events = await listRecentPaymentEvents(prisma, take);
    return c.json(safeJson({ events }));
  });

  /**
   * POST /api/admin/subscriptions/cancel-manual — revoke Premium / cancel.
   */
  app.post('/api/admin/subscriptions/cancel-manual', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const body = req.body as { workspaceId?: string; note?: string };
    const workspaceId = body.workspaceId?.trim();
    if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400);
    const exists = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!exists) return c.json({ error: 'Workspace not found' }, 404);

    const result = await cancelManual(prisma, {
      workspaceId,
      ...(body.note ? { note: body.note } : {}),
      triggeredBy: gate.userId,
    });
    return c.json(result);
  });

  /**
   * POST /api/admin/subscriptions/extend — push expiry forward on an active subscription.
   */
  app.post('/api/admin/subscriptions/extend', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const body = req.body as {
      workspaceId?: string;
      newExpiresAt?: string;
      note?: string;
      amountMinor?: number;
      currency?: string;
    };
    const workspaceId = body.workspaceId?.trim();
    if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400);

    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, tier: true, subscriptionStatus: true },
    });
    if (!ws) return c.json({ error: 'Workspace not found' }, 404);

    const newExpiresAt = body.newExpiresAt ? new Date(body.newExpiresAt) : null;
    if (!newExpiresAt || isNaN(newExpiresAt.getTime())) {
      return c.json({ error: 'newExpiresAt is required (ISO date string)' }, 400);
    }
    if (newExpiresAt <= new Date()) {
      return c.json({ error: 'newExpiresAt must be in the future' }, 400);
    }

    const result = await extendSubscription(prisma, {
      workspaceId,
      newExpiresAt,
      note: body.note,
      amountMinor: body.amountMinor != null ? BigInt(body.amountMinor) : undefined,
      currency: body.currency,
      triggeredBy: gate.userId,
    });
    return c.json(result);
  });

  // ════════════════════════════════════════════════════════════════════════
  //  PLATFORM SETTINGS — runtime config CRUD for feature flags, sync
  //  intervals, rate limits, and other server-side parameters.
  // ════════════════════════════════════════════════════════════════════════

  app.get('/api/admin/settings', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const group = c.req.query('group') || undefined;
    const settings = await listSettings(prisma, group);
    return c.json(safeJson({ settings, defaults: SETTING_DEFAULTS }));
  });

  app.get('/api/admin/settings/:key', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const key = req.params['key'];
    if (!key) return c.json({ error: 'Missing key' }, 400);
    const value = await getSetting(prisma, key);
    if (value === null) return c.json({ error: 'Setting not found' }, 404);
    return c.json({ key, value });
  });

  app.put('/api/admin/settings/:key', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const key = req.params['key'];
    if (!key) return c.json({ error: 'Missing key' }, 400);
    const body = req.body as { value?: string; label?: string; description?: string; group?: string; valueType?: string };
    if (body.value == null) return c.json({ error: 'value is required' }, 400);
    const setting = await upsertSetting(prisma, key, String(body.value), gate.userId, {
      label: body.label,
      description: body.description,
      group: body.group,
      valueType: body.valueType,
    });
    return c.json(safeJson({ ok: true, setting }));
  });

  app.delete('/api/admin/settings/:key', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const key = req.params['key'];
    if (!key) return c.json({ error: 'Missing key' }, 400);
    const ok = await deleteSetting(prisma, key);
    if (!ok) return c.json({ error: 'Setting not found' }, 404);
    return c.json({ ok: true });
  });

  app.post('/api/admin/settings/seed', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const count = await seedDefaults(prisma, gate.userId);
    return c.json({ ok: true, seeded: count });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  SUPPORT — Customer communication center
  //
  //  Customer-side: create tickets, list own tickets, reply, view thread.
  //  Admin-side: inbox counts, list/filter tickets, reply, change status,
  //  toggle pin/star, internal notes, mark read.
  // ════════════════════════════════════════════════════════════════════════

  // ── Customer-side routes ────────────────────────────────────────────────

  app.post('/api/support/tickets', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!checkRateLimit(_supportRateMap, userId, 10, 60 * 60_000)) {
      return c.json({ error: 'Too many tickets created. Please try again later.' }, 429);
    }

    const body = req.body as {
      workspaceId?: string; category?: TicketCategory; subject?: string;
      message?: string; priority?: TicketPriority;
      linkedEntityType?: string; linkedEntityId?: string;
      userAgent?: string; language?: string;
    };
    if (!body.workspaceId?.trim()) return c.json({ error: 'workspaceId is required' }, 400);
    if (!body.category) return c.json({ error: 'category is required' }, 400);
    if (!body.subject?.trim()) return c.json({ error: 'subject is required' }, 400);
    if (!body.message?.trim()) return c.json({ error: 'message is required' }, 400);
    if (body.subject!.length > 200) return c.json({ error: 'Subject too long (max 200 chars)' }, 400);
    if (body.message!.length > 5000) return c.json({ error: 'Message too long (max 5000 chars)' }, 400);

    const member = await checkMember(userId, body.workspaceId);
    if (!member) return c.json({ error: 'Not a member of this workspace' }, 403);

    const ticket = await createTicket(prisma, {
      userId,
      workspaceId: body.workspaceId,
      category: body.category,
      subject: body.subject.slice(0, 200),
      message: body.message.slice(0, 5000),
      priority: body.priority,
      linkedEntityType: body.linkedEntityType,
      linkedEntityId: body.linkedEntityId,
      clientInfo: { userAgent: body.userAgent, language: body.language },
    });
    return c.json(safeJson({ ok: true, ticket }), 201);
  });

  app.get('/api/support/tickets', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);

    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400);
    const member = await checkMember(userId, workspaceId);
    if (!member) return c.json({ error: 'Forbidden' }, 403);

    const tickets = await customerListTickets(prisma, userId, workspaceId);
    return c.json(safeJson({ tickets }));
  });

  app.get('/api/support/tickets/:ticketId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);

    const ticketId = req.params['ticketId'];
    if (!ticketId) return c.json({ error: 'Missing ticketId' }, 400);

    const ticket = await getTicketWithMessages(prisma, ticketId, false);
    if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
    if (ticket.userId !== userId) return c.json({ error: 'Forbidden' }, 403);

    await markMessagesRead(prisma, ticketId, 'USER');
    return c.json(safeJson({ ticket }));
  });

  app.post('/api/support/tickets/:ticketId/reply', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!checkRateLimit(_supportRateMap, 'reply:' + userId, 30, 60 * 60_000)) {
      return c.json({ error: 'Too many messages. Please try again later.' }, 429);
    }

    const ticketId = req.params['ticketId'];
    if (!ticketId) return c.json({ error: 'Missing ticketId' }, 400);
    const body = req.body as { content?: string };
    if (!body.content?.trim()) return c.json({ error: 'content is required' }, 400);
    if (body.content!.length > 5000) return c.json({ error: 'Message too long (max 5000 chars)' }, 400);

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId }, select: { userId: true, status: true },
    });
    if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
    if (ticket.userId !== userId) return c.json({ error: 'Forbidden' }, 403);
    if (ticket.status === 'CLOSED') return c.json({ error: 'Ticket is closed' }, 400);

    const msg = await replyToTicket(prisma, {
      ticketId, senderId: userId, senderType: 'USER', content: body.content.slice(0, 5000),
    });
    return c.json(safeJson({ ok: true, message: msg }));
  });

  // ── Admin-side support routes ───────────────────────────────────────────

  app.get('/api/admin/support/counts', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const counts = await adminInboxCounts(prisma);
    const unread = await getUnreadCount(prisma, 'ADMIN');
    return c.json(safeJson({ ...counts, unread }));
  });

  app.get('/api/admin/support/tickets', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const result = await adminListTickets(prisma, {
      status: (c.req.query('status') as TicketStatus) || 'all',
      category: (c.req.query('category') as TicketCategory) || 'all',
      priority: (c.req.query('priority') as TicketPriority) || 'all',
      q: c.req.query('q') || '',
      take: Number(c.req.query('take') ?? 50),
      skip: Number(c.req.query('skip') ?? 0),
    });
    return c.json(safeJson(result));
  });

  app.get('/api/admin/support/tickets/:ticketId', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const ticketId = req.params['ticketId'];
    if (!ticketId) return c.json({ error: 'Missing ticketId' }, 400);

    const ticket = await getTicketWithMessages(prisma, ticketId, true);
    if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

    await markMessagesRead(prisma, ticketId, 'ADMIN');
    return c.json(safeJson({ ticket }));
  });

  app.post('/api/admin/support/tickets/:ticketId/reply', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const ticketId = req.params['ticketId'];
    if (!ticketId) return c.json({ error: 'Missing ticketId' }, 400);
    const body = req.body as { content?: string; isInternal?: boolean };
    if (!body.content?.trim()) return c.json({ error: 'content is required' }, 400);

    const msg = await replyToTicket(prisma, {
      ticketId,
      senderId: gate.userId,
      senderType: 'ADMIN',
      content: body.content,
      isInternal: body.isInternal,
    });
    return c.json(safeJson({ ok: true, message: msg }));
  });

  app.patch('/api/admin/support/tickets/:ticketId', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const ticketId = req.params['ticketId'];
    if (!ticketId) return c.json({ error: 'Missing ticketId' }, 400);
    const body = req.body as { status?: TicketStatus; priority?: TicketPriority; pin?: boolean; star?: boolean };

    let result: unknown = null;
    if (body.status) result = await updateTicketStatus(prisma, ticketId, body.status, gate.userId);
    if (body.priority) result = await updateTicketPriority(prisma, ticketId, body.priority);
    if (body.pin !== undefined) result = await toggleTicketPin(prisma, ticketId);
    if (body.star !== undefined) result = await toggleTicketStar(prisma, ticketId);

    if (!result) return c.json({ error: 'No action taken' }, 400);
    return c.json(safeJson({ ok: true, ticket: result }));
  });

  // ════════════════════════════════════════════════════════════════════════
  //  BILLING — Stripe checkout, webhook, manual activation, WhatsApp link
  //
  //  Two payment paths converge into the same `payment_events` ledger:
  //    1. Stripe-driven (automated card payments)
  //    2. WhatsApp/cash-driven (manual activation by support agents)
  //
  //  See `src/services/subscriptionService.ts` for the transaction semantics.
  // ════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/billing/checkout — create a Stripe Checkout Session for the
   * authenticated user's workspace. The workspaceId + tier are injected into
   * `session.metadata` so the webhook can link the resulting customer back
   * to our DB. Frontend redirects the browser to `session.url`.
   */
  app.post('/api/billing/checkout', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);

    const body = req.body as { workspaceId?: string; tier?: SubscriptionTier };
    const workspaceId = body.workspaceId?.trim();
    const tier: SubscriptionTier = body.tier === 'PREMIUM' ? 'PREMIUM' : 'PREMIUM'; // only PREMIUM today
    if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400);

    // Membership gate — only members of the workspace may pay for it.
    const member = await checkMember(userId, workspaceId);
    if (!member) return c.json({ error: 'Forbidden' }, 403);
    if (member.role !== WorkspaceRole.OWNER) {
      return c.json({ error: 'Only the workspace owner can manage billing' }, 403);
    }

    const priceId = process.env['STRIPE_PREMIUM_PRICE_ID'];
    if (!priceId) return c.json({ error: 'Billing is not configured on this server' }, 503);

    const publicUrl = process.env['PUBLIC_APP_URL']?.replace(/\/$/, '') ?? '';
    if (!publicUrl) return c.json({ error: 'PUBLIC_APP_URL is not set' }, 503);

    let stripe;
    try { stripe = getStripe(); }
    catch (e) {
      if (e instanceof StripeNotConfiguredError) return c.json({ error: e.message }, 503);
      throw e;
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return c.json({ error: 'User not found' }, 404);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      // Metadata is the link from Stripe back to our workspace identity.
      // Verified inside the webhook before we mutate anything.
      metadata: { workspaceId, tier, userId },
      subscription_data: {
        metadata: { workspaceId, tier, userId },
      },
      success_url: `${publicUrl}/settings?billing=success`,
      cancel_url:  `${publicUrl}/settings?billing=cancel`,
    });

    return c.json({ url: session.url, id: session.id });
  });

  /**
   * POST /api/webhooks/stripe — receive subscription lifecycle events.
   *
   * Three security requirements (non-negotiable):
   *   1. Read the raw request body BEFORE Hono touches it as JSON, so the
   *      signature verification has the byte-exact payload Stripe signed.
   *   2. Verify the signature via `stripe.webhooks.constructEvent`.
   *   3. Dedupe by Stripe event.id inside the same transaction as the state
   *      change (see `runDedupedTx` in subscriptionService).
   */
  app.post('/api/webhooks/stripe', async (c) => {
    const signature = c.req.header('stripe-signature');
    if (!signature) return c.json({ error: 'Missing stripe-signature header' }, 400);

    // CRITICAL: read raw body, NOT c.req.json(). Stripe signed the bytes;
    // any JSON re-serialisation would break verification.
    const rawBody = await c.req.raw.text();

    let stripe;
    let webhookSecret: string;
    try {
      stripe = getStripe();
      webhookSecret = getStripeWebhookSecret();
    } catch (e) {
      if (e instanceof StripeNotConfiguredError) {
        console.error('[stripe-webhook] not configured:', e.message);
        return c.json({ error: 'Payment service unavailable' }, 503);
      }
      throw e;
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      console.error('[stripe-webhook] signature verification failed:', err);
      return c.json({ error: 'Invalid signature' }, 400);
    }

    try {
      const outcome = await handleStripeWebhookEvent(prisma, event);
      // Stripe stops retrying on any 2xx — that's the contract for processed,
      // duplicate, AND unhandled event types. We still log internally.
      if (!outcome.ok) {
        console.error('[stripe-webhook] handler returned not-ok:', outcome.reason, event.id);
        return c.json({ received: true, ok: false, reason: outcome.reason }, 200);
      }
      if (!outcome.processed) {
        console.log('[stripe-webhook] no-op:', outcome.reason, event.id);
      } else {
        console.log('[stripe-webhook] processed:', outcome.reason, event.id);
      }
      return c.json({ received: true, ok: true, processed: outcome.processed });
    } catch (err) {
      console.error('[stripe-webhook] handler crashed for event', event.id, err);
      // Return 500 so Stripe retries — the failure was on our side, not theirs.
      return c.json({ error: 'Internal error processing webhook' }, 500);
    }
  });

  /**
   * GET /api/webhooks/meta — subscription handshake.
   * Meta calls this once when you (re)subscribe the callback URL: echo back
   * hub.challenge iff hub.verify_token matches META_VERIFY_TOKEN.
   */
  app.get('/api/webhooks/meta', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');
    const expected = config.meta.verifyToken;
    if (!expected) {
      console.error('[meta-webhook] META_VERIFY_TOKEN not set — cannot verify subscription');
      return c.text('Forbidden', 403);
    }
    if (mode === 'subscribe' && token === expected) {
      console.log('[meta-webhook] subscription handshake OK');
      return c.text(challenge ?? '');
    }
    console.error('[meta-webhook] handshake failed — mode/token mismatch');
    return c.text('Forbidden', 403);
  });

  /**
   * POST /api/webhooks/meta — receive ad-account/campaign change notifications.
   *
   * Mirrors the Stripe webhook contract:
   *   1. Read the RAW body (c.req.raw.text()) — Meta signed the bytes; any
   *      JSON re-serialisation would break HMAC verification.
   *   2. Verify X-Hub-Signature-256 (constant-time, length-guarded).
   *   3. Ack 200 within Meta's ~3s budget, then process in the background.
   *      Processing is debounced per account (see metaWebhook.ts).
   */
  app.post('/api/webhooks/meta', async (c) => {
    const appSecret = config.meta.appSecret;
    if (!appSecret) {
      console.error('[meta-webhook] META_APP_SECRET not configured');
      return c.text('Forbidden', 403);
    }
    const signature = c.req.header('x-hub-signature-256');
    const rawBody = await c.req.raw.text();
    if (!verifyMetaSignature(rawBody, signature, appSecret)) {
      console.error('[meta-webhook] signature verification failed');
      return c.text('Invalid signature', 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.text('Bad Request', 400);
    }

    // Ack immediately; never block Meta on our processing. When BULLMQ is
    // enabled we enqueue the payload onto the maintenance queue so a crashed
    // API instance still has the event durably queued; otherwise the original
    // setImmediate body runs in-process exactly as before.
    enqueueOrFallback(
      () => getQueues()!.maintenance.add('webhook-event', { payload }),
      () => {
        setImmediate(() => {
          void processMetaWebhookEvent(prisma, payload).catch((err) => {
            console.error('[meta-webhook] background processing error:', err);
          });
        });
      },
    );
    return c.text('OK', 200);
  });

  /**
   * POST /api/webhooks/meta/data-deletion — Meta Data Deletion Request
   * Callback. Fired when a person removes the app from their Facebook/Meta
   * settings. Body is form-encoded with a `signed_request` (HMAC-SHA256,
   * app-secret signed). Must respond with { url, confirmation_code } per
   * Meta's spec; the url is a human-readable status page.
   */
  app.post('/api/webhooks/meta/data-deletion', async (c) => {
    const appSecret = config.meta.appSecret;
    if (!appSecret) {
      console.error('[meta-data-deletion] META_APP_SECRET not configured');
      return c.json({ error: 'Not configured' }, 500);
    }

    let signedRequest = '';
    try {
      const form = await c.req.parseBody();
      const raw = form['signed_request'];
      if (typeof raw === 'string') signedRequest = raw;
    } catch {
      // fall through to the empty-string rejection below
    }

    const payload = signedRequest ? parseSignedRequest(signedRequest, appSecret) : null;
    if (!payload?.user_id) {
      console.error('[meta-data-deletion] invalid or unsigned request rejected');
      return c.json({ error: 'Invalid signed_request' }, 400);
    }

    const result = await handleMetaDataDeletion(prisma, String(payload.user_id));

    // Meta requires an absolute status URL. Derive the origin from the
    // configured OAuth redirect (same host as this app), falling back to
    // the request's own origin.
    let origin: string;
    try {
      origin = new URL(config.meta.redirectUri).origin;
    } catch {
      origin = new URL(c.req.url).origin;
    }
    return c.json({
      url: `${origin}/data-deletion?code=${result.confirmationCode}`,
      confirmation_code: result.confirmationCode,
    });
  });

  /**
   * POST /api/admin/subscriptions/activate-manual — platform-admin only.
   *
   * Used by support agents after the customer pays via WhatsApp / Zain Cash
   * / bank wire. Writes the ACTIVE state + a ledger row carrying the
   * transfer reference and the agent's identity for the audit trail.
   */
  app.post('/api/admin/subscriptions/activate-manual', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const body = req.body as {
      workspaceId?: string;
      tier?: SubscriptionTier;
      expiresAt?: string;       // ISO date
      note?: string;
      externalRef?: string;
      amountMinor?: number | string;
      currency?: string;
    };

    const workspaceId = body.workspaceId?.trim();
    const tier: SubscriptionTier = body.tier === 'FREE' ? 'FREE' : 'PREMIUM';
    if (!workspaceId)     return c.json({ error: 'workspaceId is required' }, 400);
    if (!body.expiresAt)  return c.json({ error: 'expiresAt is required (ISO date)' }, 400);
    const expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return c.json({ error: 'expiresAt must be a valid ISO date' }, 400);
    }

    const exists = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!exists) return c.json({ error: 'Workspace not found' }, 404);

    const result = await activateManual(prisma, {
      workspaceId,
      tier,
      expiresAt,
      ...(body.note ? { note: body.note } : {}),
      ...(body.externalRef ? { externalRef: body.externalRef } : {}),
      ...(body.amountMinor != null ? { amountMinor: BigInt(body.amountMinor) } : {}),
      ...(body.currency ? { currency: body.currency } : {}),
      triggeredBy: gate.userId,
    });
    return c.json(safeJson(result));
  });

  /**
   * GET /api/admin/meta-usage
   * Returns current Meta API call counter (cumulative toward the
   * upgrade threshold) and latest x-app-usage snapshot.
   *
   * Auth: platform-admin (owner) only, via requirePlatformAdmin. The usage
   * ledger exposes app-wide Meta quota consumption, so it is restricted to
   * the platform owner rather than any authenticated user.
   */
  app.get('/api/admin/meta-usage', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const stats = await getMetaUsageStats();
    return c.json(safeJson(stats));
  });

  // Platform-admin: Meta account lifecycle audit trail (connected / disconnected
  // / token expired / reconnect required). Read-only; newest first. Optional
  // ?workspaceId= scopes to one workspace, ?limit= caps rows (default 100).
  app.get('/api/admin/meta-audit', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);
    const workspaceId = c.req.query('workspaceId') ?? undefined;
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const events = await listMetaAuditEvents(prisma, {
      workspaceId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return c.json(safeJson({ events }));
  });

  // ── Partner-Access "Add a Client" onboarding (platform-admin) ─────────────
  // Read-only helpers that back the guided operator screen at /admin/add-client.
  // They discover the ad accounts currently visible to the app's System User
  // token and cross-reference the DB so the operator can watch a newly-approved
  // Partner-Access grant appear live, with each account's currency surfaced.

  /**
   * Discover every ad account visible to the System User token, marking whether
   * each is already linked to an Adlytic workspace.
   *
   * Not configured (no token) → { configured:false, reason }.
   * Meta call failure          → { configured:true, error } (sanitized).
   */
  app.get('/api/admin/meta/discover-accounts', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const token = normalizeEnvAccessToken(config.meta.systemUserToken);
    if (!token) {
      return c.json({
        configured: false,
        reason: 'META_SYSTEM_USER_TOKEN is not set on this server.',
      }, 200);
    }

    try {
      const oauth = buildMetaOAuth();
      let businessName: string | undefined;
      let accounts;
      if (oauth) {
        const resolved = await oauth.resolveSystemUserConnection(token);
        businessName = resolved.businessName;
        accounts = resolved.accounts;
      } else {
        accounts = await fetchMetaAdAccountsByToken(token, config.meta.apiVersion);
        businessName = accounts.find(a => a.business?.name)?.business?.name;
      }

      // Cross-reference the DB once to mark linked accounts + owning workspace.
      const linkedRows = await prisma.adAccount.findMany({
        select: { externalAccountId: true, workspaceId: true },
      });
      const linkedMap = new Map<string, string>();
      for (const row of linkedRows) linkedMap.set(row.externalAccountId, row.workspaceId);

      return c.json({
        configured: true,
        businessName: businessName ?? null,
        accounts: accounts.map(a => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          accountStatus: a.account_status,
          linked: linkedMap.has(a.id),
          linkedWorkspaceId: linkedMap.get(a.id) ?? null,
        })),
      });
    } catch (err) {
      console.error('[admin:add-client] discover-accounts failed:', summarizeMetaAuthError(err));
      return c.json({ configured: true, error: summarizeMetaAuthError(err) });
    }
  });

  // ── Connection Orchestrator (platform-admin) ──────────────────────────────
  // Thin HTTP skin over src/orchestrator/engine.ts. All state-machine logic
  // lives in the engine; these routes only translate HTTP ⇄ engine calls so
  // the same behavior is reachable from the poller and from the operator UI.

  /**
   * POST /api/admin/onboarding — start (or re-attach to) an onboarding.
   * Body: { workspaceId, externalAccountId }. Idempotent by contract: a
   * double-click returns the existing in-flight record, never a duplicate.
   */
  app.post('/api/admin/onboarding', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const body = req.body as { workspaceId?: string; externalAccountId?: string };
    const workspaceId = body.workspaceId?.trim();
    const rawAccountId = body.externalAccountId?.trim();
    if (!workspaceId || !rawAccountId) {
      return c.json({ error: 'workspaceId and externalAccountId are required' }, 400);
    }
    // Operators paste bare digits from the Meta UI; the platform-wide
    // convention is the act_ prefix.
    const externalAccountId = /^\d+$/.test(rawAccountId) ? `act_${rawAccountId}` : rawAccountId;

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!workspace) return c.json({ error: 'Workspace not found' }, 404);

    const record = await createOnboarding(prisma, { workspaceId, externalAccountId });
    return c.json(safeJson({ ok: true, onboarding: record }), 201);
  });

  /** GET /api/admin/onboarding?workspaceId= — all records for a workspace. */
  app.get('/api/admin/onboarding', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const workspaceId = c.req.query('workspaceId')?.trim();
    if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400);

    const records = await prisma.connectionOnboarding.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return c.json(safeJson({ onboardings: records }));
  });

  /** GET /api/admin/onboarding/:id — record + full audit timeline. */
  app.get('/api/admin/onboarding/:id', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const id = c.req.param('id');
    const record = await prisma.connectionOnboarding.findUnique({ where: { id } });
    if (!record) return c.json({ error: 'Onboarding not found' }, 404);
    const timeline = await getTimeline(prisma, id);
    return c.json(safeJson({ onboarding: record, timeline }));
  });

  /**
   * POST /api/admin/onboarding/:id/check — the operator's "تحقق الآن" nudge.
   * Reconcile against provider truth FIRST (so a crash-window inconsistency
   * is corrected before we act on it), then advance one step.
   */
  app.post('/api/admin/onboarding/:id/check', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const id = c.req.param('id');
    const existing = await prisma.connectionOnboarding.findUnique({ where: { id } });
    if (!existing) return c.json({ error: 'Onboarding not found' }, 404);

    await reconcileOnboarding(prisma, id, metaAdapter);
    const record = await advanceOnboarding(prisma, id, metaAdapter);
    const timeline = await getTimeline(prisma, id);
    return c.json(safeJson({ ok: true, onboarding: record, timeline }));
  });

  /**
   * Check whether a specific ad account is visible to the System User token yet
   * (the "check status" step of the onboarding checklist). Accepts a bare
   * numeric id or an `act_`-prefixed id.
   */
  app.get('/api/admin/meta/check-account', async (c) => {
    const req = await honoToApiRequest(c);
    const gate = await requirePlatformAdmin(req, prisma);
    if (!gate.ok) return c.json(gate.response.body, gate.response.status as 401 | 403 | 503);

    const token = normalizeEnvAccessToken(config.meta.systemUserToken);
    if (!token) {
      return c.json({
        configured: false,
        reason: 'META_SYSTEM_USER_TOKEN is not set on this server.',
      }, 200);
    }

    const raw = (c.req.query('adAccountId') ?? '').trim();
    if (!raw) return c.json({ error: 'adAccountId is required' }, 400);
    // Normalize: accept bare digits or an existing act_ prefix.
    const adAccountId = /^\d+$/.test(raw) ? `act_${raw}` : raw;

    try {
      const oauth = buildMetaOAuth();
      const accounts = oauth
        ? (await oauth.resolveSystemUserConnection(token)).accounts
        : await fetchMetaAdAccountsByToken(token, config.meta.apiVersion);
      const match = accounts.find(a => a.id === adAccountId);
      if (!match) return c.json({ visible: false });
      return c.json({
        visible: true,
        account: {
          id: match.id,
          name: match.name,
          currency: match.currency,
          accountStatus: match.account_status,
        },
      });
    } catch (err) {
      console.error('[admin:add-client] check-account failed:', summarizeMetaAuthError(err));
      return c.json({ configured: true, error: summarizeMetaAuthError(err) });
    }
  });

  /**
   * POST /api/meta/data-deletion
   * Meta's Data Deletion Callback. Meta POSTs a `signed_request` (form-encoded)
   * when a user removes the app from their Facebook Business Integrations. We
   * verify the HMAC-SHA256 signature with META_APP_SECRET, then respond with the
   * `{ url, confirmation_code }` contract Meta requires.
   *
   * Adlytic stores only aggregated advertising metrics tied to an advertiser's
   * ad account — never the individual Meta end-user's personal profile — so
   * there is no per-end-user personal record to purge here. The request is
   * logged (audit trail) and acknowledged with a trackable confirmation code
   * pointing at the public /data-deletion status page.
   */
  app.post('/api/meta/data-deletion', async (c) => {
    const appSecret = config.meta.appSecret;
    if (!appSecret) {
      return c.json({ error: 'Data deletion callback is not configured' }, 503);
    }

    // Meta sends application/x-www-form-urlencoded with a single field.
    let signedRequest: string | undefined;
    try {
      const body = await c.req.parseBody();
      const raw = body['signed_request'];
      if (typeof raw === 'string') signedRequest = raw;
    } catch {
      /* fall through to 400 below */
    }
    if (!signedRequest) {
      return c.json({ error: 'Missing signed_request' }, 400);
    }

    const parsed = parseMetaSignedRequest(signedRequest, appSecret);
    if (!parsed.ok) {
      return c.json({ error: parsed.reason }, 400);
    }

    const metaUserId = String(parsed.payload['user_id'] ?? 'unknown');
    const confirmationCode = randomBytes(12).toString('hex');
    console.log(
      `[meta-data-deletion] request received user_id=${metaUserId} code=${confirmationCode}`,
    );

    const base = (config.meta.redirectUri || '')
      .replace(/\/meta\/oauth\/callback\/?$/, '')
      .replace(/\/$/, '');
    const statusUrl = `${base}/data-deletion?code=${confirmationCode}`;

    return c.json({ url: statusUrl, confirmation_code: confirmationCode });
  });

  /**
   * GET /api/billing/whatsapp-link?workspaceId=... — return a pre-filled
   * wa.me deep link the frontend renders as the "Pay via WhatsApp" CTA.
   *
   * Auth: any authenticated workspace member. Agents follow the link the
   * user opened from their own dashboard, so the message carries the
   * customer's identity verbatim.
   */
  app.get('/api/billing/whatsapp-link', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);

    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400);

    const member = await checkMember(userId, workspaceId);
    if (!member) return c.json({ error: 'Forbidden' }, 403);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return c.json({ error: 'User not found' }, 404);

    try {
      const link = buildWhatsappLink({ workspaceId, userEmail: user.email });
      return c.json(link);
    } catch (e) {
      console.error('[whatsapp-link] env error:', e);
      return c.json({ error: 'WhatsApp support channel is not configured' }, 503);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  SETTINGS — workspace read / update
  // ════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/workspaces/:workspaceId/token-health — probe stored Meta tokens.
   *
   * Returns `{ ok: true }` when every account token decrypts with the current
   * key, or `{ ok: false, code: 'TOKEN_DECRYPT_FAILED', ... }` when any fail.
   */
  app.get('/api/workspaces/:workspaceId/token-health', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const workspaceId = req.params['workspaceId'];
    if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
    const member = await checkMember(userId, workspaceId);
    if (!member) return c.json({ error: 'Access denied' }, 403);
    // Phase 2 — Redis-backed read-through cache (60s TTL). Falls back to a
    // live probe transparently when Redis is unavailable; semantics are
    // identical to the unwrapped path either way.
    const health = await getCachedWorkspaceTokenHealth(prisma, workspaceId);
    return c.json(health, health.ok ? 200 : 503);
  });

  /** GET /api/workspaces/:workspaceId — workspace settings. */
  app.get('/api/workspaces/:workspaceId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const member = await checkMember(userId, req.params['workspaceId']);
    if (!member) return c.json({ error: 'Access denied' }, 403);
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.params['workspaceId'] },
      include: {
        industryProfile: true,
        adAccounts: {
          select: { id: true, name: true, currency: true, currencyMinorFactor: true, status: true, lastSyncedAt: true, externalAccountId: true, tokenExpiresAt: true },
        },
      },
    });
    for (const acct of ws.adAccounts) {
      if (currencyFactorNeedsHeal(acct.currency, acct.currencyMinorFactor)) {
        const healed = await healAccountCurrencyAndSpend(prisma, acct);
        acct.currencyMinorFactor = healed;
      }
    }
    return c.json(safeJson(ws));
  });

  /** PATCH /api/workspaces/:workspaceId — update workspace name / industry. */
  app.patch('/api/workspaces/:workspaceId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const member = await checkMember(userId, req.params['workspaceId']);
    if (!member) return c.json({ error: 'Access denied' }, 403);
    if (member.role === 'VIEWER') return c.json({ error: 'Insufficient permissions' }, 403);
    const body = req.body as { name?: string; industryProfileId?: string | null };
    const ws = await prisma.workspace.update({
      where: { id: req.params['workspaceId'] },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.industryProfileId !== undefined && { industryProfileId: body.industryProfileId }),
      },
    });
    return c.json(safeJson(ws));
  });

  // ════════════════════════════════════════════════════════════════════════
  //  MEMBERS
  // ════════════════════════════════════════════════════════════════════════

  /** GET /api/workspaces/:workspaceId/members — list workspace members. */
  app.get('/api/workspaces/:workspaceId/members', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const member = await checkMember(userId, req.params['workspaceId']);
    if (!member) return c.json({ error: 'Access denied' }, 403);
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: req.params['workspaceId'] },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    return c.json(safeJson(members));
  });

  /** POST /api/workspaces/:workspaceId/members — add a user by userId. */
  app.post('/api/workspaces/:workspaceId/members', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const callerId = await getUserId(req.bearerToken);
    if (!callerId) return c.json({ error: 'Invalid token' }, 401);
    const callerMs = await checkMember(callerId, req.params['workspaceId']);
    if (!callerMs) return c.json({ error: 'Access denied' }, 403);
    if (callerMs.role === 'VIEWER') return c.json({ error: 'Insufficient permissions' }, 403);
    const body = req.body as { userId: string; role?: string };
    if (!body.userId?.trim()) return c.json({ error: 'userId is required' }, 400);
    const role: WorkspaceRole =
      body.role === 'OWNER' ? WorkspaceRole.OWNER
      : body.role === 'MANAGER' ? WorkspaceRole.MANAGER
      : WorkspaceRole.VIEWER;
    if (role === WorkspaceRole.OWNER && callerMs.role !== 'OWNER') {
      return c.json({ error: 'Only owners can assign the owner role' }, 403);
    }
    const targetUser = await prisma.user.findUnique({ where: { id: body.userId.trim() }, select: { id: true } });
    if (!targetUser) return c.json({ error: 'User not found' }, 404);
    const existing = await prisma.workspaceMember.findFirst({
      where: { workspaceId: req.params['workspaceId'], userId: body.userId.trim() },
    });
    if (existing) return c.json({ error: 'User is already a member of this workspace' }, 409);
    const member = await prisma.workspaceMember.create({
      data: { workspaceId: req.params['workspaceId'], userId: body.userId.trim(), role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    return c.json(safeJson(member), 201);
  });

  /** POST /api/workspaces/:workspaceId/members/invite — add a user by email. */
  app.post('/api/workspaces/:workspaceId/members/invite', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const callerId = await getUserId(req.bearerToken);
    if (!callerId) return c.json({ error: 'Invalid token' }, 401);
    const callerMs = await checkMember(callerId, req.params['workspaceId']);
    if (!callerMs) return c.json({ error: 'Access denied' }, 403);
    if (callerMs.role === 'VIEWER') return c.json({ error: 'Insufficient permissions' }, 403);
    const body = (req.body ?? {}) as { email?: string; role?: string };
    if (!body.email?.trim()) return c.json({ error: 'Email is required' }, 400);
    const role: WorkspaceRole =
      body.role === 'OWNER' ? WorkspaceRole.OWNER
      : body.role === 'MANAGER' ? WorkspaceRole.MANAGER
      : WorkspaceRole.VIEWER;
    if (role === WorkspaceRole.OWNER && callerMs.role !== 'OWNER') {
      return c.json({ error: 'Only owners can assign the owner role' }, 403);
    }
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase().trim() } });
    if (!user) return c.json({ error: 'No Adlytic account found for that email' }, 404);
    const existing = await prisma.workspaceMember.findFirst({
      where: { workspaceId: req.params['workspaceId'], userId: user.id },
    });
    if (existing) return c.json({ error: 'User is already a member of this workspace' }, 409);
    try {
      const member = await prisma.workspaceMember.create({
        data: { workspaceId: req.params['workspaceId'], userId: user.id, role },
        include: { user: { select: { id: true, email: true, name: true } } },
      });
      return c.json(safeJson(member), 201);
    } catch (err: unknown) {
      // Double-submit / race on @@unique([workspaceId, userId]) → 409, never 500.
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        return c.json({ error: 'User is already a member of this workspace' }, 409);
      }
      throw err;
    }
  });

  /** PATCH /api/workspaces/:workspaceId/members/:memberId — change role. */
  app.patch('/api/workspaces/:workspaceId/members/:memberId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const callerMembership = await checkMember(userId, req.params['workspaceId']);
    if (!callerMembership) return c.json({ error: 'Access denied' }, 403);
    if (callerMembership.role === 'VIEWER') return c.json({ error: 'Insufficient permissions' }, 403);
    const body = req.body as { role?: string };
    const role: WorkspaceRole =
      body.role === 'OWNER' ? WorkspaceRole.OWNER
      : body.role === 'MANAGER' ? WorkspaceRole.MANAGER
      : WorkspaceRole.VIEWER;
    if (role === WorkspaceRole.OWNER && callerMembership.role !== 'OWNER') {
      return c.json({ error: 'Only owners can assign the owner role' }, 403);
    }
    // Verify the target memberId actually belongs to this workspace (scope check)
    const target = await prisma.workspaceMember.findFirst({
      where: { id: req.params['memberId'], workspaceId: req.params['workspaceId'] },
    });
    if (!target) return c.json({ error: 'Member not found' }, 404);
    // MANAGERs must not demote/reassign OWNERs — only an OWNER may change an OWNER.
    if (target.role === WorkspaceRole.OWNER && callerMembership.role !== 'OWNER') {
      return c.json({ error: 'Only owners can change another owner\'s role' }, 403);
    }
    // Prevent demoting the last OWNER (workspace would become unmanageable).
    if (target.role === WorkspaceRole.OWNER && role !== WorkspaceRole.OWNER) {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId: req.params['workspaceId'], role: WorkspaceRole.OWNER },
      });
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot demote the last owner of a workspace' }, 400);
      }
    }
    const member = await prisma.workspaceMember.update({
      where: { id: req.params['memberId'] },
      data: { role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    return c.json(safeJson(member));
  });

  /** DELETE /api/workspaces/:workspaceId/members/:memberId — remove member. */
  app.delete('/api/workspaces/:workspaceId/members/:memberId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const callerMembership = await checkMember(userId, req.params['workspaceId']);
    if (!callerMembership) return c.json({ error: 'Access denied' }, 403);
    // Verify the target memberId belongs to this workspace (scope check + self-remove allowed)
    const target = await prisma.workspaceMember.findFirst({
      where: { id: req.params['memberId'], workspaceId: req.params['workspaceId'] },
    });
    if (!target) return c.json({ error: 'Member not found' }, 404);
    // Only OWNER/MANAGER can remove others; anyone can remove themselves
    if (target.userId !== userId && callerMembership.role === 'VIEWER') {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    // MANAGERs cannot remove OWNERs — only an OWNER may remove another OWNER.
    if (
      target.role === WorkspaceRole.OWNER &&
      target.userId !== userId &&
      callerMembership.role !== 'OWNER'
    ) {
      return c.json({ error: 'Only owners can remove another owner' }, 403);
    }
    // Prevent removal of the last OWNER — workspace would become unmanageable
    if (target.role === WorkspaceRole.OWNER) {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId: req.params['workspaceId'], role: WorkspaceRole.OWNER },
      });
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot remove the last owner of a workspace' }, 400);
      }
    }
    await prisma.workspaceMember.delete({ where: { id: req.params['memberId'] } });
    return c.json({ success: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  CAMPAIGNS
  // ════════════════════════════════════════════════════════════════════════

  /** GET /api/workspaces/:workspaceId/campaigns — list all campaigns. */
  app.get('/api/workspaces/:workspaceId/campaigns', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json([]);
    const campaigns = await prisma.campaign.findMany({
      where: { adAccountId: account.id },
      orderBy: { createdAt: 'desc' },
      include: {
        adSets: { select: { optimizationGoal: true, destinationType: true } },
      },
    });
    const tickToday = accountLocalTodayFloor(account.timezone);
    const campaignIds = campaigns.map((c) => c.id);
    // Per-campaign performance window (?days=7|14|30|90, default 30) — powers
    // the analytics columns in the campaigns table (spend / messages / CTR).
    const rawDays = Number(req.query['days'] ?? '30');
    const windowDays = Number.isFinite(rawDays) ? Math.min(Math.max(Math.trunc(rawDays), 1), 90) : 30;
    const scopeRaw = String(req.query['scope'] ?? 'all').toLowerCase();
    const scope: CampaignScopeFilter =
      scopeRaw === 'live' || scopeRaw === 'historical' ? scopeRaw : 'all';
    const sinceDate = accountLocalDateFloor(account.timezone, windowDays);
    // Sparkline window: last 7 days of per-campaign daily spend, zero-filled
    // so every campaign gets exactly 7 chronological points.
    const sparkDays = 7;
    const sparkSince = accountLocalDateFloor(account.timezone, sparkDays - 1);
    const [todayStats, windowAgg, sparkRows, lastSpendRows] = campaigns.length
      ? await Promise.all([
          prisma.dailyStat.findMany({
            where: {
              entityType: EntityType.CAMPAIGN,
              entityId: { in: campaignIds },
              date: tickToday,
            },
            select: { entityId: true, spend: true },
          }),
          prisma.dailyStat.groupBy({
            by: ['entityId'],
            where: {
              entityType: EntityType.CAMPAIGN,
              entityId: { in: campaignIds },
              date: { gte: sinceDate },
            },
            _sum: {
              spend: true,
              messages: true,
              impressions: true,
              clicks: true,
              purchases: true,
              leads: true,
              revenueMinor: true,
            },
            _max: { reach: true },
          }),
          prisma.dailyStat.findMany({
            where: {
              entityType: EntityType.CAMPAIGN,
              entityId: { in: campaignIds },
              date: { gte: sparkSince },
            },
            select: { entityId: true, date: true, spend: true },
          }),
          prisma.dailyStat.groupBy({
            by: ['entityId'],
            where: {
              entityType: EntityType.CAMPAIGN,
              entityId: { in: campaignIds },
              spend: { gt: 0 },
            },
            _max: { date: true },
          }),
        ])
      : [[], [], [], []];
    const spendTodayByCampaign = new Map(
      todayStats.map((s) => [s.entityId, Number(s.spend)]),
    );
    const aggByCampaign = new Map(
      windowAgg.map((a) => [a.entityId, { sum: a._sum, maxReach: a._max.reach }]),
    );
    const sparkIso: string[] = [];
    for (let i = sparkDays - 1; i >= 0; i--) {
      sparkIso.push(accountLocalDateFloor(account.timezone, i).toISOString().slice(0, 10));
    }
    const sparkByCampaign = new Map<string, Map<string, number>>();
    for (const r of sparkRows) {
      let m = sparkByCampaign.get(r.entityId);
      if (!m) { m = new Map(); sparkByCampaign.set(r.entityId, m); }
      m.set(r.date.toISOString().slice(0, 10), Number(r.spend));
    }
    const lastSpendByCampaign = new Map(
      lastSpendRows.map((r) => [r.entityId, r._max.date?.toISOString().slice(0, 10) ?? null]),
    );
    return c.json(
      campaigns
        .map((camp) => {
        const row = safeJson(camp) as Record<string, unknown>;
        const agg = aggByCampaign.get(camp.id);
        const sum = agg?.sum;
        const impressions = Number(sum?.impressions ?? 0);
        const clicks = Number(sum?.clicks ?? 0);
        const messages = Number(sum?.messages ?? 0);
        const purchases = Number(sum?.purchases ?? 0);
        const leads = Number(sum?.leads ?? 0);
        const revenueMinor = Number(sum?.revenueMinor ?? 0);
        const reach = Number(agg?.maxReach ?? 0); // best-effort unique (max daily reach)
        const spendTodayMinor = spendTodayByCampaign.get(camp.id) ?? 0;
        const spendWindowMinor = Number(sum?.spend ?? 0);
        const factor = resolveCurrencyMinorFactor(account.currency, account.currencyMinorFactor);
        const windowTotals = {
          spendMinor: spendWindowMinor,
          impressions,
          reach,
          clicks,
          messages,
          purchases,
          leads,
          revenueMinor,
        };
        // Purpose BEFORE KPIs: ENGAGEMENT + CONVERSATIONS → messaging, not clicks.
        const purpose = resolveCampaignPurpose({
          objective: camp.objective,
          optimizationGoals: (camp.adSets ?? []).map((a) => a.optimizationGoal),
          destinationTypes: (camp.adSets ?? []).map((a) => a.destinationType),
          messagesWindow: messages,
          clicksWindow: clicks,
        });
        const kpiSpec = purpose.kpi;
        const purposeKey = purposeToObjectiveKey(purpose.family, camp.objective);
        const resultsWindow = resultCountForObjective(purposeKey, windowTotals);
        const costPerResultMajor = efficiencyForObjective(purposeKey, windowTotals, factor);
        const deliveryTier = classifyCampaignDelivery({
          status: camp.status,
          metaEffectiveStatus: camp.metaEffectiveStatus,
          spendTodayMinor,
          spendWindowMinor,
        });
        // Strip nested adSets from list payload (include was for purpose only).
        const { adSets: _adSets, ...campRow } = row as Record<string, unknown> & { adSets?: unknown };
        return {
          ...campRow,
          deliveryTier,
          deliveringInWindow: deliveryTier === 'DELIVERING_TODAY' || deliveryTier === 'DELIVERING_WINDOW',
          isDormantActive: deliveryTier === 'DORMANT_ACTIVE',
          isCurrentlySpending: isCurrentlySpending({
            status: camp.status,
            spendTodayMinor,
          }),
          lastSpendDate: lastSpendByCampaign.get(camp.id) ?? null,
          windowDays,
          spendWindowMinor,
          // Legacy alias — kept so older clients don't break. Prefer resultsWindow.
          messagesWindow: messages,
          impressionsWindow: impressions,
          clicksWindow: clicks,
          purchasesWindow: purchases,
          leadsWindow: leads,
          reachWindow: reach,
          resultsWindow,
          resultLabelAr: kpiSpec.resultLabelAr,
          efficiencyLabelAr: kpiSpec.efficiencyLabelAr,
          kpiFamily: kpiSpec.family,
          purposeLabelAr: purpose.labelAr,
          purposeReason: purpose.reason,
          optimizationGoal: purpose.optimizationGoal,
          // MAJOR units (or null). List UI multiplies by currencyMinorFactor for money keys.
          costPerResult: costPerResultMajor,
          ctrWindow: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : null,
          spark: sparkIso.map((d) => {
            const v = sparkByCampaign.get(camp.id)?.get(d);
            return v == null ? null : v;
          }),
        };
      })
        .filter((row) => matchesCampaignScope(row.deliveryTier, scope)),
    );
  });

  /**
   * GET /api/workspaces/:workspaceId/export/campaigns.csv — client-facing CSV
   * of every campaign (name, status, objective, budgets, created). UTF-8 BOM +
   * CRLF so Excel opens Arabic correctly. Auth via bearer (the frontend fetches
   * with the header, then triggers a blob download).
   */
  app.get('/api/workspaces/:workspaceId/export/campaigns.csv', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'No ad account connected' }, 404);
    const campaigns = await prisma.campaign.findMany({
      where: { adAccountId: account.id },
      orderBy: { createdAt: 'desc' },
    });
    const csv = campaignsToCsv(campaigns, account);
    const stamp = new Date().toISOString().slice(0, 10);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="campaigns-${stamp}.csv"`);
    return c.body(csv);
  });

  /**
   * GET /api/workspaces/:workspaceId/export/insights.csv?days=90 — daily
   * account-level metrics (spend, impressions, reach, clicks, CTR, CPM,
   * messages, purchases) as CSV.
   */
  app.get('/api/workspaces/:workspaceId/export/insights.csv', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'No ad account connected' }, 404);
    const days = Math.min(Number(req.query['days'] ?? '90'), 365);
    const sinceDate = accountLocalDateFloor(account.timezone, days);
    const stats = await prisma.dailyStat.findMany({
      where: { entityType: EntityType.ACCOUNT, entityId: account.id, date: { gte: sinceDate } },
      orderBy: { date: 'desc' },
    });
    const csv = insightsToCsv(stats, account);
    const stamp = new Date().toISOString().slice(0, 10);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="insights-${stamp}.csv"`);
    return c.body(csv);
  });

  /** GET /api/workspaces/:workspaceId/campaigns/:campaignId — single campaign. */
  app.get('/api/workspaces/:workspaceId/campaigns/:campaignId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'Not found' }, 404);
    const campaign = await prisma.campaign.findFirstOrThrow({
      where: { id: req.params['campaignId'], adAccountId: account.id },
      include: { adSets: { include: { ads: true } } },
    });
    return c.json(safeJson(campaign));
  });

  /**
   * GET /api/workspaces/:workspaceId/campaigns/:campaignId/inspector
   *
   * Deep-dive payload for the campaign inspector drawer. Returns three blocks:
   *
   *   • summary   — financial + KPI totals over the requested window
   *                 (default 30d), plus current daily/lifetime budget.
   *                 Spend & revenue stay in BigInt MINOR units; the client
   *                 formats via account.currencyMinorFactor.
   *
   *   • timeline  — chronological CampaignBrainSnapshot rows (newest first),
   *                 surface columns + narration_json. Read-only history; no
   *                 payload decoding here — the dashboard already has helpers
   *                 for that and we keep this endpoint narrow on purpose.
   *
   *   • signals   — positive / negative deltas derived by comparing the
   *                 most recent 7d window against the prior 7d for CTR,
   *                 frequency, costPerMessage and finalScore. Pure data,
   *                 no LLM call (UI labels are added on the client to keep
   *                 i18n decisions out of the API).
   *
   * No new schema, no new repo — direct Prisma reads scoped to the account.
   */
  app.get('/api/workspaces/:workspaceId/campaigns/:campaignId/inspector', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'Not found' }, 404);

    const days = Math.max(7, Math.min(90, Number(c.req.query('days') ?? 30)));

    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params['campaignId'], adAccountId: account.id },
      include: { adSets: { select: { optimizationGoal: true, destinationType: true } } },
    });
    if (!campaign) return c.json({ error: 'Not found' }, 404);

    const since = new Date(Date.now() - days * 86400 * 1000);

    const [dailyStats, snapshots, campaignWithAds, breakdownRows] = await Promise.all([
      prisma.dailyStat.findMany({
        where: { entityType: EntityType.CAMPAIGN, entityId: campaign.id, date: { gte: since } },
        orderBy: { date: 'desc' },
      }),
      prisma.campaignBrainSnapshot.findMany({
        where: { campaignId: campaign.id, tickDate: { gte: since } },
        orderBy: { tickDate: 'desc' },
      }),
      // Phase 5 — Creatives tab. Walk the relation graph from the CAMPAIGN
      // root: Campaign → AdSets → Ads → AdCreative. We previously filtered
      // ads with `where: { adSet: { campaignId } }`, which is syntactically
      // valid but harder to reason about — flattening from the campaign root
      // makes it explicit which ad_sets we're traversing and surfaces a NULL
      // adSets array immediately if the relation is somehow broken. We do the
      // 50-row cap after flatten so a single huge ad set can't crowd out
      // smaller ones.
      prisma.campaign.findUnique({
        where: { id: campaign.id },
        select: {
          adSets: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              ads: {
                include: { creative: true },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      }),
      // Phase 5 Pass C — Audience tab. Pull every BreakdownStat row for this
      // campaign over the same window the summary uses. Aggregation happens
      // below in JS (small N: ~30 days × 4 dimensions × ≤10 segments).
      prisma.breakdownStat.findMany({
        where: { entityType: EntityType.CAMPAIGN, entityId: campaign.id, date: { gte: since } },
      }),
    ]);

    // Flatten Campaign → AdSets → Ads, preserving the parent AdSet name on
    // each ad. Sort desc by createdAt so a brand-new ad lands first, then
    // cap at 50 — a busy account's grid stays useful, the wire stays lean.
    const flatAds = (campaignWithAds?.adSets ?? []).flatMap((aset) =>
      aset.ads.map((ad) => ({
        ...ad,
        adSet: { id: aset.id, name: aset.name },
      }))
    );
    flatAds.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const ads = flatAds.slice(0, 50);

    // ── Summary aggregates over the window ────────────────────────────────
    //
    // CRITICAL: ratio metrics (CTR, CPC, CPM, costPerMessage) MUST be derived
    // from the windowed totals — never averaged from daily rates. A simple
    // mean of daily ratios is mathematically wrong: each day's ratio has a
    // different denominator, so the mean over-weights low-volume days. The
    // correct window-level value is (sum of numerators) / (sum of denominators).
    //
    // Concrete bug this replaces: a campaign with 17.86 USD spend and 163
    // messages over 7 days has a true cost-per-message of $0.11, but the
    // mean-of-daily-rates produced $24.20 because most days had only one
    // message and a disproportionately high single-day rate.
    //
    // Frequency stays as a simple average — cross-window unique reach is
    // not additive (a user reached on Mon and Tue is one person, not two),
    // so there is no clean total-based formula. The mean is the standard
    // industry fallback for window-level frequency.
    let spendMinor   = 0n;
    let impressions  = 0n;
    let clicks       = 0n;
    let messages     = 0n;
    let purchases    = 0n;
    let leads        = 0n;
    let revenueMinor = 0n;
    let maxReach     = 0n;
    let freqSum = 0, freqCount = 0;
    for (const d of dailyStats) {
      spendMinor   += d.spend;
      impressions  += d.impressions;
      clicks       += d.clicks;
      messages     += d.messages;
      purchases    += d.purchases;
      leads        += d.leads;
      revenueMinor += d.revenueMinor;
      if (d.reach > maxReach) maxReach = d.reach;
      if (d.frequency != null && Number.isFinite(d.frequency)) {
        freqSum += d.frequency;
        freqCount++;
      }
    }

    // Convert spend to MAJOR currency units once — the three currency-denominated
    // ratios below (CPC, CPM, costPerMessage) are returned in major units to
    // match the frontend formatter, which does `value * currencyMinorFactor`
    // and then divides by the factor again.
    const factor = resolveCurrencyMinorFactor(account.currency, account.currencyMinorFactor);
    const spendMajor    = Number(spendMinor) / factor;
    const impressionsN  = Number(impressions);
    const clicksN       = Number(clicks);
    const messagesN     = Number(messages);
    const purchasesN    = Number(purchases);
    const leadsN        = Number(leads);
    const reachN        = Number(maxReach);

    /** Safe divide: returns null on zero/non-finite denominator. */
    const safeDiv = (num: number, den: number): number | null =>
      den > 0 && Number.isFinite(num) && Number.isFinite(den) ? num / den : null;

    const avgCtr            = safeDiv(clicksN, impressionsN);                   // ratio, not %
    const avgCtrPct         = avgCtr != null ? avgCtr * 100 : null;             // percentage
    const avgCpc            = safeDiv(spendMajor, clicksN);                     // major units / click
    const avgCpm            = safeDiv(spendMajor * 1000, impressionsN);         // major units / 1000 impressions
    const avgCostPerMessage = safeDiv(spendMajor, messagesN);                   // major units / message
    const avgCostPerPurchase = safeDiv(spendMajor, purchasesN);
    const avgCostPerLead     = safeDiv(spendMajor, leadsN);
    const avgFrequency      = freqCount > 0 ? freqSum / freqCount : null;

    const windowTotals = {
      spendMinor: Number(spendMinor),
      impressions: impressionsN,
      reach: reachN,
      clicks: clicksN,
      messages: messagesN,
      purchases: purchasesN,
      leads: leadsN,
      revenueMinor: Number(revenueMinor),
    };
    // Purpose BEFORE KPIs — ENGAGEMENT+CONVERSATIONS must show messages, not clicks.
    const purpose = resolveCampaignPurpose({
      objective: campaign.objective,
      optimizationGoals: campaign.adSets.map((a) => a.optimizationGoal),
      destinationTypes: campaign.adSets.map((a) => a.destinationType),
      messagesWindow: messagesN,
      clicksWindow: clicksN,
    });
    const kpiSpec = purpose.kpi;
    const purposeKey = purposeToObjectiveKey(purpose.family, campaign.objective);
    const resultsCount = resultCountForObjective(purposeKey, windowTotals);
    const avgCostPerResult = efficiencyForObjective(purposeKey, windowTotals, factor);

    // ── Positive / negative signals: 7d vs prior 7d ──────────────────────
    // Daily rows are date-desc, so the first ≤7 are "recent", the next ≤7
    // are "prior". Same correctness rule as the window summary: ratios are
    // derived from each sub-window's totals, NOT averaged from daily rates.
    //
    // Volume metrics (spend / results) are included so "مستقر" cannot appear
    // when delivery moved sharply but rate metrics stayed flat. When the
    // prior window is too thin, we mark comparable=false so the UI shows
    // "بيانات غير كافية" instead of a false-stable green check.
    const recent = dailyStats.slice(0, 7);
    const prior  = dailyStats.slice(7, 14);
    const positive: Array<{ key: string; current: number | null; prior: number | null; deltaPct: number | null }> = [];
    const negative: Array<{ key: string; current: number | null; prior: number | null; deltaPct: number | null }> = [];

    /** Window totals → volume + derived ratios. Mirrors the summary block above. */
    function deriveWindowMetrics(rows: typeof dailyStats) {
      let sM = 0n, imp = 0n, clk = 0n, msg = 0n, purch = 0n, leadsW = 0n, rev = 0n;
      let reachMax = 0n;
      let fq = 0, fqN = 0;
      for (const r of rows) {
        sM  += r.spend;
        imp += r.impressions;
        clk += r.clicks;
        msg += r.messages;
        purch += r.purchases;
        leadsW += r.leads;
        rev += r.revenueMinor;
        if (r.reach > reachMax) reachMax = r.reach;
        if (r.frequency != null && Number.isFinite(r.frequency)) { fq += r.frequency; fqN++; }
      }
      const spendMajorW = Number(sM) / factor;
      const windowTotalsW: WindowTotals = {
        spendMinor: Number(sM),
        impressions: Number(imp),
        reach: Number(reachMax),
        clicks: Number(clk),
        messages: Number(msg),
        purchases: Number(purch),
        leads: Number(leadsW),
        revenueMinor: Number(rev),
      };
      const ctrRatio = safeDiv(Number(clk), Number(imp));
      return {
        spend: spendMajorW,
        results: resultCountForObjective(purposeKey, windowTotalsW),
        ctr:            ctrRatio != null ? ctrRatio * 100 : null,   // %, matches summary + UI
        cpm:            safeDiv(spendMajorW * 1000, Number(imp)),
        cpc:            safeDiv(spendMajorW, Number(clk)),
        costPerMessage: safeDiv(spendMajorW,         Number(msg)),
        costPerLead:    safeDiv(spendMajorW, Number(leadsW)),
        costPerPurchase: safeDiv(spendMajorW, Number(purch)),
        frequency:      fqN > 0 ? fq / fqN : null,
      };
    }
    const recentR = deriveWindowMetrics(recent);
    const priorR  = deriveWindowMetrics(prior);

    function pctChange(curr: number | null, base: number | null): number | null {
      if (curr == null || base == null || !Number.isFinite(curr) || !Number.isFinite(base)) return null;
      if (base === 0) {
        // New activity from a zero base is a material change, not "stable".
        return curr === 0 ? 0 : 100;
      }
      return ((curr - base) / base) * 100;
    }
    // Objective-aware rate signals + volume (spend / results) for honesty.
    const signalSpecs: Array<{ key: string; good: 'up' | 'down' }> = [
      { key: 'spend', good: 'up' },
      { key: 'results', good: 'up' },
      ...kpiSpec.signalKeys.map((key) => ({
        key,
        good: signalGoodDirection(key as SignalMetricKey),
      })),
    ];
    const recentDays = recent.length;
    const priorDays = prior.length;
    const recentSpend = Number(recentR.spend) || 0;
    const priorSpend = Number(priorR.spend) || 0;
    // Need both windows with real delivery before claiming "stable".
    const comparable =
      recentDays >= 3 &&
      priorDays >= 3 &&
      (recentSpend > 0 || recentR.results > 0) &&
      (priorSpend > 0 || priorR.results > 0);

    if (comparable) {
      for (const spec of signalSpecs) {
        const curr = (recentR as Record<string, number | null>)[spec.key] ?? null;
        const base = (priorR as Record<string, number | null>)[spec.key] ?? null;
        const delta = pctChange(curr, base);
        if (delta == null || Math.abs(delta) < 3) continue;            // ignore noise
        const improved = spec.good === 'up' ? delta > 0 : delta < 0;
        (improved ? positive : negative).push({ key: spec.key, current: curr, prior: base, deltaPct: delta });
      }
    }
    const signalsMeta = {
      recentDays,
      priorDays,
      comparable,
      recentSpendMajor: recentSpend,
      priorSpendMajor: priorSpend,
      recentResults: recentR.results,
      priorResults: priorR.results,
    };

    // ── Audience breakdowns (Phase 5 Pass C) ──────────────────────────────
    //
    // Group BreakdownStat rows by (breakdownKey, breakdownValue) and derive
    // cost-per-message from the WINDOW TOTALS — same correctness rule as the
    // top-level summary block (Σspend / Σmessages, never a mean of daily
    // rates). Raw Meta vocabulary (`male`/`female`/`facebook`/…) is preserved
    // verbatim in the payload; the Arabic translation happens on the client
    // so the cordon discipline stays intact.
    //
    // Output is keyed by dimension and pre-sorted: spend-desc within each
    // dimension so the heaviest segment is index 0. Top 12 per dimension —
    // enough headroom for `platform_position` (the long-tail dimension)
    // without flooding the wire.
    const BREAKDOWN_KEYS = ['age', 'gender', 'publisher_platform', 'platform_position'] as const;
    type BreakdownKey = typeof BREAKDOWN_KEYS[number];
    type BreakdownRow = {
      value: string;
      spendMinor: bigint;
      impressions: bigint;
      clicks: bigint;
      messages: bigint;
      costPerMessage: number | null;
      /** CTR as a percentage (clicks / impressions × 100). */
      ctrPct: number | null;
      /** True for the segment with the LOWEST cost-per-message in this
       *  dimension (messages ≥ 1 required so we never crown a 0-message row).
       *  At most one row per dimension is flagged. */
      isWinner: boolean;
    };
    const breakdowns: Record<BreakdownKey, BreakdownRow[]> = {
      age: [], gender: [], publisher_platform: [], platform_position: [],
    };
    // Accumulator: key → value → totals.
    const acc = new Map<string, Map<string, { spend: bigint; imp: bigint; clk: bigint; msg: bigint }>>();
    for (const k of BREAKDOWN_KEYS) acc.set(k, new Map());
    for (const r of breakdownRows) {
      const bucket = acc.get(r.breakdownKey);
      if (!bucket) continue;                        // unknown dim — ignore
      const cur = bucket.get(r.breakdownValue) ?? { spend: 0n, imp: 0n, clk: 0n, msg: 0n };
      cur.spend += r.spend;
      cur.imp   += r.impressions;
      cur.clk   += r.clicks;
      cur.msg   += r.messages;
      bucket.set(r.breakdownValue, cur);
    }
    for (const k of BREAKDOWN_KEYS) {
      const bucket = acc.get(k)!;
      const rows: BreakdownRow[] = [];
      for (const [value, t] of bucket) {
        const spendMajorW = Number(t.spend) / factor;
        const msgN = Number(t.msg);
        const impN = Number(t.imp);
        const clkN = Number(t.clk);
        const cpm = msgN > 0 && Number.isFinite(spendMajorW) ? spendMajorW / msgN : null;
        // CTR is a ratio sliced by the same segment-level totals — same rule
        // as everywhere else: numerator/denominator of WINDOW TOTALS, never
        // a mean of per-day rates.
        const ctrPct = impN > 0 ? (clkN / impN) * 100 : null;
        rows.push({
          value,
          spendMinor: t.spend,
          impressions: t.imp,
          clicks: t.clk,
          messages: t.msg,
          costPerMessage: cpm,
          ctrPct,
          isWinner: false,
        });
      }
      // Heaviest segment first — gives the UI a stable visual anchor.
      rows.sort((a, b) => (b.spendMinor > a.spendMinor ? 1 : b.spendMinor < a.spendMinor ? -1 : 0));

      // ── Winner: cheapest cost-per-message with ≥1 message ──────────────
      // Why the message-floor: a segment with 0 messages would have a null
      // costPerMessage, but even one with 1 message can hit an unrealistic
      // low (e.g. 1¢) on tiny windows. We accept that risk because the
      // alternative — requiring a sample-size threshold — would silently
      // skip new audiences the owner needs to discover. The Pass D feedback
      // loop will tighten this once we have baselines.
      let winnerIdx = -1;
      let winnerCpm = Infinity;
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx]!;
        if (row.costPerMessage == null) continue;
        if (Number(row.messages) < 1) continue;
        if (row.costPerMessage < winnerCpm) {
          winnerCpm = row.costPerMessage;
          winnerIdx = idx;
        }
      }
      if (winnerIdx >= 0) rows[winnerIdx]!.isWinner = true;

      breakdowns[k] = rows.slice(0, 12);
    }

    return c.json(safeJson({
      campaign: {
        id: campaign.id,
        externalCampaignId: campaign.externalCampaignId,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        purposeLabelAr: purpose.labelAr,
        purposeFamily: purpose.family,
        purposeReason: purpose.reason,
        purposeReasonAr: purpose.reasonAr,
        optimizationGoal: purpose.optimizationGoal,
        destinationType: purpose.destinationType,
        dailyBudgetMinor: campaign.dailyBudget,
        lifetimeBudgetMinor: campaign.lifetimeBudget,
        createdAt: campaign.createdAt,
      },
      account: {
        currency: account.currency,
        currencyMinorFactor: resolveCurrencyMinorFactor(account.currency, account.currencyMinorFactor),
      },
      summary: {
        windowDays: days,
        spendMinor,
        revenueMinor,
        impressions,
        reach: maxReach,
        clicks,
        messages,
        purchases,
        leads,
        // Purpose-aware primary result + efficiency (not raw Meta objective alone).
        results: resultsCount,
        resultKey: kpiSpec.resultKey,
        resultLabelAr: kpiSpec.resultLabelAr,
        efficiencyKey: kpiSpec.efficiencyKey,
        efficiencyLabelAr: kpiSpec.efficiencyLabelAr,
        kpiFamily: kpiSpec.family,
        purposeLabelAr: purpose.labelAr,
        avgCostPerResult,
        // All ratios derived from the windowed totals (see comment above the
        // aggregation block). avgCtr is a percentage; CPC / CPM / cost-per-
        // message are in MAJOR currency units, matching the frontend formatter
        // contract (`value * currencyMinorFactor` then `/ factor`).
        avgCtr:            avgCtrPct,
        avgCpm,
        avgCpc,
        avgFrequency,
        avgCostPerMessage,
        avgCostPerPurchase,
        avgCostPerLead,
      },
      timeline: snapshots.map((s) => ({
        tickDate:         s.tickDate,
        action:           s.action,
        priority:         s.priority,
        patternSignature: s.patternSignature,
        finalScore:       s.finalScore,
        narration:        s.narrationJson,
      })),
      signals: { positive, negative, meta: signalsMeta },
      // Per-campaign daily series for inspector charts (already loaded above).
      // Ascending calendar order; null efficiency when that day had zero results.
      // Dates are UTC YYYY-MM-DD to match the client calendar mapper.
      trendSeries: (() => {
        const asc = [...dailyStats].sort(
          (a, b) => a.date.getTime() - b.date.getTime(),
        );
        const dayTotalsOf = (d: (typeof asc)[number]): WindowTotals => ({
          spendMinor: Number(d.spend),
          impressions: Number(d.impressions),
          reach: Number(d.reach),
          clicks: Number(d.clicks),
          messages: Number(d.messages),
          purchases: Number(d.purchases),
          leads: Number(d.leads),
          revenueMinor: Number(d.revenueMinor),
        });
        const isoUtc = (d: Date): string => {
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, '0');
          const day = String(d.getUTCDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };
        return {
          dates: asc.map((d) => isoUtc(d.date)),
          windowDays: days,
          spendMinor: asc.map((d) => Number(d.spend)),
          results: asc.map((d) => resultCountForObjective(purposeKey, dayTotalsOf(d))),
          costPerResult: asc.map((d) =>
            efficiencyForObjective(purposeKey, dayTotalsOf(d), factor),
          ),
          cpm: asc.map((d) => {
            const imp = Number(d.impressions) || 0;
            if (imp <= 0) return null;
            const spendMajor = Number(d.spend) / factor;
            if (!Number.isFinite(spendMajor) || spendMajor <= 0) return null;
            return (spendMajor / imp) * 1000;
          }),
          frequency: asc.map((d) => {
            const imp = Number(d.impressions) || 0;
            if (imp <= 0) return null;
            return d.frequency == null || !Number.isFinite(d.frequency)
              ? null
              : d.frequency;
          }),
          ctr: asc.map((d) => {
            const imp = Number(d.impressions) || 0;
            if (imp <= 0) return null;
            return d.ctr == null || !Number.isFinite(d.ctr) ? null : d.ctr;
          }),
          resultKey: kpiSpec.resultKey,
          resultLabelAr: kpiSpec.resultLabelAr,
          efficiencyKey: kpiSpec.efficiencyKey,
          efficiencyLabelAr: kpiSpec.efficiencyLabelAr,
        };
      })(),
      // Phase 5 Creatives tab. Each entry = one Ad with its (optionally
      // shared) creative joined. The cordon discipline from creativeMapper
      // already normalized Meta's vocabulary into the AdCreative columns
      // we expose here — the client never sees raw `object_story_spec` etc.
      creatives: ads.map((ad) => ({
        adId:         ad.id,
        externalAdId: ad.externalAdId,
        adName:       ad.name,
        status:       ad.status,
        adSet:        ad.adSet ? { id: ad.adSet.id, name: ad.adSet.name } : null,
        // Meta's own relevance verdict (server-computed so the client stays
        // dumb). Null unless Meta graded the ad — never exposes raw enums.
        relevance:    buildAdRelevanceView(ad),
        creative: ad.creative
          ? {
              id:                 ad.creative.id,
              externalCreativeId: ad.creative.externalCreativeId,
              name:               ad.creative.name,
              thumbnailUrl:       ad.creative.thumbnailUrl,
              imageHash:          ad.creative.imageHash,
              videoId:            ad.creative.videoId,
              primaryText:        ad.creative.primaryText,
              headline:           ad.creative.headline,
              description:        ad.creative.description,
              callToActionType:   ad.creative.callToActionType,
            }
          : null,
      })),
      // Phase 5 Pass C — Audience tab. One sub-block per dimension; rows are
      // pre-sorted by spend-desc (heaviest segment first), top 12 each. Raw
      // Meta values (`male`, `facebook`, `feed`, …) are returned verbatim; the
      // client maps them to Arabic at render time.
      breakdowns,
    }));
  });

  /**
   * POST /api/workspaces/:workspaceId/campaigns/:campaignId/discover-creatives
   *
   * On-demand ad-set/ad/creative + ad-level-insight fetch for ONE campaign.
   *
   * Why this exists: the scheduled sync only walks campaigns that are ACTIVE
   * or spent within the sync window (protects Meta's per-account call-volume
   * ceiling — see syncAccount.ts). A paused campaign with no recent spend is
   * permanently skipped, so its inspector "الإبداعات" tab would show
   * "no creatives yet — they'll appear once sync completes" forever, which is
   * false: the batch sync will never revisit it. This endpoint lets the
   * merchant explicitly pull that ONE campaign's data on demand.
   *
   * Read-only against Meta (GET ad-sets/ads/insights) — not a write-action,
   * writes only to our own DB. Bounded to one campaign's worth of calls.
   */
  app.post('/api/workspaces/:workspaceId/campaigns/:campaignId/discover-creatives', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    if (!checkRateLimit(_discoverRateMap, req.params['campaignId'], 5, 15 * 60_000)) {
      return c.json({ error: 'جرّبت هذا كثيراً — انتظر قليلاً قبل إعادة المحاولة.' }, 429);
    }

    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'No ad account found for this workspace' }, 404);

    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params['campaignId'], adAccountId: account.id },
      select: { id: true },
    });
    if (!campaign) return c.json({ error: 'Campaign not found' }, 404);

    const resolvedToken = await resolveAccountToken(prisma, account);
    if (!resolvedToken.encrypted) {
      return c.json({ error: 'No access token configured — connect a Meta account first' }, 422);
    }
    if (!resolvedToken.isSystemUser && account.tokenExpiresAt && account.tokenExpiresAt < new Date()) {
      return c.json({ error: 'انتهت صلاحية رمز الوصول لحساب Meta — أعد الربط من مساحة العمل.', code: 'TOKEN_EXPIRED' }, 422);
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(resolvedToken.encrypted);
    } catch (decErr) {
      if (decErr instanceof TokenDecryptError) {
        return c.json(tokenDecryptErrorJson(), 500);
      }
      throw decErr;
    }

    const metaClient = new MetaClient({ apiVersion: config.meta.apiVersion, accessToken, timezone: account.timezone });
    const worker = new SyncAccountWorker(prisma, metaClient);
    try {
      const result = await worker.discoverCampaignOnDemand(account.id, campaign.id);
      if (!result.found) return c.json({ error: 'Campaign not found' }, 404);
      return c.json({
        ok: true,
        adSetsUpserted: result.adSetsUpserted,
        adsUpserted: result.adsUpserted,
        creativesUpserted: result.creativesUpserted,
        insightRows: result.insightRows,
      });
    } catch (err) {
      if (err instanceof MetaApiError) {
        if (err.status === 401 || err.status === 190 || (err.body as any)?.error?.code === 190) {
          await handleMeta190(prisma, {
            accountId: account.id,
            externalAccountId: account.externalAccountId,
            isSystemUser: resolvedToken.isSystemUser,
            connectionId: resolvedToken.connectionId,
            workspaceId: account.workspaceId,
          });
          return c.json({ error: 'انتهت صلاحية رمز الوصول لحساب Meta — أعد الربط من مساحة العمل.', code: 'TOKEN_EXPIRED' }, 422);
        }
        console.error('[discover-creatives] Meta upstream error:', err.status, err.message);
        return c.json({
          error: 'تعذّر جلب بيانات هذه الحملة من Meta الآن — حاول لاحقاً.',
          code: 'META_UPSTREAM',
        }, 502);
      }
      console.error('[discover-creatives] failed:', err);
      return c.json({ error: 'تعذّر جلب بيانات هذه الحملة الآن — حاول لاحقاً.' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  AD SETS
  // ════════════════════════════════════════════════════════════════════════

  /** GET /api/workspaces/:workspaceId/campaigns/:campaignId/adsets — list ad sets. */
  app.get('/api/workspaces/:workspaceId/campaigns/:campaignId/adsets', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json([]);
    const ownerCampaign = await prisma.campaign.findFirst({
      where: { id: req.params['campaignId'], adAccountId: account.id },
    });
    if (!ownerCampaign) return c.json([]);
    const adSets = await prisma.adSet.findMany({
      where: { campaignId: req.params['campaignId'] },
      orderBy: { createdAt: 'desc' },
    });
    return c.json(safeJson(adSets));
  });

  /** GET /api/workspaces/:workspaceId/adsets/:adSetId — single ad set. */
  app.get('/api/workspaces/:workspaceId/adsets/:adSetId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'Not found' }, 404);
    const adSet = await prisma.adSet.findUniqueOrThrow({
      where: { id: req.params['adSetId'] },
      include: { campaign: { select: { adAccountId: true } }, ads: true },
    });
    if (adSet.campaign.adAccountId !== account.id) return c.json({ error: 'Not found' }, 404);
    return c.json(safeJson(adSet));
  });

  // ════════════════════════════════════════════════════════════════════════
  //  ADS
  // ════════════════════════════════════════════════════════════════════════

  /** GET /api/workspaces/:workspaceId/adsets/:adSetId/ads — list ads in an ad set. */
  app.get('/api/workspaces/:workspaceId/adsets/:adSetId/ads', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json([]);
    const ownerAdSet = await prisma.adSet.findUnique({
      where: { id: req.params['adSetId'] },
      include: { campaign: { select: { adAccountId: true } } },
    });
    if (!ownerAdSet || ownerAdSet.campaign.adAccountId !== account.id) return c.json([]);
    const ads = await prisma.ad.findMany({
      where: { adSetId: req.params['adSetId'] },
      orderBy: { createdAt: 'desc' },
    });
    return c.json(safeJson(ads));
  });

  /** GET /api/workspaces/:workspaceId/ads/:adId — single ad. */
  app.get('/api/workspaces/:workspaceId/ads/:adId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'Not found' }, 404);
    const ad = await prisma.ad.findUniqueOrThrow({
      where: { id: req.params['adId'] },
      include: { adSet: { include: { campaign: { select: { adAccountId: true } } } } },
    });
    if (ad.adSet.campaign.adAccountId !== account.id) return c.json({ error: 'Not found' }, 404);
    return c.json(safeJson(ad));
  });

  // ════════════════════════════════════════════════════════════════════════
  //  INSIGHTS
  // ════════════════════════════════════════════════════════════════════════

  /** GET /api/workspaces/:workspaceId/insights — daily stats for the account. */
  app.get('/api/workspaces/:workspaceId/insights', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json([]);
    const days = Math.min(Number(req.query['days'] ?? '30'), 90);
    const sinceDate = accountLocalDateFloor(account.timezone, days);
    const stats = await prisma.dailyStat.findMany({
      where: { entityType: EntityType.ACCOUNT, entityId: account.id, date: { gte: sinceDate } },
      orderBy: { date: 'desc' },
    });
    return c.json(safeJson(stats));
  });

  /**
   * GET /api/workspaces/:workspaceId/issue-dates — Timeline Explorer markers.
   * Returns the account-level DetectedIssue rows in the window as
   * { date, issueCode, severity }[] — a direct read, no new computation.
   * Matches the scope of chart-spend-main / chart-spend (both workspace-wide
   * aggregates, not a single campaign's line) — see PHASE3_IFA_DESIGN.md §3.
   */
  app.get('/api/workspaces/:workspaceId/issue-dates', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json([]);
    const days = Math.min(Number(req.query['days'] ?? '30'), 90);
    const sinceDate = accountLocalDateFloor(account.timezone, days);
    const rows = await prisma.detectedIssue.findMany({
      where: { entityType: EntityType.ACCOUNT, entityId: account.id, date: { gte: sinceDate } },
      orderBy: { date: 'asc' },
      select: { date: true, issueCode: true, severity: true },
    });
    return c.json(rows.map(r => ({
      date: r.date.toISOString().slice(0, 10),
      issueCode: r.issueCode,
      severity: r.severity,
    })));
  });

  /**
   * GET /api/workspaces/:workspaceId/attribution?date=YYYY-MM-DD — Timeline
   * Explorer's click-to-attribute. Compares the clicked day against the same
   * weekday one week earlier (not the day before) so a Friday spike isn't
   * misattributed against a quiet Thursday — reuses attributeChange(), the
   * same deterministic engine renderAttribution() already uses for the
   * dashboard's fixed 30-day window, just called with a single-day window.
   * See PHASE3_IFA_DESIGN.md §3.
   */
  app.get('/api/workspaces/:workspaceId/attribution', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const dateParam = req.query['date'];
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
    }
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'No ad account connected' }, 404);
    const currentDate = new Date(dateParam + 'T00:00:00.000Z');
    const priorDate = new Date(currentDate.getTime() - 7 * 864e5);
    const [currentRows, priorRows] = await Promise.all([
      prisma.dailyStat.findMany({ where: { entityType: EntityType.ACCOUNT, entityId: account.id, date: currentDate } }),
      prisma.dailyStat.findMany({ where: { entityType: EntityType.ACCOUNT, entityId: account.id, date: priorDate } }),
    ]);
    const sumField = (rows: { [k: string]: any }[], f: string) => rows.reduce((a, r) => a + Number(r[f] ?? 0), 0);
    const current = { impressions: sumField(currentRows, 'impressions'), clicks: sumField(currentRows, 'clicks'), results: sumField(currentRows, 'messages') };
    const prior = { impressions: sumField(priorRows, 'impressions'), clicks: sumField(priorRows, 'clicks'), results: sumField(priorRows, 'messages') };
    const attribution = attributeChange(current, prior);
    if (!attribution) {
      return c.json({ error: 'Not enough data to attribute this day (no prior-week baseline)' }, 422);
    }
    return c.json({ date: dateParam, priorDate: priorDate.toISOString().slice(0, 10), attribution });
  });

  /**
   * GET /api/workspaces/:workspaceId/campaigns/:campaignId/creative-attribution
   *   ?date=YYYY-MM-DD
   * Timeline Explorer's per-campaign "which creative drove this day" lookup —
   * a second, narrower attribution layer alongside /attribution's
   * impressions/CTR/CVR breakdown. Reuses get_creative_performance's single-
   * day mode (task #50) via the dispatcher instead of a bespoke query, so the
   * feature extraction / correlation logic is not duplicated.
   */
  app.get('/api/workspaces/:workspaceId/campaigns/:campaignId/creative-attribution', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const { workspaceId, campaignId } = req.params;
    if (!await checkMember(userId, workspaceId)) return c.json({ error: 'Access denied' }, 403);
    const dateParam = req.query['date'];
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
    }
    const { ToolDispatcher } = await import('../services/agent/dispatcher');
    const { buildAgentToolHandlers } = await import('../services/agent/tools');
    const dispatcher = new ToolDispatcher(buildAgentToolHandlers(), { prisma, workspaceId, userId });
    const result = await dispatcher.dispatch('get_creative_performance', {
      campaignId, date: dateParam, metric: 'spend', limit: 3,
    });
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.json(safeJson(result.data));
  });

  /** GET /api/workspaces/:workspaceId/insights/trends — metric trends. */
  app.get('/api/workspaces/:workspaceId/insights/trends', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json([]);
    const trends = await prisma.metricTrend.findMany({
      where: { entityType: EntityType.ACCOUNT, entityId: account.id },
      orderBy: { date: 'desc' },
      take: 30,
    });
    return c.json(safeJson(trends));
  });

  // ════════════════════════════════════════════════════════════════════════
  //  RECOMMENDATIONS & ISSUES
  // ════════════════════════════════════════════════════════════════════════

  /** GET /api/workspaces/:workspaceId/recommendations — prioritised action list. */
  app.get('/api/workspaces/:workspaceId/recommendations', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const workspaceId = req.params['workspaceId'];
    if (!await checkMember(userId, workspaceId)) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(workspaceId);
    if (!account) return c.json([]);
    const recs = await prisma.recommendation.findMany({
      where: { entityType: EntityType.ACCOUNT, entityId: account.id },
      orderBy: [{ priority: 'desc' }, { date: 'desc' }],
    });

    // Fire-and-forget: log a snapshot for closed-loop learning. One log entry
    // per recommendations fetch summarising the top recommendation surfaced.
    //
    // V1.1.5 fix (C-1 — outcome memory): hydrate `metricsSnapshot` with the
    // real KPI values from the latest DailyStat row for the recommendation's
    // own entity (could be ACCOUNT / CAMPAIGN / ADSET / AD — we match the rec's
    // entityType+entityId, not the workspace's account, so campaign-scoped
    // recs are evaluated against campaign-scoped metrics).
    //
    // Fallback contract: if no DailyStat exists yet (entity not yet synced),
    // emit zeros — never `undefined`. `computePrimaryDelta` in the rec service
    // treats `b > 0` as the gate, so 0-baselines correctly skip delta scoring
    // without poisoning the JSON shape.
    let latestLogId: string | null = null;
    if (recs.length > 0) {
      const top = recs[0]!;
      try {
        const latestStat = await prisma.dailyStat.findFirst({
          where: {
            entityType: top.entityType,
            entityId: top.entityId,
            date: { lte: top.date },
          },
          orderBy: { date: 'desc' },
        });
        const snapshot = {
          // Canonical KPI fields — match MetricsSnapshot interface.
          ctr: latestStat?.ctr ?? 0,
          cpm: latestStat?.cpm ?? 0,
          cpc: latestStat?.cpc ?? 0,
          roas: latestStat?.roas ?? 0,
          frequency: latestStat?.frequency ?? 0,
          spend: latestStat ? Number(latestStat.spend) : 0,
          impressions: latestStat ? Number(latestStat.impressions) : 0,
          conversions: latestStat ? Number(latestStat.conversions) : 0,
          // Provenance — retained for debugging the closed-loop in prod.
          actionCode: top.actionCode,
          priority: top.priority,
          date: top.date,
          sampledFromDate: latestStat?.date ?? null,
        };
        const log = await recService.logRecommendation({
          workspaceId,
          verdict: `${top.actionCode} (${top.priority})`,
          metricsSnapshot: snapshot,
        });
        latestLogId = log.id;
      } catch (err) {
        console.error('[RecLog] failed to log recommendation:', err);
      }
    }

    if (latestLogId) c.header('X-Recommendation-Log-Id', latestLogId);
    return c.json(safeJson(recs));
  });

  /** POST /api/workspaces/:workspaceId/recommendations/action
   *  Body: { action, itemKey, itemKind?, actionCode?, campaignId?, feedKey?, title? }
   *  Records a dashboard Main Move action with stable itemKey for closed-loop filtering.
   */
  app.post('/api/workspaces/:workspaceId/recommendations/action', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const workspaceId = req.params['workspaceId'];
    if (!await checkMember(userId, workspaceId)) return c.json({ error: 'Access denied' }, 403);

    const body = await c.req.json<{
      action?: string;
      itemKey?: string;
      itemKind?: string;
      actionCode?: string | null;
      campaignId?: string | null;
      feedKey?: string | null;
      title?: string | null;
    }>();
    const action = body?.action;
    if (action !== 'EXECUTED' && action !== 'IGNORED') {
      return c.json({ error: 'action must be EXECUTED or IGNORED' }, 400);
    }
    if (!body?.itemKey || typeof body.itemKey !== 'string') {
      return c.json({ error: 'itemKey is required' }, 400);
    }

    const { account } = await getAccount(workspaceId);
    let metricsSnapshot: Record<string, unknown> = {};
    if (account && action === 'EXECUTED') {
      const latestStat = await prisma.dailyStat.findFirst({
        where: { entityType: EntityType.ACCOUNT, entityId: account.id },
        orderBy: { date: 'desc' },
      });
      metricsSnapshot = {
        ctr: latestStat?.ctr ?? 0,
        cpm: latestStat?.cpm ?? 0,
        spend: latestStat ? Number(latestStat.spend) : 0,
        impressions: latestStat ? Number(latestStat.impressions) : 0,
        conversions: latestStat ? Number(latestStat.conversions) : 0,
      };

      if (body.actionCode) {
        const rec = await prisma.recommendation.findFirst({
          where: {
            entityType: EntityType.ACCOUNT,
            entityId: account.id,
            actionCode: body.actionCode,
          },
          orderBy: [{ priority: 'desc' }, { date: 'desc' }],
        });
        if (rec) {
          try {
            await execService.recordExecution(rec.id, metricsSnapshot);
          } catch (err) {
            console.error('[RecAction] recordExecution failed:', err);
          }
        }
      }
    }

    const log = await recService.recordDashboardAction({
      workspaceId,
      action,
      itemKey: body.itemKey,
      itemKind: body.itemKind,
      actionCode: body.actionCode ?? null,
      campaignId: body.campaignId ?? null,
      feedKey: body.feedKey ?? null,
      title: body.title ?? null,
      metricsSnapshot,
    });

    // Smart Refresh Engine — recalculate intelligence NOW, not on next sync.
    // Synchronous by design: the client refetches the dashboard right after
    // this response, and that refetch must see recommendations/health that
    // already reflect the action. Scoped: only the engines a user action can
    // affect run (see planRefresh); DB-only work, bounded to a few seconds.
    let refresh: Awaited<ReturnType<typeof runRefresh>> | null = null;
    if (account) {
      refresh = await runRefresh(prisma, null, {
        type: action === 'EXECUTED' ? 'RecommendationExecuted' : 'RecommendationDismissed',
        adAccountId: account.id,
        workspaceId,
        itemKey: body.itemKey,
      });
    }
    return c.json(safeJson({ ...log, refresh: refresh ? { targetsRun: refresh.targetsRun, durationMs: refresh.durationMs } : null }));
  });

  /** GET /api/workspaces/:workspaceId/refresh-log — Smart Refresh Engine
   *  observability: the last refresh runs for this workspace's account
   *  (trigger, components run + per-component durations, skips, errors). */
  app.get('/api/workspaces/:workspaceId/refresh-log', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json([]);
    const logs = await prisma.refreshLog.findMany({
      where: { adAccountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return c.json(safeJson(logs));
  });

  /** POST /api/workspaces/:workspaceId/recommendations/:logId/action
   *  Body: { action: "EXECUTED" | "IGNORED" }
   *  Tracks the user's response to a surfaced recommendation.
   */
  app.post('/api/workspaces/:workspaceId/recommendations/:logId/action', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const workspaceId = req.params['workspaceId'];
    if (!await checkMember(userId, workspaceId)) return c.json({ error: 'Access denied' }, 403);
    const logId = req.params['logId'];
    const existing = await prisma.recommendationLog.findUnique({ where: { id: logId } });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json({ error: 'Recommendation log not found' }, 404);
    }
    const body = await c.req.json<{ action?: string }>();
    const action = body?.action;
    if (action !== 'EXECUTED' && action !== 'IGNORED') {
      return c.json({ error: 'action must be EXECUTED or IGNORED' }, 400);
    }
    const updated = await recService.trackUserAction(logId, action);
    return c.json(safeJson(updated));
  });

  /** GET /api/workspaces/:workspaceId/issues — detected issues (Rules Engine output).
   *  Latest detector run only, one row per issueCode — detectors write a full
   *  replacement set per date, so reading all dates duplicated every issue. */
  app.get('/api/workspaces/:workspaceId/issues', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json([]);
    const issues = await loadCurrentIssues(prisma, account.id);
    return c.json(safeJson(issues));
  });

  // ════════════════════════════════════════════════════════════════════════
  //  AD ASSESSOR — Meta Ad creative analysis (تحليل الإعلان)
  // ════════════════════════════════════════════════════════════════════════

  /** POST /api/ad-assessor/assess — AI-powered creative assessment (optional Adlytic grounding). */
  app.post('/api/ad-assessor/assess', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!checkRateLimit(_aiRateMap, 'assess:' + userId, 10, 10 * 60_000)) {
      return c.json({ error: 'Rate limit exceeded — try again in a few minutes' }, 429);
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : undefined;
    let adAccountId: string | undefined;
    if (workspaceId) {
      if (!await checkMember(userId, workspaceId)) return c.json({ error: 'Access denied' }, 403);
      const { account } = await getAccount(workspaceId);
      if (!account) return c.json({ error: 'Not found' }, 404);
      adAccountId = account.id;
    }

    const result = await runAdAssessment(body, {
      prisma,
      workspaceId,
      adAccountId,
    });
    if (!result.ok) {
      return c.json(
        { error: result.error, ...(result.details ? { details: result.details } : {}) },
        result.status as 400 | 503,
      );
    }
    return c.json(safeJson(result.data));
  });

  /**
   * GET /api/workspaces/:workspaceId/ad-assessor/campaigns
   * Campaign picker for advanced (Adlytic-grounded) analysis.
   */
  app.get('/api/workspaces/:workspaceId/ad-assessor/campaigns', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'Not found' }, 404);

    const campaigns = await listCampaignsForAssessor(prisma, account.id);
    return c.json(safeJson({ campaigns }));
  });

  /**
   * GET /api/workspaces/:workspaceId/ad-assessor/context?campaignId=&adId=
   * Prefill payload: live metrics, creative, diagnoses, brain, self-benchmark.
   */
  app.get('/api/workspaces/:workspaceId/ad-assessor/context', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, req.params['workspaceId'])) return c.json({ error: 'Access denied' }, 403);
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'Not found' }, 404);

    const campaignId = c.req.query('campaignId');
    if (!campaignId) return c.json({ error: 'campaignId required' }, 400);
    const adId = c.req.query('adId') || null;
    const days = Math.max(7, Math.min(90, Number(c.req.query('days') ?? 30)));

    const ctx = await assembleAdlyticAssessmentContext({
      prisma,
      workspaceId: req.params['workspaceId'],
      adAccountId: account.id,
      campaignId,
      adId,
      windowDays: days,
    });
    if (!ctx) return c.json({ error: 'Not found' }, 404);
    return c.json(safeJson(ctx));
  });

  /** POST /api/ad-assessor/ad-library/search — live Ad Library trend lookup. */
  app.post('/api/ad-assessor/ad-library/search', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);

    const result = await searchAdLibraryTrends(req.body);
    if (!result.ok) {
      return c.json(
        { error: result.error, ...(result.details ? { details: result.details } : {}) },
        result.status as 400 | 503,
      );
    }
    return c.json(safeJson(result.data));
  });

  // ════════════════════════════════════════════════════════════════════════
  //  AI CHAT — data-driven assistant using live dashboard context
  // ════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/workspaces/:workspaceId/ai/chat
   * Accepts { message: string }, returns { reply: string }.
   * Generates a data-grounded response by loading the dashboard DTO and
   * applying keyword-matched response strategies against live metrics.
   */
  app.post('/api/workspaces/:workspaceId/ai/chat', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const { workspaceId } = req.params;
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, workspaceId)) return c.json({ error: 'Access denied' }, 403);
    if (!checkRateLimit(_aiRateMap, 'chat:' + userId, 20, 10 * 60_000)) {
      return c.json({ error: 'وصلت حد الاستخدام مؤقتاً — حاول بعد دقائق قليلة.' }, 429);
    }
    if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
    const body = req.body as { message?: string };
    // Preserve original casing so metric names (CTR, CPC, CPM) survive to the LLM.
    const message = (body.message ?? '').trim().slice(0, 2000);
    if (!message) return c.json({ error: 'Message is required' }, 400);

    // Load live data for context
    let dto: Awaited<ReturnType<typeof getDashboard>> | null = null;
    try { dto = await getDashboard(workspaceId, { prisma }); } catch (err) {
      console.error('[adlytic:ai-chat] getDashboard error:', err);
    }

    // Prefer V5 intelligence report (richer, per-signal weighted context);
    // fall back to V1 DTO-derived context when the V5 report hasn't been
    // written yet for this ad account.
    let reply: string;
    try {
      let context: string | null = null;
      let primaryAccount: { id: string; currency: string; timezone: string } | undefined;
      try {
        const ws = await prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { name: true, adAccounts: { select: { id: true, currency: true, timezone: true } } },
        });
        primaryAccount = ws?.adAccounts?.[0];
        if (primaryAccount) {
          const v5 = await buildAiContextV5(prisma, primaryAccount.id, message, {
            currency: primaryAccount.currency ?? undefined,
            workspaceName: ws?.name ?? undefined,
          });
          // V5 returns a "not yet available" fallback string when no report exists.
          // Detect that and drop back to V1 rather than sending the weaker fallback.
          if (!/Intelligence data not yet available/i.test(v5)) context = v5;
        }
      } catch (err) {
        console.error('[adlytic:ai-chat] V5 context error, falling back to V1:', err);
      }
      if (!context) {
        context = buildAiContext(dto ?? { empty: true, health: { score: 0, band: 'none' }, kpis: [], trendSeries: { dates: [], messages: [], results: [], spend: [], ctr: [], frequency: [], cpm: [], costPerResult: [] }, issues: [], diagnoses: [], attribution: null, priorityAction: null, bestCampaign: null, worstCampaign: null }, message);
      }
      if (primaryAccount) {
        const campaignCtx = await buildAiCampaignContext(
          prisma,
          primaryAccount.id,
          primaryAccount.timezone,
          dto,
        );
        context = mergeCampaignBlockIntoContext(context, campaignCtx.promptBlock);
      }
      reply = await askClaude(context);
    } catch (err) {
      console.error('[adlytic:ai-chat] Claude API error:', err);
      const fallback = buildAiUnavailableReply({
        err,
        dto,
        userMessage: message,
        locale: 'AR',
      });
      // Prefer a useful offline diagnosis (200) over leaking provider JSON.
      if (fallback.usedOffline) {
        return c.json({
          reply: fallback.reply,
          code: fallback.code,
          usedOffline: true,
        });
      }
      return c.json(
        { error: fallback.reply, code: fallback.code, reply: fallback.reply },
        fallback.httpStatus as 402 | 429 | 500 | 503,
      );
    }
    return c.json({ reply });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  AI Chat v2 — Phase 2 smart CMO agent
  //
  //  POST /api/workspaces/:workspaceId/ai/chat/v2
  //  Body: { message: string, conversationId?: string, sessionContext?: object }
  //  Returns: { conversationId, reply, toolCalls: [...], latencyMs, tokensIn, tokensOut }
  //
  //  Behind AI_AGENT_V2_ENABLED env flag; when unset, returns 404 so the
  //  legacy /ai/chat above stays authoritative. See PHASE2_AI_AGENT_DESIGN.md §7.
  // ════════════════════════════════════════════════════════════════════════
  app.post('/api/workspaces/:workspaceId/ai/chat/v2', async (c) => {
    if (process.env['AI_AGENT_V2_ENABLED'] !== 'true') {
      return c.json({ error: 'AI Agent v2 is disabled', code: 'V2_DISABLED' }, 404);
    }
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const { workspaceId } = req.params;
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, workspaceId)) return c.json({ error: 'Access denied' }, 403);
    if (!checkRateLimit(_aiRateMap, 'chat:' + userId, 20, 10 * 60_000)) {
      return c.json({ error: 'وصلت حد الاستخدام مؤقتاً — حاول بعد دقائق قليلة.' }, 429);
    }
    if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);

    const body = req.body as {
      message?: string;
      conversationId?: string;
      sessionContext?: Record<string, unknown>;
    };
    const message = (body.message ?? '').trim();
    if (!message) return c.json({ error: 'Message is required' }, 400);
    if (message.length > 4000) return c.json({ error: 'Message too long (max 4000 chars)' }, 400);

    try {
      const { runAgentTurn } = await import('../services/agent/loop');
      const result = await runAgentTurn({
        prisma,
        workspaceId,
        userId,
        conversationId: body.conversationId ?? null,
        userMessage: message,
        sessionContext: body.sessionContext,
      });
      return c.json({
        conversationId: result.conversationId,
        reply: result.reply,
        toolCalls: result.toolCalls.map((tc) => ({
          toolName: tc.toolName,
          args: tc.args,
          ok: tc.result.ok,
          errorCode: tc.result.ok ? null : tc.result.error.code,
          aiMessageId: tc.aiMessageId,
        })),
        latencyMs: result.latencyMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      });
    } catch (err) {
      console.error('[adlytic:ai-chat-v2] error:', err);
      const classified = classifyLlmError(err);
      let dto: Awaited<ReturnType<typeof getDashboard>> | null = null;
      try {
        dto = await getDashboard(workspaceId, { prisma });
      } catch (dtoErr) {
        console.error('[adlytic:ai-chat-v2] offline getDashboard error:', dtoErr);
      }
      const fallback = buildAiUnavailableReply({
        err,
        dto,
        userMessage: message,
        locale: 'AR',
      });
      // Never put raw provider messages in the client payload.
      if (fallback.usedOffline) {
        return c.json({
          conversationId: body.conversationId ?? null,
          reply: fallback.reply,
          toolCalls: [],
          latencyMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          code: fallback.code,
          usedOffline: true,
        });
      }
      return c.json(
        {
          conversationId: body.conversationId ?? null,
          reply: fallback.reply,
          toolCalls: [],
          latencyMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          error: fallback.reply,
          code: fallback.code || classified.code,
        },
        fallback.httpStatus as 402 | 429 | 500 | 503,
      );
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  AI Investigation — Phase 3 IFA §1
  //
  //  POST /api/workspaces/:workspaceId/campaigns/:campaignId/investigate
  //  Returns: { campaignId, generatedAt, sections: [{key,title,status,narrative}] }
  //
  //  A fixed pipeline (5 parallel tool calls + 1 Sonnet narrative pass), not
  //  an agentic loop — see src/services/agent/investigate.ts. Gated behind
  //  the same flag as the chat agent since it shares its tool/dispatcher/
  //  post-check infrastructure. Cached 15 min per campaign — this is a
  //  deliberate "look deeper" action, not a live chat turn, so staleness on
  //  the order of minutes is expected and shown via generatedAt.
  // ════════════════════════════════════════════════════════════════════════
  app.post('/api/workspaces/:workspaceId/campaigns/:campaignId/investigate', async (c) => {
    // Investigation is tool-first (Postgres). Claude is optional polish —
    // investigateCampaign falls back to deterministic Arabic narratives.
    // Do not hard-gate on AI_AGENT_V2_ENABLED: merchants need this tab even
    // when chat v2 / Anthropic credits are down.
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const { workspaceId, campaignId } = req.params;
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!workspaceId || !campaignId) return c.json({ error: 'Missing parameters' }, 400);
    if (!await checkMember(userId, workspaceId)) return c.json({ error: 'Access denied' }, 403);
    if (!checkRateLimit(_aiRateMap, 'inv:' + userId, 6, 10 * 60_000)) {
      return c.json({ error: 'وصلت حد التحقيقات مؤقتاً — حاول بعد دقائق قليلة.' }, 429);
    }
    const { account } = await getAccount(workspaceId);
    if (!account) return c.json({ error: 'No ad account connected' }, 404);
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, adAccountId: account.id } });
    if (!campaign) return c.json({ error: 'Not found' }, 404);

    const { toolCache } = await import('../services/agent/cache');
    const { investigateCampaign } = await import('../services/agent/investigate');
    const { classifyLlmError } = await import('../lib/llmErrors');
    const cacheKey = `${workspaceId}:investigation:${campaignId}`;
    const cached = toolCache.get<Awaited<ReturnType<typeof investigateCampaign>>>(cacheKey);
    if (cached) return c.json(cached.value);

    try {
      const report = await investigateCampaign({ prisma, workspaceId, userId, campaignId });
      toolCache.set(cacheKey, report, 900);
      return c.json(report);
    } catch (err) {
      console.error('[adlytic:investigate] error:', err);
      const classified = classifyLlmError(err);
      // Prefer a friendly Arabic message — never leak Anthropic JSON.
      return c.json(
        {
          error: classified.messageAr,
          code: classified.code,
        },
        classified.httpStatus === 402 ? 503 : (classified.httpStatus as 429 | 500 | 503),
      );
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  META ADS — OAuth flow + ad-account management
  // ════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/meta/oauth/start?workspaceId=xxx
   * Returns { url } to redirect the user to Facebook's consent screen.
   * Returns { configured: false } when META_APP_ID / META_APP_SECRET are absent
   * so the UI can fall back to manual token entry.
   */
  app.get('/api/meta/oauth/start', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);

    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400);

    // Resolve userId from bearer token
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    if (!await checkMember(userId, workspaceId)) return c.json({ error: 'Access denied' }, 403);

    // ── Mock-auth escape hatch ──────────────────────────────────────────
    // When META_MOCK_AUTH=true, bypass Facebook entirely: hand the UI a URL
    // that points back at our own mock-callback endpoint, which will
    // synthesize a session keyed to MOCK_ACCOUNTS. This is the only way to
    // exercise the dashboard end-to-end while Meta App Review is pending.
    if (isMockAuthEnabled()) {
      console.warn('[adlytic:meta-oauth] MOCK MODE — bypassing Facebook OAuth dialog');
      await pruneOAuthSessions();
      const state = await createOAuthState({ workspaceId, userId, kind: 'legacy' });
      return c.json({
        url: `/api/meta/oauth/mock-callback?state=${state}`,
        configured: true,
        mock: true,
      });
    }

    // ── Direct-token escape hatch ───────────────────────────────────────
    // When META_DIRECT_TOKEN is set, bypass the OAuth dialog entirely:
    // use the token to call Graph API directly, fetch the operator's
    // REAL ad accounts, and skip straight to /meta/connect. This is the
    // production-data equivalent of mock mode — for when the App ID /
    // App Secret handshake is misconfigured but the operator already has
    // a working user token (e.g. from Graph API Explorer or a previous
    // long-lived exchange).
    //
    // SECURITY: in production, env Meta tokens must never bind to an
    // arbitrary tenant. Only platform admins may use this escape hatch.
    const callerUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const callerIsPlatformAdmin = isPlatformAdminEmail(callerUser?.email);
    const directTokenRaw = normalizeEnvAccessToken(config.meta.directToken);
    const directToken =
      directTokenRaw &&
      (config.nodeEnv !== 'production' || callerIsPlatformAdmin)
        ? directTokenRaw
        : null;
    if (directTokenRaw && config.nodeEnv === 'production' && !callerIsPlatformAdmin) {
      console.warn('[adlytic:meta-oauth] META_DIRECT_TOKEN present but ignored for non-admin caller in production');
    }
    if (directToken && deadEnvTokens.has(directToken)) {
      // Known-dead token: skip the Graph round-trip entirely.
      console.warn('[adlytic:meta-oauth] DIRECT TOKEN MODE skipped — META_DIRECT_TOKEN previously failed as permanently invalid. Remove or replace it in the environment.');
      if (!config.meta.systemUserEnabled) {
        return c.json({
          configured: false,
          reason: 'META_DIRECT_TOKEN is permanently invalid (expired or session logged out). Remove or replace it.',
        });
      }
    } else if (directToken) {
      console.warn('[adlytic:meta-oauth] DIRECT TOKEN MODE — bypassing OAuth dialog, calling Graph API with env token');
      try {
        const apiVersion = config.meta.apiVersion;
        const accounts   = await fetchMetaAdAccountsByToken(directToken, apiVersion);
        if (accounts.length === 0) {
          console.error('[META_AUTH_FAILURE] direct-token: token valid but returned 0 ad accounts');
          // In System User mode, keep DIRECT_TOKEN as a best-effort bypass only;
          // if it is unusable, continue to the FB Login for Business config_id path.
          if (!config.meta.systemUserEnabled) {
            return c.json({
              configured: false,
              reason: 'META_DIRECT_TOKEN returned 0 ad accounts — the token has no ads_read access on any ad account.',
            });
          }
          console.warn('[adlytic:meta-oauth] DIRECT TOKEN MODE unavailable; falling through to System User flow');
        } else {
          await pruneOAuthSessions();
          const sessionId = (await import('node:crypto')).randomBytes(32).toString('hex');
          await saveOAuthSession(sessionId, {
            workspaceId,
            userId,
            accessToken: directToken,
            // Direct-token TTL is unknowable — operator owns rotation. Pick a
            // far-future stamp so refresh code paths treat it as healthy.
            expiresAt: new Date(Date.now() + 60 * 86400 * 1000),
            accounts,
            createdAt: Date.now(),
          });
          return c.json({
            url: `/meta/connect?session=${sessionId}`,
            configured: true,
            directToken: true,
          });
        }
      } catch (err: unknown) {
        // Never log token values. Keep only sanitized upstream error text.
        const msg = summarizeMetaAuthError(err);
        console.error('[META_AUTH_FAILURE] direct-token start failed:', msg);
        if (isPermanentTokenError(msg)) {
          deadEnvTokens.add(directToken);
          console.warn('[adlytic:meta-oauth] META_DIRECT_TOKEN marked permanently invalid — it will be skipped until the next deploy. Remove it from the environment.');
        }
        if (!config.meta.systemUserEnabled) {
          return c.json({
            configured: false,
            reason: `META_DIRECT_TOKEN rejected by Meta: ${msg}`,
          });
        }
        console.warn('[adlytic:meta-oauth] DIRECT TOKEN MODE unavailable; falling through to System User flow');
      }
    }

    // ── Phase 2: System User / FB Login for Business (flag-gated) ─────────
    // Active ONLY when META_SYSTEM_USER_ENABLED is true. Two sub-paths:
    //   (a) META_SYSTEM_USER_TOKEN present → bypass the dialog entirely:
    //       validate the token, create the MetaConnection now, and jump
    //       straight to /meta/connect (pre-App-Review testing against your
    //       own Business).
    //   (b) otherwise → build the config_id-based FB Login for Business URL.
    // When the flag is OFF this whole block is skipped and the classic
    // scope-dialog path below runs byte-for-byte as before.
    if (config.meta.systemUserEnabled) {
      const sysTokenRaw = normalizeEnvAccessToken(config.meta.systemUserToken);
      // Same tenant-isolation rule as META_DIRECT_TOKEN: in production only
      // platform admins may attach the shared System User token to a workspace.
      const sysToken =
        sysTokenRaw &&
        (config.nodeEnv !== 'production' || callerIsPlatformAdmin)
          ? sysTokenRaw
          : null;
      if (sysTokenRaw && config.nodeEnv === 'production' && !callerIsPlatformAdmin) {
        console.warn('[adlytic:meta-oauth] META_SYSTEM_USER_TOKEN present but ignored for non-admin caller in production');
      }

      if (sysToken && deadEnvTokens.has(sysToken)) {
        console.warn('[adlytic:meta-oauth] SYSTEM USER TOKEN MODE skipped — META_SYSTEM_USER_TOKEN previously failed as permanently invalid. Remove or replace it in the environment.');
      } else if (sysToken) {
        console.warn('[adlytic:meta-oauth] SYSTEM USER TOKEN MODE — bypassing OAuth dialog, using META_SYSTEM_USER_TOKEN');
        try {
          const apiVersion = config.meta.apiVersion;
          const oauth = buildMetaOAuth();
          // Prefer full validation (debug_token) when app creds are present;
          // otherwise fall back to a raw account listing with the token alone.
          let resolved;
          if (oauth) {
            resolved = await oauth.resolveSystemUserConnection(sysToken);
          } else {
            const accounts = await fetchMetaAdAccountsByToken(sysToken, apiVersion);
            const biz = accounts.find(a => a.business?.id)?.business;
            resolved = {
              systemUserId: undefined,
              businessId:   biz?.id,
              businessName: biz?.name,
              scopes:       [] as string[],
              expiresAt:    null,
              accounts,
            };
          }
          if (resolved.accounts.length === 0) {
            console.error('[META_AUTH_FAILURE] system-user: token valid but returned 0 ad accounts');
            console.warn('[adlytic:meta-oauth] SYSTEM USER TOKEN MODE unavailable; falling back to FB Login for Business config_id flow');
          } else {
            const business = await resolveBusinessId({
              businessId:   resolved.businessId,
              businessName: resolved.businessName,
              systemUserId: resolved.systemUserId,
              token:        sysToken,
              oauth,
            });
            const connectionId = await upsertMetaConnection(prisma, {
              workspaceId,
              businessId:      business.id,
              businessName:    business.name,
              systemUserId:    resolved.systemUserId,
              token:           sysToken,
              scopes:          resolved.scopes,
              grantedAssetIds: resolved.accounts.map(a => a.id),
              configId:        config.meta.systemUserConfigId,
            });
            await pruneOAuthSessions();
            const sessionId = (await import('node:crypto')).randomBytes(32).toString('hex');
            await saveOAuthSession(sessionId, {
              workspaceId,
              userId,
              accessToken: sysToken,
              // System User tokens do not expire; pick a far-future stamp.
              expiresAt:   new Date(Date.now() + 365 * 86400 * 1000),
              accounts:    resolved.accounts,
              createdAt:   Date.now(),
              kind:        'system_user',
              connectionId,
            });
            return c.json({ url: `/meta/connect?session=${sessionId}`, configured: true, systemUser: true });
          }
        } catch (err: unknown) {
          // Never log token values. Keep only sanitized upstream error text.
          const msg = summarizeMetaAuthError(err);
          console.error('[META_AUTH_FAILURE] system-user token start failed:', msg);
          if (isPermanentTokenError(msg)) {
            deadEnvTokens.add(sysToken);
            console.warn('[adlytic:meta-oauth] META_SYSTEM_USER_TOKEN marked permanently invalid — it will be skipped until the next deploy. Remove or replace it in the environment.');
          }
          console.warn('[adlytic:meta-oauth] SYSTEM USER TOKEN MODE unavailable; falling back to FB Login for Business config_id flow');
        }
      }

      // (b) config_id-based FB Login for Business dialog.
      const configId = config.meta.systemUserConfigId ?? '';
      const sysStatus = getMetaOAuthConfigStatus();
      const sysOauth  = buildMetaOAuth();
      if (!sysOauth || !sysStatus.ok || !configId) {
        const reason = !configId
          ? 'FB Login for Business is unavailable because META_LOGIN_CONFIG_ID is not set.'
          : !sysStatus.ok ? `FB Login for Business is unavailable: ${sysStatus.reason}` : 'FB Login for Business is unavailable on this server.';
        return c.json({
          configured: false,
          reason,
          message: 'Meta business login is currently unavailable on this server. You can still connect by pasting an access token manually.',
        });
      }
      await pruneOAuthSessions();
      // `state` is persisted in the DB (oauth_states) with a short TTL so the
      // handshake survives redeploys / multi-instance deploys.
      const state = await createOAuthState({ workspaceId, userId, kind: 'system_user' });
      return c.json({ url: sysOauth.getBusinessLoginUrl(state, configId), configured: true, systemUser: true });
    }

    const status = getMetaOAuthConfigStatus();
    const oauth  = buildMetaOAuth();
    if (!oauth || !status.ok) {
      // Backward compat: keep `configured: false` so the existing UI fallback
      // (manual token modal) continues to trigger. `reason` is additive.
      const reason = !status.ok ? status.reason : 'Meta OAuth is not configured on this server.';
      return c.json({
        configured: false,
        reason,
        message: `${reason}. You can still connect by pasting an access token manually.`,
      });
    }

    await pruneOAuthSessions();
    const state = await createOAuthState({ workspaceId, userId, kind: 'legacy' });

    return c.json({ url: oauth.getAuthorizationUrl(state), configured: true });
  });

  /**
   * GET /api/meta/oauth/mock-callback?state=xxx
   * Mock-auth equivalent of the real /callback endpoint. Validates the
   * state token, synthesizes a session with MOCK_ACCOUNTS and the
   * MOCK_ACCESS_TOKEN sentinel, then redirects to /meta/connect.
   * Refuses to run unless META_MOCK_AUTH is enabled — defence in depth.
   */
  app.get('/api/meta/oauth/mock-callback', async (c) => {
    if (!isMockAuthEnabled()) {
      return c.redirect('/welcome?oauth_error=mock_mode_disabled');
    }
    const state = c.req.query('state');
    if (!state) return c.redirect('/welcome?oauth_error=missing_state');

    await pruneOAuthSessions();
    const stored = await consumeOAuthState(state);
    if (!stored) {
      return c.redirect('/welcome?oauth_error=expired_state');
    }

    const sessionId = (await import('node:crypto')).randomBytes(32).toString('hex');
    await saveOAuthSession(sessionId, {
      workspaceId:  stored.workspaceId,
      userId:       stored.userId,
      accessToken:  MOCK_ACCESS_TOKEN,
      // Mock "tokens" never expire in practice; pick a far-future stamp
      // so token-refresh code paths treat them as healthy.
      expiresAt:    new Date(Date.now() + 365 * 86400 * 1000),
      accounts:     MOCK_ACCOUNTS.slice(),
      createdAt:    Date.now(),
    });

    console.warn('[adlytic:meta-oauth] MOCK MODE — synthesized session', sessionId);
    return c.redirect(`/meta/connect?session=${sessionId}`);
  });

  /**
   * GET /api/meta/oauth/callback?code=xxx&state=yyy
   * Called by Meta after the user grants (or denies) permission.
   * Exchanges the code, fetches ad accounts, stores a session, redirects to /meta/connect.
   */
  app.get('/api/meta/oauth/callback', async (c) => {
    const code  = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      const desc = c.req.query('error_description') ?? error;
      return c.redirect(`/welcome?oauth_error=${encodeURIComponent(desc)}`);
    }
    if (!code || !state) return c.redirect('/welcome?oauth_error=missing_params');

    await pruneOAuthSessions();
    const stored = await consumeOAuthState(state); // one-time use
    if (!stored) {
      return c.redirect('/welcome?oauth_error=expired_state');
    }

    const oauth = buildMetaOAuth();
    if (!oauth) return c.redirect('/welcome?oauth_error=not_configured');

    // ── Phase 2: System User / FB Login for Business callback (flag-gated) ──
    // Active ONLY when META_SYSTEM_USER_ENABLED is true. Creates/updates the
    // MetaConnection from the granted System User token, then hands off to
    // /meta/connect where the chosen AdAccount(s) are linked. Legacy flow
    // below is untouched when the flag is off.
    if (config.meta.systemUserEnabled && stored.kind === 'system_user') {
      try {
        // This callback follows a completed FB Login for Business dialog, so
        // always use the returned auth code's token. Reusing an env token here
        // can falsely fail when that env token is stale or scoped differently.
        const shortToken = await oauth.exchangeCode(code);
        const { token } = await oauth.getLongLivedToken(shortToken);
        const resolved = await oauth.resolveSystemUserConnection(token);
        const business = await resolveBusinessId({
          businessId:   resolved.businessId,
          businessName: resolved.businessName,
          systemUserId: resolved.systemUserId,
          token,
          oauth,
        });
        const grantedAccounts = resolved.accounts;
        if (grantedAccounts.length === 0) {
          console.error('[META_AUTH_FAILURE] system-user callback resolved 0 ad accounts');
          return c.redirect('/welcome?oauth_error=no_ad_accounts_granted');
        }
        const connectionId = await upsertMetaConnection(prisma, {
          workspaceId:     stored.workspaceId,
          businessId:      business.id,
          businessName:    business.name,
          systemUserId:    resolved.systemUserId,
          token,
          scopes:          resolved.scopes,
          grantedAssetIds: grantedAccounts.map(a => a.id),
          configId:        config.meta.systemUserConfigId,
        });
        const sessionId = (await import('node:crypto')).randomBytes(32).toString('hex');
        await saveOAuthSession(sessionId, {
          workspaceId: stored.workspaceId,
          userId:      stored.userId,
          accessToken: token,
          expiresAt:   new Date(Date.now() + 365 * 86400 * 1000),
          accounts:    grantedAccounts,
          createdAt:   Date.now(),
          kind:        'system_user',
          connectionId,
        });
        return c.redirect(`/meta/connect?session=${sessionId}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[META_AUTH_FAILURE] system-user callback exception object:', e);
        console.error('[META_AUTH_FAILURE] system-user callback message:', msg);
        return c.redirect(`/welcome?oauth_error=${encodeURIComponent(msg)}`);
      }
    }

    try {
      // Exchange code → short-lived token → long-lived token
      const shortToken = await oauth.exchangeCode(code);
      const { token: longToken, expiresInSeconds } = await oauth.getLongLivedToken(shortToken);
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

      // Fetch user's ad accounts
      const accounts = await oauth.getAdAccounts(longToken);

      // Store in session
      const sessionId = (await import('node:crypto')).randomBytes(32).toString('hex');
      await saveOAuthSession(sessionId, {
        workspaceId:  stored.workspaceId,
        userId:       stored.userId,
        accessToken:  longToken,
        expiresAt,
        accounts,
        createdAt:    Date.now(),
      });

      return c.redirect(`/meta/connect?session=${sessionId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Aggressive logging: full error object first (stack + cause), then a
      // separate line with just the string so log greps for [META_AUTH_FAILURE]
      // pick it up even when the error has no `.message`.
      console.error('[META_AUTH_FAILURE] callback exception object:', e);
      console.error('[META_AUTH_FAILURE] callback message:', msg);
      console.error('[adlytic:meta-oauth]', msg);
      return c.redirect(`/welcome?oauth_error=${encodeURIComponent(msg)}`);
    }
  });

  /**
   * GET /api/meta/oauth/accounts/:sessionId
   * Returns the ad accounts retrieved during the OAuth flow.
   */
  app.get('/api/meta/oauth/accounts/:sessionId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    await pruneOAuthSessions();
    const session = await getOAuthSession(c.req.param('sessionId'));
    if (!session) return c.json({ error: 'Session not found or expired. Please reconnect.' }, 404);
    if (session.userId !== userId) return c.json({ error: 'Forbidden' }, 403);
    return c.json({ accounts: session.accounts, workspaceId: session.workspaceId });
  });

  /**
   * POST /api/meta/oauth/connect
   * Body: { sessionId, externalAccountId, workspaceId }
   * Creates (or updates) the AdAccount row with the encrypted token.
   * Responds with { success: true, syncJobId? } — client navigates to /dashboard?connected=1.
   */
  app.post('/api/meta/oauth/connect', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const body = req.body as { sessionId?: string; externalAccountId?: string; workspaceId?: string };
    const { sessionId, externalAccountId, workspaceId } = body;
    if (!sessionId || !externalAccountId || !workspaceId) {
      return c.json({ error: 'sessionId, externalAccountId, and workspaceId are required' }, 400);
    }

    const wsm = await checkMember(userId, workspaceId);
    if (!wsm) return c.json({ error: 'Forbidden' }, 403);
    if (wsm.role === 'VIEWER') return c.json({ error: 'Forbidden' }, 403);

    await pruneOAuthSessions();
    const session = await getOAuthSession(sessionId);
    if (!session) return c.json({ error: 'Session not found or expired. Please reconnect.' }, 404);
    if (session.workspaceId !== workspaceId) return c.json({ error: 'Workspace mismatch' }, 403);
    if (session.userId !== userId) return c.json({ error: 'Session does not belong to you' }, 403);

    const account = session.accounts.find(a => a.id === externalAccountId);
    if (!account) return c.json({ error: 'Account not found in session' }, 404);
    const accountName = (typeof account.name === 'string' && account.name.trim().length > 0)
      ? account.name
      : `Meta Ad Account ${account.id}`;
    const accountCurrency = (typeof account.currency === 'string' && account.currency.trim().length > 0)
      ? account.currency.toUpperCase()
      : 'USD';
    const timezone = (typeof account.timezone_name === 'string' && account.timezone_name.trim().length > 0)
      ? account.timezone_name
      : 'UTC';
    const countryCode = tzToCountry(timezone);
    const currencyMinorFactor = currencyMinorFactorFor(accountCurrency);

    // ── Phase 2: System User linking (flag-gated) ────────────────────────
    // When the session was produced by the System User flow, the token lives
    // on the MetaConnection (created at start/callback). Here we link the
    // chosen AdAccount to that connection via connectionId + tokenSource, and
    // clear any stale per-account token so the sync read path uses the
    // connection token. Legacy per-account behavior below is untouched.
    if (session.kind === 'system_user' && session.connectionId) {
      const connection = await prisma.metaConnection.findUnique({ where: { id: session.connectionId } });
      if (!connection || connection.workspaceId !== workspaceId) {
        return c.json({ error: 'Connection not found for this workspace' }, 404);
      }
      const lookup = await findExistingAdAccountForWorkspace(account.id, workspaceId);
      if (lookup.kind === 'conflict') {
        return c.json(AD_ACCOUNT_CONFLICT_JSON, 409);
      }
      if (lookup.kind === 'owned') {
        await prisma.adAccount.update({
          where: { id: lookup.existing.id },
          data: {
            connectionId:         connection.id,
            tokenSource:          'SYSTEM_USER',
            accessTokenEncrypted: null,   // token lives on the connection now
            tokenExpiresAt:       null,   // System User tokens do not expire
            name:                 accountName,
            currency:             accountCurrency,
            currencyMinorFactor,
            timezone,
            countryCode,
            // workspaceId intentionally OMITTED: ownership stays where it is.
            status:               'ACTIVE',
          },
        });
      } else {
        await prisma.adAccount.create({
          data: {
            workspaceId,
            platform:             'META',
            externalAccountId:    account.id,
            name:                 accountName,
            currency:             accountCurrency,
            currencyMinorFactor,
            timezone,
            countryCode,
            status:               'ACTIVE',
            connectionId:         connection.id,
            tokenSource:          'SYSTEM_USER',
            accessTokenEncrypted: null,
            tokenExpiresAt:       null,
          },
        });
      }
      await invalidateCachedTokenHealth(workspaceId);
      await deleteOAuthSession(sessionId);
      void recordMetaAuditEvent(prisma, {
        workspaceId,
        event: 'CONNECTED',
        externalAccountId: account.id,
        actorUserId: userId,
        detail: `System User connection linked (${accountName})`,
      });

      // Kick off the initial backfill using the connection token.
      try {
        const apiVersion = config.meta.apiVersion;
        const ws = await prisma.workspace.findUnique({
          where: { id: workspaceId },
          include: { adAccounts: true },
        });
        const acct = ws?.adAccounts.find(a => a.externalAccountId === account.id);
        if (acct && connection.accessTokenEncrypted) {
          let connToken: string;
          try {
            connToken = decryptToken(connection.accessTokenEncrypted);
          } catch (decErr) {
            if (decErr instanceof TokenDecryptError) {
              console.error('[META_AUTH_FAILURE] system-user connect: connection token decrypt failed:', decErr.message);
              return c.json({ success: true, warning: tokenDecryptErrorJson().error });
            }
            throw decErr;
          }
          const metaClient = new MetaClient({ apiVersion, accessToken: connToken });
          const worker = new SyncAccountWorker(prisma, metaClient);
          const now = new Date();
          const since = new Date(now.getTime() - (INITIAL_BACKFILL_DAYS - 1) * 86400 * 1000);
          const job = await prisma.syncJob.create({
            data: {
              adAccountId: acct.id,
              status:      SyncJobStatus.PENDING,
              windowDays:  INITIAL_BACKFILL_DAYS,
              windowSince: since,
              windowUntil: now,
              triggeredBy: 'oauth-callback-system-user',
            },
          });
          enqueueOrFallback(
            () =>
              getQueues()!.syncAccount.add('oauth-callback-system-user', {
                syncJobId: job.id,
                adAccountId: acct.id,
                runEnginesOnCompleted: true,
                triggeredBy: 'oauth-callback-system-user',
              }),
            () => {
              setImmediate(() => {
                void (async () => {
                  try {
                    await worker.syncChunked(job.id);
                    const final = await prisma.syncJob.findUnique({ where: { id: job.id } });
                    if (final?.status === SyncJobStatus.COMPLETED) {
                      await runEngines(prisma, acct.id);
                      await runBrainOrchestrator(prisma, metaClient, acct.id);
                    }
                  } catch (err: unknown) { console.error('[adlytic:initial-sync:system-user]', err); }
                })();
              });
            },
          );
          enqueueOrFallback(
            () => getQueues()!.maintenance.add('lifetime-totals', { adAccountId: acct.id }),
            () => {
              setImmediate(() => {
                void worker.syncLifetimeTotals(acct.id).catch((err: unknown) => {
                  console.error('[adlytic:lifetime-sync]', err);
                });
              });
            },
          );
          return c.json({ success: true, systemUser: true, syncJobId: job.id });
        }
      } catch (kickoffErr: unknown) {
        console.error('[META_AUTH_FAILURE] system-user post-connect sync kickoff failed:', kickoffErr);
      }

      return c.json({ success: true, systemUser: true });
    }

    const encryptedToken = encryptToken(session.accessToken);
    const apiVersion     = config.meta.apiVersion;

    // Upsert the ad account — but assert workspace ownership first so a Meta
    // ad account linked to a DIFFERENT workspace is not silently hijacked
    // (Phase 6a finding R-1).
    const lookup = await findExistingAdAccountForWorkspace(account.id, workspaceId);
    if (lookup.kind === 'conflict') {
      return c.json(AD_ACCOUNT_CONFLICT_JSON, 409);
    }

    if (lookup.kind === 'owned') {
      await prisma.adAccount.update({
        where: { id: lookup.existing.id },
        data: {
          accessTokenEncrypted: encryptedToken,
          tokenExpiresAt:       session.expiresAt,
          name:                 accountName,
          currency:             accountCurrency,
          currencyMinorFactor,
          timezone,
          countryCode,
          // workspaceId intentionally OMITTED: ownership stays where it is.
          status:               'ACTIVE',
        },
      });
    } else {
      await prisma.adAccount.create({
        data: {
          workspaceId,
          platform:             'META',
          externalAccountId:    account.id,
          name:                 accountName,
          currency:             accountCurrency,
          currencyMinorFactor,
          timezone,
          countryCode,
          status:               'ACTIVE',
          accessTokenEncrypted: encryptedToken,
          tokenExpiresAt:       session.expiresAt,
        },
      });
    }
    await invalidateCachedTokenHealth(workspaceId);
    void recordMetaAuditEvent(prisma, {
      workspaceId,
      event: 'CONNECTED',
      externalAccountId: account.id,
      actorUserId: userId,
      detail: `Ad account connected (${accountName})`,
    });

    // Invalidate session — one-time use
    await deleteOAuthSession(sessionId);

    // ── Mock-auth seeding ────────────────────────────────────────────────
    // If this connect was driven by the mock OAuth flow, the stored token is
    // the MOCK_ACCESS_TOKEN sentinel. Skip the real Meta sync chain (which
    // would inevitably fail with auth errors) and instead seed a realistic
    // dataset so the dashboard renders end-to-end.
    if (isMockAuthEnabled() && session.accessToken === MOCK_ACCESS_TOKEN) {
      try {
        const ws = await prisma.workspace.findUnique({
          where: { id: workspaceId },
          include: { adAccounts: true },
        });
        const acct = ws?.adAccounts.find(a => a.externalAccountId === account.id);
        if (acct) {
          enqueueOrFallback(
            () => getQueues()!.maintenance.add('mock-seed', { adAccountId: acct.id }),
            () => {
              setImmediate(() => {
                void seedMockAdAccountData(prisma, acct.id).catch((err: unknown) => {
                  console.error('[adlytic:mock-seed]', err);
                });
              });
            },
          );
        }
      } catch (e) {
        console.error('[adlytic:mock-seed-setup]', e);
      }
      return c.json({ success: true, mock: true });
    }

    // Kick off initial INITIAL_BACKFILL_DAYS-day chunked sync in the background.
    // We persist a SyncJob so the frontend can poll progress on first connect.
    try {
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { adAccounts: true },
      });
      const acct = ws?.adAccounts.find(a => a.externalAccountId === account.id);
      if (acct?.accessTokenEncrypted) {
        const metaClient = new MetaClient({ apiVersion, accessToken: decryptToken(acct.accessTokenEncrypted) });
        const worker = new SyncAccountWorker(prisma, metaClient);
        const now = new Date();
        const since = new Date(now.getTime() - (INITIAL_BACKFILL_DAYS - 1) * 86400 * 1000);
        const job = await prisma.syncJob.create({
          data: {
            adAccountId: acct.id,
            status: SyncJobStatus.PENDING,
            windowDays: INITIAL_BACKFILL_DAYS,
            windowSince: since,
            windowUntil: now,
            triggeredBy: 'oauth-callback',
          },
        });
        enqueueOrFallback(
          () =>
            getQueues()!.syncAccount.add('oauth-callback', {
              syncJobId: job.id,
              adAccountId: acct.id,
              runEnginesOnCompleted: true,
              triggeredBy: 'oauth-callback',
            }),
          () => {
            setImmediate(() => {
              void (async () => {
                try {
                  await worker.syncChunked(job.id);
                  const final = await prisma.syncJob.findUnique({ where: { id: job.id } });
                  if (final?.status === SyncJobStatus.COMPLETED) {
                    await runEngines(prisma, acct.id);
                    await runBrainOrchestrator(prisma, metaClient, acct.id);  // 🧠 V6 Brain V2 tick
                  }
                } catch (err: unknown) { console.error('[adlytic:initial-sync]', err); }
              })();
            });
          },
        );
        // Fire-and-forget: surface true lifetime spend immediately (one Meta
        // request, no DailyStat rows). Independent of the chunked window above.
        enqueueOrFallback(
          () => getQueues()!.maintenance.add('lifetime-totals', { adAccountId: acct.id }),
          () => {
            setImmediate(() => {
              void worker.syncLifetimeTotals(acct.id).catch((err: unknown) => {
                console.error('[adlytic:lifetime-sync]', err);
              });
            });
          },
        );
        return c.json({ success: true, syncJobId: job.id });
      }
    } catch (kickoffErr: unknown) {
      // Non-fatal: the AdAccount is already persisted; sync can be retried
      // from the UI. Log loudly so Railway captures the exact failure.
      console.error('[META_AUTH_FAILURE] post-connect sync kickoff failed:', kickoffErr);
    }

    return c.json({ success: true });
  });

  /**
   * POST /api/workspaces/:workspaceId/ad-accounts
   * Manual token entry fallback — for users who have a token from Meta's Graph API Explorer.
   * Body: { externalAccountId, name, currency, timezone, accessToken }
   */
  app.post('/api/workspaces/:workspaceId/ad-accounts', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const workspaceId = req.params['workspaceId'];
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const wsm = await checkMember(userId, workspaceId);
    if (!wsm) return c.json({ error: 'Access denied' }, 403);
    if (wsm.role === 'VIEWER') return c.json({ error: 'Insufficient permissions' }, 403);
    const body = req.body as {
      externalAccountId?: string; name?: string;
      currency?: string; timezone?: string; accessToken?: string;
    };
    if (!body.externalAccountId || !body.accessToken) {
      return c.json({ error: 'externalAccountId and accessToken are required' }, 400);
    }
    const extId = body.externalAccountId.startsWith('act_')
      ? body.externalAccountId
      : `act_${body.externalAccountId}`;
    if (!/^act_\d+$/.test(extId)) {
      return c.json({
        error: 'Invalid Meta ad account ID — expected numeric form like act_1234567890',
      }, 422);
    }

    // Validate the token against Meta API before saving — fail fast with a clear error.
    // Also pull timezone_name here so we can derive countryCode without user input.
    // Token travels in the Authorization header — never the URL (logs/proxies).
    const apiVersion = config.meta.apiVersion;
    let metaTimezone: string | null = null;
    let metaCurrency: string | null = null;
    // Manual tokens have no debug_token expiry when app creds are absent —
    // default 60 days so refresh/PAUSE paths treat them as dated USER_OAUTH.
    let tokenExpiresAt: Date = new Date(Date.now() + 60 * 86400 * 1000);
    try {
      const testUrl = `https://graph.facebook.com/${encodeURIComponent(apiVersion)}/${encodeURIComponent(extId)}?fields=id,name,currency,timezone_name,account_status`;
      const testRes = await fetch(testUrl, {
        headers: { Authorization: `Bearer ${body.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      const testData = await testRes.json() as Record<string, unknown>;
      if (testData['error']) {
        const err = testData['error'] as Record<string, unknown>;
        return c.json({ error: `Meta API rejected credentials: ${String(err['message'] ?? err['type'] ?? 'invalid token or account ID')}` }, 422);
      }
      if (!testData['id']) {
        return c.json({ error: 'Meta API returned no account data — check your account ID and token' }, 422);
      }
      // Always trust Meta for name/currency/timezone — account billing currency cannot be overridden.
      if (testData['name']) body.name = String(testData['name']);
      if (testData['currency']) metaCurrency = String(testData['currency']).toUpperCase();
      if (testData['timezone_name']) metaTimezone = String(testData['timezone_name']);
    } catch (fetchErr) {
      // Network error — don't block connection, just log
      console.warn('[adlytic:manual-connect] Could not verify token with Meta:', fetchErr);
    }

    const resolvedTimezone = metaTimezone ?? body.timezone ?? 'UTC';
    const countryCode      = tzToCountry(resolvedTimezone);
    const encryptedToken   = encryptToken(body.accessToken);
    const resolvedCurrency = (metaCurrency ?? body.currency ?? 'USD').trim().toUpperCase();
    const currencyMinorFactor = currencyMinorFactorFor(resolvedCurrency);
    const lookup = await findExistingAdAccountForWorkspace(extId, workspaceId);
    if (lookup.kind === 'conflict') {
      return c.json(AD_ACCOUNT_CONFLICT_JSON, 409);
    }
    if (lookup.kind === 'owned') {
      const { existing } = lookup;
      await prisma.adAccount.update({
        where: { id: existing.id },
        data: {
          accessTokenEncrypted: encryptedToken,
          tokenExpiresAt,
          tokenSource:          'MANUAL',
          // workspaceId intentionally OMITTED: ownership stays where it is.
          name:                 body.name ?? existing.name,
          currency:             resolvedCurrency,
          currencyMinorFactor,
          timezone:             resolvedTimezone,
          countryCode,
          status:               'ACTIVE',
        },
      });
      await invalidateCachedTokenHealth(workspaceId);
      enqueueOrFallback(
        () =>
          getQueues()!.maintenance.add('initial-sync-kickoff', {
            adAccountId: existing.id,
            triggeredBy: 'manual-connect',
          }),
        () => {
          setImmediate(() => {
            void kickoffInitialSync(existing.id, 'manual-connect').catch((err: unknown) => {
              console.error('[adlytic:manual-connect] initial sync kickoff failed:', err);
            });
          });
        },
      );
      return c.json({ success: true, id: existing.id });
    }
    const acct = await prisma.adAccount.create({
      data: {
        workspaceId,
        platform:             'META',
        externalAccountId:    extId,
        name:                 body.name ?? extId,
        currency:             resolvedCurrency,
        currencyMinorFactor,
        timezone:             resolvedTimezone,
        countryCode,
        status:               'ACTIVE',
        accessTokenEncrypted: encryptedToken,
        tokenExpiresAt,
        tokenSource:          'MANUAL',
      },
    });
    await invalidateCachedTokenHealth(workspaceId);
    enqueueOrFallback(
      () =>
        getQueues()!.maintenance.add('initial-sync-kickoff', {
          adAccountId: acct.id,
          triggeredBy: 'manual-connect',
        }),
      () => {
        setImmediate(() => {
          void kickoffInitialSync(acct.id, 'manual-connect').catch((err: unknown) => {
            console.error('[adlytic:manual-connect] initial sync kickoff failed:', err);
          });
        });
      },
    );
    return c.json({ success: true, id: acct.id });
  });

  /**
   * DELETE /api/workspaces/:workspaceId/ad-accounts/:accountId
   * Removes the ad account connection (data preserved for auditing).
   */
  app.delete('/api/workspaces/:workspaceId/ad-accounts/:accountId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const { workspaceId, accountId } = req.params as Record<string, string>;
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const wsm = await checkMember(userId, workspaceId);
    if (!wsm) return c.json({ error: 'Access denied' }, 403);
    if (wsm.role === 'VIEWER') return c.json({ error: 'Insufficient permissions' }, 403);
    const acct = await prisma.adAccount.findFirst({ where: { id: accountId, workspaceId } });
    if (!acct) return c.json({ error: 'Account not found' }, 404);

    // Canonical erasure — every entityId-keyed analytics table (incl.
    // breakdown_stats), account- and campaign-level, in one place. Satisfies
    // right-to-erasure and Meta Platform Terms deletion-on-disconnect.
    await purgeAccountAnalytics(prisma, accountId);

    await prisma.adAccount.delete({ where: { id: accountId } });
    void recordMetaAuditEvent(prisma, {
      workspaceId,
      event: 'DISCONNECTED',
      adAccountId: accountId,
      externalAccountId: acct.externalAccountId,
      actorUserId: userId,
      detail: `Ad account disconnected (${acct.name})`,
    });
    return c.json({ success: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  IQD REPAIR — heal factor + rescale spend + re-sync
  // ════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/workspaces/:workspaceId/repair-iqd
   * Heal currencyMinorFactor, rescale daily_stats from raw Meta spend, then
   * enqueue a 90-day backfill. Owner/Manager only; IQD account required.
   */
  app.post('/api/workspaces/:workspaceId/repair-iqd', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const workspaceId = req.params['workspaceId'];
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const wsm = await checkMember(userId, workspaceId);
    if (!wsm) return c.json({ error: 'Access denied' }, 403);
    if (wsm.role === 'VIEWER') return c.json({ error: 'Insufficient permissions' }, 403);

    const { account } = await getAccount(workspaceId);
    if (!account) return c.json({ error: 'No ad account found for this workspace' }, 404);
    if (account.currency !== 'IQD') {
      return c.json({ error: 'Repair endpoint applies to IQD accounts only' }, 422);
    }

    const factorsHealed = await healIqdAccountFactors(prisma);
    const rescale = await rescaleIqdSpendFromRaw(prisma);

    const resolvedToken = await resolveAccountToken(prisma, account);
    if (!resolvedToken.encrypted) {
      return c.json({
        success: true,
        factorsHealed,
        rescale,
        syncJobId: null,
        warning: 'Factor and spend repaired, but no access token — reconnect Meta to re-sync.',
      });
    }

    const windowDays = 90;
    const now = new Date();
    const since = new Date(now.getTime() - (windowDays - 1) * 86400 * 1000);
    const job = await prisma.syncJob.create({
      data: {
        adAccountId: account.id,
        status: SyncJobStatus.PENDING,
        windowDays,
        windowSince: since,
        windowUntil: now,
        triggeredBy: `repair-iqd:${userId}`,
      },
    });

    let accessToken: string;
    try {
      accessToken = decryptToken(resolvedToken.encrypted);
    } catch (decErr) {
      if (decErr instanceof TokenDecryptError) {
        return c.json(tokenDecryptErrorJson(), 500);
      }
      throw decErr;
    }

    const metaClient = new MetaClient({ apiVersion: config.meta.apiVersion, accessToken, timezone: account.timezone });
    const worker = new SyncAccountWorker(prisma, metaClient);
    enqueueOrFallback(
      () =>
        getQueues()!.syncAccount.add('repair-iqd', {
          syncJobId: job.id,
          adAccountId: account.id,
          runEnginesOnCompleted: true,
          triggeredBy: `repair-iqd:${userId}`,
        }),
      () => {
        setImmediate(() => {
          void (async () => {
            try {
              await worker.syncChunked(job.id);
              const final = await prisma.syncJob.findUnique({ where: { id: job.id } });
              if (final?.status === SyncJobStatus.COMPLETED) {
                await runEngines(prisma, account.id);
                await runBrainOrchestrator(prisma, metaClient, account.id);
              }
            } catch (err: unknown) {
              console.error('[adlytic:repair-iqd] sync failed:', err);
            }
          })();
        });
      },
    );

    return c.json({
      success: true,
      factorsHealed,
      rescale,
      syncJobId: job.id,
    }, 202);
  });

  // ════════════════════════════════════════════════════════════════════════
  //  SYNC TRIGGER — fires SyncAccountWorker in the background
  // ════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/workspaces/:workspaceId/sync — enqueue a background ETL sync.
   *
   * Body: { windowDays?: number }  (default 3, min 1, max 90)
   *
   * Creates a SyncJob row (status=PENDING), fires the chunked worker via
   * setImmediate, and returns 202 with the jobId. Clients poll
   * GET /api/sync-jobs/:jobId for progress; engines + Brain run once at
   * the end of a successful job, not per chunk.
   */
  app.post('/api/workspaces/:workspaceId/sync', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);
    const wsm = await checkMember(userId, req.params['workspaceId']);
    if (!wsm) return c.json({ error: 'Access denied' }, 403);
    if (wsm.role === 'VIEWER') return c.json({ error: 'Insufficient permissions — only Owners and Managers can trigger sync' }, 403);
    if (!checkRateLimit(_syncRateMap, req.params['workspaceId'], 3, 15 * 60_000)) {
      return c.json({ error: 'Sync rate limited — please wait before triggering another sync.' }, 429);
    }
    const { account } = await getAccount(req.params['workspaceId']);
    if (!account) return c.json({ error: 'No ad account found for this workspace' }, 404);

    // Phase 2 — resolve the authoritative token. SYSTEM_USER accounts read the
    // (non-expiring) token from their MetaConnection; everyone else uses the
    // per-account token. getAccount does not include the connection, so the
    // helper loads it when needed.
    const resolvedToken = await resolveAccountToken(prisma, account);
    if (!resolvedToken.encrypted) {
      return c.json({ error: 'No access token configured — connect a Meta account first' }, 422);
    }
    // System User tokens do not expire and the expiry lives on the connection
    // (kept null), so the per-account expiry gate applies to legacy tokens only.
    if (!resolvedToken.isSystemUser && account.tokenExpiresAt && account.tokenExpiresAt < new Date()) {
      return c.json({ error: 'Meta access token has expired — please reconnect your account' }, 422);
    }

    // ── Validate windowDays (1..MAX_BACKFILL_DAYS, default DEFAULT_INCREMENTAL_BACKFILL_DAYS)
    const body = (req.body ?? {}) as { windowDays?: number };
    const rawDays = body.windowDays;
    const windowDays = typeof rawDays === 'number' && Number.isFinite(rawDays)
      ? Math.trunc(rawDays)
      : DEFAULT_INCREMENTAL_BACKFILL_DAYS;
    if (windowDays < 1 || windowDays > MAX_BACKFILL_DAYS) {
      return c.json({ error: `windowDays must be between 1 and ${MAX_BACKFILL_DAYS}` }, 422);
    }

    const now = new Date();
    const since = new Date(now.getTime() - (windowDays - 1) * 86400 * 1000);

    // ── Fix A — Reuse an already-active job for the same account.
    // Without this, a second click (or a quick re-poll race) creates a SECOND
    // SyncJob that immediately fails on the Postgres advisory lock held by the
    // first, surfacing a misleading "Another sync is already in progress" error
    // in the UI even though the user's original sync is healthy. Returning the
    // existing jobId lets the frontend poll the REAL ongoing job seamlessly.
    //
    // Staleness guard: scale with windowDays so 180-day initial backfills
    // are not false-failed after 15 minutes. Anchor on startedAt when present.
    const existingActive = await prisma.syncJob.findFirst({
      where: {
        adAccountId: account.id,
        status: { in: [SyncJobStatus.PENDING, SyncJobStatus.PROCESSING] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, status: true, windowDays: true, windowSince: true,
        windowUntil: true, createdAt: true, startedAt: true,
      },
    });
    if (existingActive) {
      const anchor = existingActive.startedAt ?? existingActive.createdAt;
      const ageMs = Date.now() - anchor.getTime();
      const staleMs = staleSyncJobThresholdMs(existingActive.windowDays);
      if (ageMs > staleMs) {
        await prisma.syncJob.update({
          where: { id: existingActive.id },
          data: {
            status: SyncJobStatus.FAILED,
            error: `Timed out — job was stuck for over ${Math.round(staleMs / 60000)} minutes`,
            completedAt: new Date(),
          },
        });
        console.warn(`[adlytic:sync] Marked stale job ${existingActive.id} as FAILED (age ${Math.round(ageMs / 60000)}m, threshold ${Math.round(staleMs / 60000)}m)`);
      } else {
        return c.json({
          jobId: existingActive.id,
          status: existingActive.status,
          windowDays: existingActive.windowDays,
          adAccountId: account.id,
          reused: true,
        }, 200);
      }
    }

    const job = await prisma.syncJob.create({
      data: {
        adAccountId: account.id,
        status: SyncJobStatus.PENDING,
        windowDays,
        windowSince: since,
        windowUntil: now,
        triggeredBy: userId,
      },
    });

    const apiVersion = config.meta.apiVersion;
    // Decrypt up front so a TOKEN_ENCRYPTION_KEY mismatch is surfaced to the
    // caller instead of being mistaken for an expired/invalid Meta token (190).
    let accessToken: string;
    try {
      accessToken = decryptToken(resolvedToken.encrypted);
    } catch (decErr) {
      if (decErr instanceof TokenDecryptError) {
        console.error(`[adlytic:sync] ${account.externalAccountId} — token decrypt failed (key mismatch, not a 190): ${decErr.message}`);
        return c.json(tokenDecryptErrorJson(), 500);
      }
      throw decErr;
    }
    const metaClient = new MetaClient({ apiVersion, accessToken, timezone: account.timezone });
    const worker = new SyncAccountWorker(prisma, metaClient);

    // On a Meta 190 (expired/invalid token): SYSTEM_USER accounts flag the
    // MetaConnection NEEDS_REGRANT; everyone else is PAUSED. Shared with
    // auto-sync via handleMeta190.
    const handle190 = (): Promise<void> => handleMeta190(prisma, {
      accountId: account.id,
      externalAccountId: account.externalAccountId,
      isSystemUser: resolvedToken.isSystemUser,
      connectionId: resolvedToken.connectionId,
      workspaceId: account.workspaceId,
    });

    // Fire-and-forget: yields control back to the event loop so we can return
    // 202 immediately. The worker updates SyncJob status as it progresses;
    // engines + Brain run only on COMPLETED. When BULLMQ_ENABLED is on the
    // job is durably queued in Redis (so an instance crash doesn't lose it);
    // otherwise the original setImmediate body runs in-process exactly as
    // before. The 190 handler runs on either path.
    enqueueOrFallback(
      () =>
        getQueues()!.syncAccount.add('manual-sync', {
          syncJobId: job.id,
          adAccountId: account.id,
          runEnginesOnCompleted: true,
          triggeredBy: userId,
          handle190OnFailure: true,
          isSystemUser: resolvedToken.isSystemUser,
          connectionId: resolvedToken.connectionId,
          externalAccountId: account.externalAccountId,
        }),
      () => {
        setImmediate(() => {
          void (async () => {
            try {
              await worker.syncChunked(job.id);
              const final = await prisma.syncJob.findUnique({ where: { id: job.id } });
              if (final?.status === SyncJobStatus.COMPLETED) {
                await runEngines(prisma, account.id);
                await runBrainOrchestrator(prisma, metaClient, account.id);
              } else if (final?.error && /code.*190|190.*code|OAuthException/.test(final.error)) {
                await handle190();
              }
            } catch (err: unknown) {
              console.error('[adlytic:syncChunked]', err);
              if (err instanceof MetaApiError) {
                const body = err.body as Record<string, any>;
                if (body?.error?.code === 190) await handle190();
              }
            }
          })();
        });
      },
    );

    return c.json({
      jobId: job.id,
      status: job.status,
      windowDays,
      adAccountId: account.id,
    }, 202);
  });

  /**
   * GET /api/sync-jobs/:jobId — poll a SyncJob for progress.
   * Auth: the caller must be a member of the workspace that owns the
   * underlying AdAccount.
   */
  app.get('/api/sync-jobs/:jobId', async (c) => {
    const req = await honoToApiRequest(c);
    if (!req.bearerToken) return c.json({ error: 'Unauthorized' }, 401);
    const userId = await getUserId(req.bearerToken);
    if (!userId) return c.json({ error: 'Invalid token' }, 401);

    const jobId = req.params['jobId'];
    const job = await prisma.syncJob.findUnique({
      where: { id: jobId },
      include: { adAccount: { select: { workspaceId: true, externalAccountId: true } } },
    });
    if (!job) return c.json({ error: 'Sync job not found' }, 404);

    const wsm = await checkMember(userId, job.adAccount.workspaceId);
    if (!wsm) return c.json({ error: 'Access denied' }, 403);

    return c.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      chunksDone: job.chunksDone,
      chunksTotal: job.chunksTotal,
      windowDays: job.windowDays,
      windowSince: job.windowSince,
      windowUntil: job.windowUntil,
      cursorDate: job.cursorDate,
      rowsFetched: job.rowsFetched,
      rowsUpserted: job.rowsUpserted,
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      adAccountId: job.adAccountId,
      externalAccountId: job.adAccount.externalAccountId,
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  FALLBACKS
  // ════════════════════════════════════════════════════════════════════════

  app.notFound((c) =>
    c.json({ error: 'Not found', path: c.req.path }, 404)
  );

  app.onError((err, c) => {
    console.error('[adlytic:error]', err);
    // Prisma P2025 = record not found (findUniqueOrThrow / updateOrThrow)
    // Return 404 instead of 500 to avoid leaking internal error details.
    if ((err as any)?.code === 'P2025') {
      return c.json({ error: 'Not found' }, 404);
    }
    if ((err as any)?.code === 'SERIALIZATION_ERROR') {
      return c.json({ error: 'Unable to prepare response', code: 'SERIALIZATION_ERROR' }, 500);
    }
    // Never leak stack traces or raw error messages to paying customers.
    return c.json(
      { error: 'Something went wrong. Please try again.' },
      500
    );
  });

  return app;
}
