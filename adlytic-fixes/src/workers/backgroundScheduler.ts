// ════════════════════════════════════════════════════════════════════════
//  src/workers/backgroundScheduler.ts
//
//  All the recurring background work that used to live inside serve.ts's
//  main(): the auto-sync loop, daily maintenance, and BullMQ worker boot.
//
//  Extracted so it can run in EITHER of two processes:
//    • the combined API process (SERVICE_ROLE=combined, the default — behaves
//      exactly like the pre-split single service), or
//    • a dedicated worker process (src/workers/serve.worker.ts), so the API
//      never runs Meta ETL on its event loop.
//
//  Nothing here serves HTTP. startBackgroundWork() is the single entry point;
//  the API calls it only in 'combined' role, the worker always calls it.
// ════════════════════════════════════════════════════════════════════════

import type { PrismaClient } from '@prisma/client';
import { SyncAccountWorker } from './syncAccount';
import { MetaClient, MetaApiError } from '../services/metaClient';
import { decryptToken, TokenDecryptError } from '../services/tokenEncryption';
import { resolveAccountToken, handleMeta190 } from '../services/accountToken';
import { runRefresh } from '../services/refresh/refreshEngine';
import { config } from '../config';
import { withAdvisoryLock } from '../lib/advisoryLock';
import {
  cleanupOrphanedCampaignStats,
  runDataIntegrityCheck,
} from '../services/dataIntegrityMonitor';
import { refreshExpiringMetaTokens } from './refreshMetaTokens';
import { refreshCampaignHistoryRollups } from './rollupHistory';
import { bootQueueWorkers } from './queue';
import { advance, listDue } from '../orchestrator/engine';
import { metaAdapter } from '../orchestrator/adapters/metaAdapter';

const SYNC_INTERVAL_MS = config.sync.intervalMs;
/** Connection-onboarding poll cadence. The per-record adaptive backoff in
 *  orchestrator/polling.ts decides which rows are actually due; this is
 *  only how often we ask. A module constant on purpose — one more env var
 *  for a value nobody tunes is a worse trade than a constant. */
const ONBOARDING_POLL_INTERVAL_MS = 60_000;
/** Records advanced per pass. Bounded so one busy pass can't monopolize. */
const ONBOARDING_BATCH = 20;
const RAW_INSIGHTS_RETAIN_DAYS = config.sync.rawInsightsRetainDays;
const API_VERSION = config.meta.apiVersion;

/**
 * Clean up zombie SyncJobs left by a prior crash/deploy. Any job that was
 * PENDING or PROCESSING when the process died will never complete — mark it
 * FAILED so new sync requests aren't blocked by the "reuse active job" logic.
 * Idempotent (time-filtered updateMany) so it's safe to run from any process.
 */
/**
 * Stale-job threshold. Initial 180-day backfills routinely exceed 15 minutes;
 * key off startedAt (or createdAt when not yet started) and scale with window.
 */
export function staleSyncJobThresholdMs(windowDays: number): number {
  if (windowDays >= 90) return 6 * 60 * 60 * 1000; // 6h for full backfill
  if (windowDays >= 30) return 2 * 60 * 60 * 1000; // 2h
  return 45 * 60 * 1000; // 45m for incremental
}

export async function cleanupOrphanedSyncJobs(prisma: PrismaClient): Promise<void> {
  try {
    // Only fail jobs that have made no progress for a long time. Absolute
    // createdAt age was false-failing healthy 180-day initial syncs.
    const cutoff = new Date(Date.now() - 45 * 60 * 1000);
    const candidates = await prisma.syncJob.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        OR: [
          { startedAt: { lt: cutoff } },
          { startedAt: null, createdAt: { lt: cutoff } },
        ],
      },
      select: { id: true, windowDays: true, startedAt: true, createdAt: true, chunksDone: true, progress: true },
    });
    let count = 0;
    for (const job of candidates) {
      const anchor = job.startedAt ?? job.createdAt;
      const ageMs = Date.now() - anchor.getTime();
      const threshold = staleSyncJobThresholdMs(job.windowDays);
      // Jobs that are still advancing (progress/chunks) get the full window;
      // never-started PENDING jobs older than threshold are true orphans.
      if (ageMs < threshold) continue;
      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error: `Timed out — no completion after ${Math.round(ageMs / 60000)}m`,
          completedAt: new Date(),
        },
      });
      count++;
    }
    if (count > 0) console.log(`[adlytic:startup] Cleaned up ${count} orphaned sync job(s)`);
  } catch (err) {
    console.warn('[adlytic:startup] Failed to clean up orphaned sync jobs:', err);
  }
}

// ── Background auto-sync ─────────────────────────────────────────────
async function syncAllAccounts(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  let accounts;
  try {
    accounts = await prisma.adAccount.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          // Legacy / user-OAuth / manual / direct-token accounts: token lives
          // on the account and may expire. Excludes SYSTEM_USER so behavior
          // here is byte-for-byte identical to before when the flag is off.
          {
            tokenSource: { not: 'SYSTEM_USER' },
            accessTokenEncrypted: { not: null },
            OR: [
              { tokenExpiresAt: null },
              { tokenExpiresAt: { gt: now } },
            ],
          },
          // Phase 2 — System User accounts: token lives on the MetaConnection
          // and never expires. Only sync while the connection is ACTIVE so a
          // NEEDS_REGRANT/REVOKED connection is skipped (no retry storm).
          {
            tokenSource: 'SYSTEM_USER',
            connectionId: { not: null },
            connection: { is: { status: 'ACTIVE', accessTokenEncrypted: { not: null } } },
          },
        ],
      },
      select: {
        id: true,
        workspaceId: true,
        externalAccountId: true,
        accessTokenEncrypted: true,
        tokenSource: true,
        connectionId: true,
        timezone: true,
        connection: { select: { id: true, status: true, accessTokenEncrypted: true } },
      },
    });
  } catch (err) {
    console.error('[adlytic:auto-sync] Failed to list accounts:', err);
    return;
  }

  if (accounts.length === 0) return;
  console.log(`[adlytic:auto-sync] Syncing ${accounts.length} account(s)…`);

  for (const acct of accounts) {
    // Phase 2 — resolve the authoritative token via the shared helper.
    const { encrypted, isSystemUser, connectionId } = await resolveAccountToken(prisma, acct);
    if (!encrypted) continue;

    // Decrypt up front so a TOKEN_ENCRYPTION_KEY mismatch is never mistaken
    // for an expired/invalid Meta token (190). On decrypt failure, skip this
    // account this cycle without touching its status/token.
    let accessToken: string;
    try {
      accessToken = decryptToken(encrypted);
    } catch (decErr) {
      if (decErr instanceof TokenDecryptError) {
        console.error(`[adlytic:auto-sync] Skipping ${acct.externalAccountId} — token decrypt failed (key mismatch, not a 190): ${decErr.message}`);
        continue;
      }
      throw decErr;
    }

    // On a Meta 190 (expired/invalid token): legacy accounts are PAUSED and
    // their token nulled (owner must reconnect). SYSTEM_USER accounts instead
    // flag the MetaConnection NEEDS_REGRANT. Shared with the manual "Sync now"
    // route via handleMeta190.
    const handle190 = (): Promise<void> => handleMeta190(prisma, {
      accountId: acct.id,
      externalAccountId: acct.externalAccountId,
      isSystemUser,
      connectionId,
      workspaceId: acct.workspaceId,
    });

    try {
      const metaClient = new MetaClient({ apiVersion: API_VERSION, accessToken, timezone: acct.timezone });
      const worker = new SyncAccountWorker(prisma, metaClient);
      const tag = `[adlytic:auto-sync:${acct.externalAccountId}]`;
      const syncStart = Date.now();

      // Phase 0: Intra-day velocity (single fast call — "today so far")
      try {
        await worker.syncToday(acct.id);
      } catch (todayErr) {
        console.error(`${tag} syncToday failed (non-fatal):`, todayErr instanceof Error ? todayErr.message : todayErr);
      }

      // Phase 1: Account-level daily stats (28-day backfill for attribution lag)
      const syncResult = await worker.sync(acct.id, { backfillDays: 28 });
      if (!syncResult.ok) {
        console.warn(`${tag} account sync ✗: ${syncResult.error}`);
        if (syncResult.error && /code.*190|190.*code|OAuthException/.test(syncResult.error)) {
          await handle190();
        }
        continue;
      }
      // Smart Refresh Engine inputs: total rows written this sync + campaign
      // transitions detected against the prior DB state. When BOTH are zero
      // the refresh engine skips every recalculation and logs why.
      let changedRows = syncResult.rowsUpserted;
      let campaignChanges: import('../services/refresh/refreshEngine').CampaignChange[] = [];

      // Phase 2: Campaign-level daily stats + status reconciliation
      const since = new Date(Date.now() - 28 * 864e5);
      const until = new Date();
      try {
        const campResult = await worker.syncCampaigns(acct.id, { since, until });
        changedRows += campResult.dailyRowsUpserted;
        campaignChanges = campResult.campaignChanges;
        console.log(`${tag} campaigns: ${campResult.dailyRowsUpserted} daily rows, ${campaignChanges.length} transition(s)`);
      } catch (campErr) {
        console.error(`${tag} syncCampaigns failed (non-fatal):`, campErr instanceof Error ? campErr.message : campErr);
      }

      // Phase 3: Ad-set + Ad + Creative discovery
      try {
        const adsResult = await worker.syncAdSetsAndAds(acct.id, { since });
        console.log(`${tag} ads: ${adsResult.adsUpserted} ads, ${adsResult.creativesUpserted} creatives`);
      } catch (adsErr) {
        console.error(`${tag} syncAdSetsAndAds failed (non-fatal):`, adsErr instanceof Error ? adsErr.message : adsErr);
      }

      // Phase 4: Ad-level daily stats (feeds get_creative_performance)
      try {
        const adInsResult = await worker.syncAdInsights(acct.id, { since, until });
        changedRows += adInsResult.rowsUpserted;
        console.log(`${tag} ad insights: ${adInsResult.rowsUpserted} rows`);
      } catch (aiErr) {
        console.error(`${tag} syncAdInsights failed (non-fatal):`, aiErr instanceof Error ? aiErr.message : aiErr);
      }

      // Phase 5: Breakdowns (age/gender/platform — feeds audience tool)
      try {
        const bdResult = await worker.syncBreakdowns(acct.id, { since, until });
        console.log(`${tag} breakdowns: ${bdResult.rowsUpserted} segment rows`);
      } catch (bdErr) {
        console.error(`${tag} syncBreakdowns failed (non-fatal):`, bdErr instanceof Error ? bdErr.message : bdErr);
      }

      // Phase 6: Smart Refresh Engine — event-driven recalculation.
      // Runs engines + brain ONLY when this sync actually changed data,
      // auto-completes recommendations the merchant already applied in Meta,
      // and writes a refresh_logs row either way (observability).
      await runRefresh(prisma, metaClient, {
        type: 'MetaSyncCompleted',
        adAccountId: acct.id,
        changedRows,
        campaignChanges,
      });

      console.log(`${tag} ✓ full sync done (${Date.now() - syncStart}ms)`);
    } catch (err) {
      console.error(`[adlytic:auto-sync] Error syncing ${acct.externalAccountId}:`, err);
      if (err instanceof MetaApiError) {
        const body = err.body as Record<string, any>;
        if (body?.error?.code === 190) {
          await handle190();
        }
      }
    }
  }
}

// Recursive setTimeout so the next pass only starts after the previous one
// fully completes. setInterval would queue overlapping runs if a sync takes
// longer than SYNC_INTERVAL_MS (e.g. many accounts, slow Meta API).
async function runBackgroundPass(prisma: PrismaClient): Promise<void> {
  const locked = await withAdvisoryLock('adlytic:auto-sync', async () => {
    await refreshExpiringMetaTokens(prisma);
    await syncAllAccounts(prisma);
  });
  if (!locked.acquired) {
    console.log('[adlytic:auto-sync] Another instance holds the auto-sync lock — skipping this tick');
  }
}

function scheduleSyncLoop(prisma: PrismaClient): void {
  setTimeout(async () => {
    await runBackgroundPass(prisma);
    scheduleSyncLoop(prisma);
  }, SYNC_INTERVAL_MS);
}

// ── Connection Orchestrator poll ─────────────────────────────────────
// Drives every non-terminal onboarding record whose adaptive next_check_at
// has come due. Failures are isolated PER RECORD: one client whose Meta
// call blows up must never stop the other nineteen from progressing.
async function runOnboardingPass(prisma: PrismaClient): Promise<void> {
  let due;
  try {
    due = await listDue(prisma, ONBOARDING_BATCH);
  } catch (err) {
    console.error('[adlytic:onboarding] Failed to list due records:', err instanceof Error ? err.message : err);
    return;
  }
  if (due.length === 0) return;

  let advanced = 0;
  let failed = 0;
  for (const record of due) {
    try {
      await advance(prisma, record.id, metaAdapter);
      advanced++;
    } catch (err) {
      failed++;
      console.error(
        `[adlytic:onboarding] advance failed for ${record.id} (${record.externalAccountId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  console.log(`[adlytic:onboarding] pass done — due=${due.length} advanced=${advanced} failed=${failed}`);
}

function scheduleOnboardingLoop(prisma: PrismaClient): void {
  setTimeout(async () => {
    await runOnboardingPass(prisma);
    scheduleOnboardingLoop(prisma);
  }, ONBOARDING_POLL_INTERVAL_MS);
}

// ── Raw insights retention job ───────────────────────────────────────
// Deletes raw_insight rows older than RAW_INSIGHTS_RETAIN_DAYS to prevent
// unbounded table growth. Processed data lives in daily_stats and is kept.
async function pruneRawInsights(prisma: PrismaClient): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RAW_INSIGHTS_RETAIN_DAYS * 864e5);
    const result = await prisma.rawInsight.deleteMany({
      where: { fetchedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      console.log(`[adlytic:retention] Deleted ${result.count} raw_insight rows older than ${RAW_INSIGHTS_RETAIN_DAYS} days`);
    }
  } catch (err) {
    console.error('[adlytic:retention] Failed to prune raw_insights:', err);
  }
}

async function refreshHistoryRollups(prisma: PrismaClient): Promise<void> {
  try {
    const result = await refreshCampaignHistoryRollups(prisma);
    if (result.upserted > 0) {
      console.log(
        `[adlytic:rollup] Refreshed ${result.upserted} rollup row(s) across ${result.workspaces} workspace(s)`,
      );
    }
  } catch (err) {
    console.error('[adlytic:rollup] Failed to refresh campaign history rollups:', err);
  }
}

async function runDailyMaintenance(prisma: PrismaClient): Promise<void> {
  await pruneRawInsights(prisma);
  await refreshHistoryRollups(prisma);
  await runIntegritySweep(prisma);
}

/** Periodic data-integrity observer — logs warnings and auto-cleans orphans. */
async function runIntegritySweep(prisma: PrismaClient): Promise<void> {
  try {
    const accounts = await prisma.adAccount.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        timezone: true,
        lastSyncedAt: true,
        workspaceId: true,
      },
    });
    for (const account of accounts) {
      if (!account.workspaceId) continue;
      const report = await runDataIntegrityCheck(prisma, account.workspaceId, account);
      const actionable = report.checks.filter(
        (c) => c.severity === 'WARN' || c.severity === 'CRITICAL',
      );
      if (actionable.length > 0) {
        console.warn(
          `[adlytic:integrity] workspace=${account.workspaceId} status=${report.overallStatus} checks=${actionable.map((c) => c.code).join(',')}`,
        );
      }
    }
    const cleaned = await cleanupOrphanedCampaignStats(prisma);
    if (cleaned > 0) {
      console.log(`[adlytic:integrity] auto-cleaned ${cleaned} orphaned daily_stat row(s) globally`);
    }
  } catch (err) {
    console.error('[adlytic:integrity] Sweep failed:', err);
  }
}

/**
 * Boot every recurring background workflow: BullMQ workers (no-op when
 * BULLMQ_ENABLED is off), the auto-sync loop, and daily maintenance. Called
 * by the combined API process (default) or the dedicated worker service.
 */
export function startBackgroundWork(prisma: PrismaClient): void {
  // BullMQ workers drain the 4 queues (sync-account, maintenance,
  // engines-and-brain, reconcile-campaigns). No-op when BULLMQ_ENABLED is off.
  bootQueueWorkers(prisma);

  scheduleSyncLoop(prisma);

  // Connection Orchestrator: its own cadence, independent of the ETL loop.
  scheduleOnboardingLoop(prisma);

  // Delay initial maintenance by 30s so startup traffic settles first.
  setTimeout(() => {
    void runDailyMaintenance(prisma);
    setInterval(() => { void runDailyMaintenance(prisma); }, 24 * 60 * 60_000);
    // Integrity sweep every 6h — catches dormant ACTIVE inflation + orphaned stats.
    setInterval(() => { void runIntegritySweep(prisma); }, 6 * 60 * 60_000);
  }, 30_000);
}
