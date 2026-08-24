// ════════════════════════════════════════════════════════════════════════
//  src/lib/initialSync.ts
//
//  Extracted from src/api/server.ts as part of Phase 3 (BullMQ wiring).
//
//  `kickoffInitialSync` was previously a closure-scoped helper inside
//  buildRoutes(); it had to be hoisted to a module-level export so the
//  BullMQ `maintenance` worker can invoke it when it dequeues an
//  `initial-sync-kickoff` job. The body is byte-for-byte the same as
//  before — only the indentation and `prisma` parameter change.
//
//  Behavior contract (unchanged from the inline version):
//    1. Look up the AdAccount; bail silently if missing.
//    2. Resolve the authoritative token (per-account, or via MetaConnection
//       for SYSTEM_USER rows). Bail with a warning if no token.
//    3. Decrypt the token. On TOKEN_ENCRYPTION_KEY mismatch, log and bail —
//       NEVER mistake a key-mismatch for an expired Meta token.
//    4. Create a PENDING SyncJob row scoped to INITIAL_BACKFILL_DAYS.
//    5. Fire-and-forget the chunked sync (engines + brain on COMPLETED).
//    6. In parallel, fire-and-forget the lifetime-totals refresh.
//
//  Steps 5 & 6 now go through enqueueOrFallback so that, when the
//  BULLMQ_ENABLED flag is on AND Redis is healthy, they enqueue BullMQ
//  jobs instead of running on local setImmediate. When the flag is off or
//  Redis is unhealthy the fallback path is the exact original behavior.
// ════════════════════════════════════════════════════════════════════════

import { SyncJobStatus, type PrismaClient } from '@prisma/client';
import { SyncAccountWorker } from '../workers/syncAccount';
import { runEngines } from '../workers/runEngines';
import { runBrainOrchestrator } from '../workers/runBrainOrchestrator';
import { MetaClient } from '../services/metaClient';
import { resolveAccountToken } from '../services/accountToken';
import { decryptToken } from '../services/tokenEncryption';
import { config } from '../config';
import { enqueueOrFallback, getQueues, isQueueEnabled } from './queue';

/** First-time backfill on Meta account connect. Mirrors the constant in
 *  server.ts; both must stay in sync if changed. */
export const INITIAL_BACKFILL_DAYS = 180;

/**
 * Fire-and-forget initial backfill after an account is connected (OAuth or
 * manual). Creates a SyncJob and dispatches the chunked sync + lifetime-totals
 * refresh — through BullMQ when enabled, otherwise via in-process setImmediate.
 */
export async function kickoffInitialSync(
  prisma: PrismaClient,
  adAccountId: string,
  triggeredBy: string,
): Promise<void> {
  const account = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!account) return;

  const resolvedToken = await resolveAccountToken(prisma, account);
  if (!resolvedToken.encrypted) {
    console.warn(`[adlytic:initial-sync] ${account.externalAccountId} — no token, skipping backfill`);
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(resolvedToken.encrypted);
  } catch (decErr) {
    const msg = decErr instanceof Error ? decErr.message : String(decErr);
    console.error(`[adlytic:initial-sync] ${account.externalAccountId} — token decrypt failed: ${msg}`);
    return;
  }

  const apiVersion = config.meta.apiVersion;
  const metaClient = new MetaClient({ apiVersion, accessToken , timezone: account.timezone });
  const worker = new SyncAccountWorker(prisma, metaClient);
  const now = new Date();
  const since = new Date(now.getTime() - (INITIAL_BACKFILL_DAYS - 1) * 86400 * 1000);

  // Reuse an already-active job — double connect/reconnect must not enqueue
  // parallel 180-day backfills that fight over the advisory lock.
  const existingActive = await prisma.syncJob.findFirst({
    where: {
      adAccountId: account.id,
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.PROCESSING] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existingActive) {
    console.log(
      `[adlytic:initial-sync] ${account.externalAccountId} — reusing active job ${existingActive.id} (${existingActive.status})`,
    );
    return;
  }

  const job = await prisma.syncJob.create({
    data: {
      adAccountId: account.id,
      status: SyncJobStatus.PENDING,
      windowDays: INITIAL_BACKFILL_DAYS,
      windowSince: since,
      windowUntil: now,
      triggeredBy,
    },
  });

  // ── Sync-account leg ──────────────────────────────────────────────────────
  // BullMQ path: enqueue a job carrying the SyncJob id + a flag instructing
  // the processor to run engines + brain on COMPLETED. In-process fallback:
  // the original setImmediate body unchanged.
  enqueueOrFallback(
    () =>
      getQueues()!.syncAccount.add('initial-backfill', {
        syncJobId: job.id,
        adAccountId: account.id,
        runEnginesOnCompleted: true,
        triggeredBy,
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
            console.error('[adlytic:initial-sync]', err);
          }
        })();
      });
    },
  );

  // ── Lifetime-totals leg ───────────────────────────────────────────────────
  // BullMQ path: enqueue a maintenance/lifetime-totals job. In-process
  // fallback: original setImmediate body unchanged.
  enqueueOrFallback(
    () => getQueues()!.maintenance.add('lifetime-totals', { adAccountId: account.id }),
    () => {
      setImmediate(() => {
        void worker.syncLifetimeTotals(account.id).catch((err: unknown) => {
          console.error('[adlytic:lifetime-sync]', err);
        });
      });
    },
  );

  // Silence the unused-when-queue-enabled binding; the metaClient/worker pair
  // is constructed eagerly so the fallback path can use it without re-resolving.
  void isQueueEnabled;
}
