// ════════════════════════════════════════════════════════════════════════
//  src/workers/queue/syncAccountProcessor.ts
//
//  BullMQ processor for the `sync-account-v1` queue.
//
//  Job payload shape (job.data):
//    {
//      syncJobId:               string  // the SyncJob row id (already PENDING)
//      adAccountId:             string  // redundancy for sanity-check + logs
//      runEnginesOnCompleted:   boolean // run engines + brain after COMPLETED
//      triggeredBy?:            string  // free-form label for log lines only
//      handle190OnFailure?:     boolean // run handleMeta190 on a 190 error
//      isSystemUser?:           boolean // passed to handleMeta190
//      connectionId?:           string | null // passed to handleMeta190
//      externalAccountId?:      string  // passed to handleMeta190 + log lines
//    }
//
//  The processor rebuilds the MetaClient from the stored token each time it
//  runs (workers must NEVER trust a closure-captured token — it may have been
//  rotated since the producer enqueued). All failures throw so BullMQ records
//  the attempt and applies the configured retry policy.
// ════════════════════════════════════════════════════════════════════════

import { Job } from 'bullmq';
import { SyncJobStatus, type PrismaClient } from '@prisma/client';
import { SyncAccountWorker } from '../syncAccount';
import { runEngines } from '../runEngines';
import { runBrainOrchestrator } from '../runBrainOrchestrator';
import { MetaClient, MetaApiError } from '../../services/metaClient';
import { resolveAccountToken, handleMeta190 } from '../../services/accountToken';
import { decryptToken, TokenDecryptError } from '../../services/tokenEncryption';
import { config } from '../../config';

export interface SyncAccountJobData {
  syncJobId: string;
  adAccountId: string;
  runEnginesOnCompleted: boolean;
  triggeredBy?: string;
  handle190OnFailure?: boolean;
  isSystemUser?: boolean;
  connectionId?: string | null;
  externalAccountId?: string;
}

export function createSyncAccountProcessor(prisma: PrismaClient) {
  return async function processSyncAccountJob(job: Job<SyncAccountJobData>): Promise<void> {
    const { syncJobId, runEnginesOnCompleted, handle190OnFailure } = job.data;

    const syncJob = await prisma.syncJob.findUnique({ where: { id: syncJobId } });
    if (!syncJob) {
      // The row was deleted between enqueue and dequeue. Nothing to do.
      console.warn(`[adlytic:queue:sync-account] SyncJob ${syncJobId} no longer exists — skipping`);
      return;
    }

    const account = await prisma.adAccount.findUnique({ where: { id: syncJob.adAccountId } });
    if (!account) {
      console.warn(
        `[adlytic:queue:sync-account] AdAccount ${syncJob.adAccountId} not found for SyncJob ${syncJobId} — skipping`,
      );
      return;
    }

    const resolved = await resolveAccountToken(prisma, account);
    if (!resolved.encrypted) {
      console.warn(
        `[adlytic:queue:sync-account] ${account.externalAccountId} — no token available, skipping`,
      );
      return;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(resolved.encrypted);
    } catch (err) {
      if (err instanceof TokenDecryptError) {
        console.error(
          `[adlytic:queue:sync-account] ${account.externalAccountId} — token decrypt failed: ${err.message}`,
        );
        return;
      }
      throw err;
    }

    const metaClient = new MetaClient({ apiVersion: config.meta.apiVersion, accessToken , timezone: account.timezone });
    const worker = new SyncAccountWorker(prisma, metaClient);

    const handle190 = (): Promise<void> =>
      handleMeta190(prisma, {
        accountId: account.id,
        externalAccountId: account.externalAccountId,
        isSystemUser: resolved.isSystemUser,
        connectionId: resolved.connectionId,
        workspaceId: account.workspaceId,
      });

    try {
      await worker.syncChunked(syncJobId);
      const final = await prisma.syncJob.findUnique({ where: { id: syncJobId } });
      if (final?.status === SyncJobStatus.COMPLETED) {
        if (runEnginesOnCompleted) {
          try {
            await runEngines(prisma, account.id);
            await runBrainOrchestrator(prisma, metaClient, account.id);
          } catch (engineErr) {
            // Sync data is durable; engines failed separately. Surface in logs
            // and on the SyncJob error field without flipping COMPLETED → FAILED.
            const msg = engineErr instanceof Error ? engineErr.message : String(engineErr);
            console.error(
              `[adlytic:queue:sync-account] ${account.externalAccountId} — engines failed after COMPLETED sync:`,
              msg,
            );
            await prisma.syncJob.update({
              where: { id: syncJobId },
              data: { error: `Insights pending — engine pipeline failed: ${msg.slice(0, 400)}` },
            });
          }
        }
      } else if (
        handle190OnFailure &&
        final?.error &&
        /code.*190|190.*code|OAuthException/.test(final.error)
      ) {
        await handle190();
      }
    } catch (err) {
      const lockHeld =
        err instanceof Error &&
        ((err as Error & { code?: string }).code === 'SYNC_LOCK_HELD' ||
          err.message === 'SYNC_LOCK_HELD');
      if (lockHeld) {
        // Contended lock — leave PENDING and let BullMQ retry with backoff.
        console.warn(
          `[adlytic:queue:sync-account] ${account.externalAccountId} — lock held, will retry`,
        );
        throw err;
      }
      console.error(`[adlytic:queue:sync-account] ${account.externalAccountId} — syncChunked failed:`, err);
      if (handle190OnFailure && err instanceof MetaApiError) {
        const body = err.body as Record<string, unknown> | null;
        const errObj = body && typeof body === 'object' ? (body['error'] as Record<string, unknown> | undefined) : undefined;
        if (errObj && errObj['code'] === 190) {
          await handle190();
        }
      }
      // Re-throw so BullMQ records the failure and applies retry policy.
      throw err;
    }
  };
}
