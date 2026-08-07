// ════════════════════════════════════════════════════════════════════════
//  src/workers/syncAccount.ts
//
//  ETL ORCHESTRATOR for one ad account.
//
//    Extract:    metaClient.getInsights(...)
//    Transform:  mapMetaInsight(...)
//    Load:       rawInsightsRepo.append + dailyStatsRepo.upsert
//
//  This worker NEVER writes to: metric_trends, detected_issues, knowledge_rules,
//  recommendations, health_scores. Those are downstream engines' jobs.
//
//  Idempotent: re-running over the same window converges, because daily_stats
//  is upserted on (entity_type, entity_id, date). raw_insights is append-only
//  by design — re-runs accumulate raw rows, which is correct (an audit trail).
//
//  Backfill window: Meta's attribution updates results for ~72 hours. The
//  worker re-pulls the last `backfillDays` (default 7) every run so updated
//  numbers overwrite stale daily_stats. This is a FEATURE of upsert, not a bug.
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient, EntityType, EntityStatus, SyncJobStatus, Prisma } from "@prisma/client";
import { MetaClient, MetaApiError, DEFAULT_INSIGHT_FIELDS, AD_RELEVANCE_FIELDS } from "../services/metaClient";
import { mapMetaInsight, mapMetaBreakdownInsight, mapAdRelevance } from "../mappers/insightMapper";
import { mapMetaAdSet, mapMetaAd } from "../mappers/creativeMapper";
import { RawInsightsRepo } from "../repositories/rawInsightsRepo";
import { DailyStatsRepo } from "../repositories/dailyStatsRepo";
import { healAccountCurrencyAndSpend } from "../lib/iqdRepair";
import { currencyFactorNeedsHeal, resolveCurrencyMinorFactor } from "../lib/currency";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { freezeCampaign } from "../lib/campaignFreeze";
import {
  mapMetaEntityStatus,
  resolveCampaignStatusFromMeta,
} from "../lib/metaEntityStatus";

/** Defense-in-depth (G2): IQD must always map with factor=1 — never 100. */
function currencyFactorForMapper(
  currency: string,
  storedFactor: number,
  context: string,
): number {
  const factor = resolveCurrencyMinorFactor(currency, storedFactor);
  if (currency === "IQD" && factor !== 1) {
    throw new Error(
      `[currency-assert] ${context}: IQD account passed factor=${factor}, expected 1`,
    );
  }
  return factor;
}

// ── Chunked sync constants ──────────────────────────────────────────────
/** Days per chunk. 7 keeps each Meta call small enough to dodge rate limits. */
const CHUNK_SIZE_DAYS = 7;
/** Politeness pause between chunks to keep Meta happy. */
const INTER_CHUNK_DELAY_MS = 150;
/** Parallel campaign-insight fetches. 5 balances throughput vs Meta rate limits. */
const CAMPAIGN_CONCURRENCY = 5;

function isTerminalStatus(status: EntityStatus): boolean {
  return status === EntityStatus.PAUSED || status === EntityStatus.ARCHIVED;
}

/**
 * Final-freeze trigger (H-1): branch inside sync write only.
 * Fires on ACTIVE→terminal status transition (Q1: date-elapsed is deferred).
 */
export function shouldTriggerCampaignFreeze(args: {
  priorStatus: EntityStatus | null;
  newStatus: EntityStatus;
}): boolean {
  return args.priorStatus === EntityStatus.ACTIVE && isTerminalStatus(args.newStatus);
}

export interface SyncResult {
  adAccountId: string;
  externalAccountId: string;
  rowsFetched: number;
  rowsUpserted: number;
  windowSince: string;
  windowUntil: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface SyncOptions {
  /** Days back to pull each run. ≥3 to capture Meta's attribution backfill. */
  backfillDays?: number;
  /** Override "now" — useful for tests and replays. */
  now?: Date;
}

// ── Meta rate-limit + breakdown-error helpers ───────────────────────────
//
// Meta surfaces "user request limit reached" as HTTP 400 with body
// `{ error: { code: 17, error_subcode: 2446079, ... } }`. Code 17 is distinct
// from HTTP 429 (which our metaClient already retries with exp backoff); it
// fires per-AD-ACCOUNT and per-user, NOT per-IP, so spinning up parallel
// workers does NOT route around it. The only effective remedies are
// (a) reducing the work we ask for and (b) backing off when we hit it.
//
// `extractMetaErrorCode` pulls `error.code` out of a MetaApiError body so
// callers can branch on the specific failure class without parsing strings.
function extractMetaErrorCode(err: unknown): number | null {
  if (!(err instanceof MetaApiError)) return null;
  const body = err.body as { error?: { code?: unknown } } | null | undefined;
  const code = body?.error?.code;
  return typeof code === "number" ? code : null;
}

// True for any Meta error indicating the breakdown combination is rejected
// at the platform layer. We currently only see this for
// `platform_position` × the messaging-action set, but the matcher is broad
// enough to catch the analogous "(#100) Invalid parameter" surface for any
// future incompatible breakdown rather than crashing the whole sync.
function isInvalidBreakdownCombination(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false;
  if (err.status !== 400) return false;
  const body = err.body as { error?: { code?: unknown; message?: unknown } } | null | undefined;
  const code = body?.error?.code;
  const msg = String(body?.error?.message ?? "").toLowerCase();
  // OAuthException #100 == "Invalid parameter" — Meta's catch-all for
  // breakdown/field combinations they refuse to compute.
  if (code === 100) return true;
  if (msg.includes("invalid") && (msg.includes("breakdown") || msg.includes("combination"))) {
    return true;
  }
  return false;
}

/**
 * Run an async Meta call once, and if it fails with `error.code = 17`
 * (user request limit reached), sleep CODE_17_COOLDOWN_MS and try again
 * exactly once. Any other error — and a second code-17 hit — propagates
 * untouched so the caller's existing fault-isolation paths still fire.
 *
 * We intentionally retry ONCE, not in a loop: code 17 typically lasts for
 * minutes once tripped; a tight retry loop would just burn the budget
 * faster. One retry covers transient spikes without becoming the problem.
 */
const CODE_17_COOLDOWN_MS = 2000;
async function withCode17Retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (extractMetaErrorCode(e) !== 17) throw e;
    console.warn(`[meta-throttle] ${label} hit Meta code 17 — sleeping ${CODE_17_COOLDOWN_MS}ms and retrying once…`);
    await new Promise<void>((r) => setTimeout(r, CODE_17_COOLDOWN_MS));
    return await fn();
  }
}

/** Politeness spacing between campaigns inside ad/creative discovery —
 *  separate from INTER_CHUNK_DELAY_MS (which gates *batches* of 3). This
 *  delay sits BETWEEN individual campaign processing blocks to spread
 *  Meta call volume more evenly over time. */
const INTER_CAMPAIGN_DELAY_MS = 500;

// ── Negative cache: breakdown dimensions Meta rejects for an account ────
//
// Meta refuses certain breakdown × field combinations at the platform layer
// (HTTP 400, OAuthException #100) — a PERMANENT shape mismatch, most
// consistently `platform_position` × the messaging-action field set. Without
// a cache we re-issue the doomed call on EVERY sync for EVERY campaign, and
// each rejection is an HTTP ≥400 counted against the Marketing API Access
// Tier's <15% error-rate gate — a systematic self-inflicted error source.
//
// Keyed `${adAccountId}:${dim}`, process-lifetime: a deploy resets it, which
// matches the only cadence at which our field list (the other half of the
// combination) can change.
const rejectedBreakdownDims = new Set<string>();

export class SyncAccountWorker {
  private rawRepo: RawInsightsRepo;
  private dailyRepo: DailyStatsRepo;

  constructor(
    private prisma: PrismaClient,
    private meta: MetaClient
  ) {
    this.rawRepo = new RawInsightsRepo(prisma);
    this.dailyRepo = new DailyStatsRepo(prisma);
  }

  /**
   * Sync ONE ad account at the ACCOUNT level (Phase 1 scope).
   * Campaign/adset/ad-level sync is a strict extension — same pipeline,
   * different `level` and `entityType`. Add when the dashboard needs them.
   *
   * Concurrency: uses a Postgres advisory lock (pg_try_advisory_lock) so that
   * multi-instance deployments are also protected. The lock is session-scoped —
   * if the Node process crashes the DB connection is dropped and Postgres
   * releases the lock automatically. No schema migration required.
   */
  async sync(adAccountId: string, opts: SyncOptions = {}): Promise<SyncResult> {
    // Hold the advisory lock on a dedicated pool connection for the whole
    // critical section. Pooled Prisma unlock is unreliable across checkouts.
    const locked = await withAdvisoryLock(adAccountId, () =>
      this.syncLocked(adAccountId, opts),
    );
    if (!locked.acquired) {
      console.warn(`[sync:${adAccountId.slice(0, 8)}] Sync already in progress (advisory lock held) — skipping`);
      return {
        adAccountId,
        externalAccountId: adAccountId,
        rowsFetched: 0,
        rowsUpserted: 0,
        windowSince: '',
        windowUntil: '',
        durationMs: 0,
        ok: false,
        error: 'Sync already in progress for this account',
      };
    }
    return locked.result;
  }

  /** Inner sync body — caller must already hold the per-account advisory lock. */
  private async syncLocked(adAccountId: string, opts: SyncOptions = {}): Promise<SyncResult> {
    const start = Date.now();
    const now = opts.now ?? new Date();
    const backfillDays = Math.max(1, opts.backfillDays ?? 7);

    const since = new Date(now.getTime() - backfillDays * 86400 * 1000);
    const until = now;

    let acct = await this.prisma.adAccount.findUniqueOrThrow({
      where: { id: adAccountId },
    });

    if (currencyFactorNeedsHeal(acct.currency, acct.currencyMinorFactor)) {
      const healed = await healAccountCurrencyAndSpend(this.prisma, acct);
      acct = { ...acct, currencyMinorFactor: healed };
      console.log(
        `[currency-heal] sync ${acct.externalAccountId} ${acct.currency} factor → ${healed}`,
      );
    }

    const result: SyncResult = {
      adAccountId,
      externalAccountId: acct.externalAccountId,
      rowsFetched: 0,
      rowsUpserted: 0,
      windowSince: ymd(since),
      windowUntil: ymd(until),
      durationMs: 0,
      ok: false,
    };

    const tag = `[sync:${acct.externalAccountId}]`;
    console.log(`${tag} SYNC START — window ${ymd(since)} → ${ymd(until)}`);

    try {
      // ─ Extract ────────────────────────────────────────────────────────
      console.log(`${tag} Fetching account-level insights from Meta…`);
      const rows = await this.meta.getInsights({
        externalId: acct.externalAccountId,
        level: "account",
        since,
        until,
      });
      result.rowsFetched = rows.length;
      console.log(`${tag} Fetched ${rows.length} insight rows`);

      if (rows.length === 0) {
        // Genuinely empty windows are valid (a fresh or paused account).
        // We still mark lastSyncedAt so the operator knows the call succeeded.
        console.log(`${tag} No insight rows returned — account may be paused or have no spend in window`);
        await this.reconcileCampaignStatusesSafe(adAccountId, now, tag);
        await this.markSynced(adAccountId, now);
        result.ok = true;
        result.durationMs = Date.now() - start;
        console.log(`${tag} SYNC COMPLETE (empty window) — ${result.durationMs}ms`);
        return result;
      }

      // ─ Transform + Load ──────────────────────────────────────────────
      console.log(`${tag} Saving raw insights (audit trail)…`);
      const rawBatch = rows.map((r) => ({
        entityType: EntityType.ACCOUNT,
        entityId: adAccountId,
        date: new Date(String(r.date_start)),
        rawJson: r,
      }));
      await this.rawRepo.appendMany(rawBatch);
      console.log(`${tag} Saved ${rawBatch.length} raw rows`);

      console.log(`${tag} Saving daily stats (upsert)…`);
      const dailyBatch = rows.map((r) => ({
        entityType: EntityType.ACCOUNT,
        entityId: adAccountId,
        insight: mapMetaInsight(r, {
          currencyMinorFactor: currencyFactorForMapper(
            acct.currency,
            acct.currencyMinorFactor,
            `${tag} account insights`,
          ),
        }),
      }));
      await this.dailyRepo.upsertMany(dailyBatch);
      console.log(`${tag} Upserted ${dailyBatch.length} daily stat rows`);

      result.rowsUpserted = dailyBatch.length;
      await this.reconcileCampaignStatusesSafe(adAccountId, now, tag);
      await this.markSynced(adAccountId, now);
      result.ok = true;
      result.durationMs = Date.now() - start;
      console.log(`${tag} SYNC COMPLETE — ${result.rowsUpserted} rows, ${result.durationMs}ms`);
    } catch (e) {
      result.ok = false;
      result.error = e instanceof MetaApiError
        ? `Meta ${e.status}: ${e.message}`
        : e instanceof Error ? e.message : String(e);
      result.durationMs = Date.now() - start;
      console.error(`${tag} SYNC FAILED — ${result.error}`);
      if (e instanceof MetaApiError) {
        console.error(`${tag} Meta API error body:`, JSON.stringify(e.body).slice(0, 500));
      }
      // Intentionally do NOT mark synced on failure.
    }

    return result;
  }

  private async markSynced(adAccountId: string, when: Date) {
    await this.prisma.adAccount.update({
      where: { id: adAccountId },
      data: { lastSyncedAt: when },
    });
  }

  /** Non-fatal wrapper — campaign status drift must not fail account sync. */
  private async reconcileCampaignStatusesSafe(
    adAccountId: string,
    now: Date,
    tag: string,
  ): Promise<{ ok: boolean; campaignsUpserted?: number; frozen?: number; error?: string }> {
    try {
      const r = await this.reconcileCampaignStatuses(adAccountId, { now });
      console.log(
        `${tag} campaigns reconciled: ${r.campaignsUpserted} row(s)` +
        (r.frozen > 0 ? `, ${r.frozen} frozen` : ""),
      );
      return { ok: true, campaignsUpserted: r.campaignsUpserted, frozen: r.frozen };
    } catch (e) {
      const msg = e instanceof MetaApiError
        ? `Meta ${e.status}: ${e.message}`
        : e instanceof Error ? e.message : String(e);
      console.error(`${tag} reconcileCampaignStatuses FAILED (non-fatal) — ${msg}`);
      if (!(e instanceof MetaApiError)) {
        console.error(`${tag} reconcileCampaignStatuses unexpected error —`, e);
      }
      return { ok: false, error: msg };
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  LIFETIME TOTALS — one-shot account-level lifetime spend.
  //
  //  Bypasses the chunked DailyStat pipeline: Meta returns a single aggregated
  //  row for `date_preset=lifetime`, which we sum and write straight onto
  //  AdAccount. Cheap, idempotent, safe to call from OAuth callback as a
  //  fire-and-forget. Does NOT touch DailyStat or raw_insights.
  // ════════════════════════════════════════════════════════════════════════
  async syncLifetimeTotals(adAccountId: string): Promise<void> {
    const acct = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    const tag = `[syncLifetime:${acct.externalAccountId}]`;
    try {
      console.log(`${tag} Fetching lifetime totals from Meta…`);
      const rows = await this.meta.getLifetimeTotals(acct.externalAccountId);
      let spendMajor = 0;
      for (const r of rows) {
        const v = r.spend;
        const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
        if (Number.isFinite(n)) spendMajor += n;
      }
      const spendMinor = BigInt(Math.round(
        spendMajor * currencyFactorForMapper(
          acct.currency,
          acct.currencyMinorFactor,
          `${tag} lifetime totals`,
        ),
      ));
      await this.prisma.adAccount.update({
        where: { id: adAccountId },
        data: {
          lifetimeSpendMinor: spendMinor,
          lifetimeSyncedAt: new Date(),
        },
      });
      console.log(`${tag} Lifetime spend updated — ${spendMinor.toString()} minor units (${rows.length} row${rows.length === 1 ? '' : 's'} aggregated)`);
    } catch (e) {
      const msg = e instanceof MetaApiError
        ? `Meta ${e.status}: ${e.message}`
        : e instanceof Error ? e.message : String(e);
      console.error(`${tag} FAILED — ${msg}`);
      // Non-fatal: lifetime is best-effort; the chunked sync still runs.
    }
  }

  /**
   * Reconcile Campaign rows from Meta (effective_status, vanished campaigns,
   * freeze triggers). Does NOT pull campaign-level daily insights — cheap
   * enough for the 6-hour auto-sync path alongside account-level sync().
   */
  async reconcileCampaignStatuses(
    adAccountId: string,
    opts: { now?: Date } = {},
  ): Promise<{ campaignsUpserted: number; frozen: number; campaignChanges: import('../services/refresh/refreshEngine').CampaignChange[] }> {
    const acct = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    const tag = `[reconcileCampaigns:${acct.externalAccountId}]`;
    const now = opts.now ?? new Date();
    console.log(`${tag} listing campaigns…`);

    const metaCampaigns = await this.meta.listCampaigns(acct.externalAccountId);
    console.log(`${tag} fetched ${metaCampaigns.length} campaign(s) from Meta`);

    const existingCampaigns = await this.prisma.campaign.findMany({
      where: { adAccountId },
      select: { id: true, externalCampaignId: true, status: true, dailyBudget: true, lifetimeBudget: true },
    });
    const priorByExternal = new Map(
      existingCampaigns.map((c) => [c.externalCampaignId, c]),
    );

    const freezeCandidateIds: string[] = [];
    const returnedExternalIds: string[] = [];
    // Smart Refresh Engine: campaign-level transitions detected against the
    // prior DB row (created / paused / activated / budget changed). Consumed
    // by refreshEngine to auto-complete matching recommendations and to
    // decide whether anything actually changed this sync.
    const campaignChanges: import('../services/refresh/refreshEngine').CampaignChange[] = [];

    const upserts = metaCampaigns.map((mc) => {
      const externalId = String(mc["id"]);
      returnedExternalIds.push(externalId);
      const name = String(mc["name"] ?? "(unnamed)");
      const objective = mc["objective"] != null ? String(mc["objective"]) : null;
      const status = resolveCampaignStatusFromMeta(mc, { now });
      const metaEffectiveStatus = mc["effective_status"] != null
        ? String(mc["effective_status"]).toUpperCase()
        : null;
      const dailyBudget = mc["daily_budget"] != null
        ? BigInt(String(mc["daily_budget"]))
        : null;
      const lifetimeBudget = mc["lifetime_budget"] != null
        ? BigInt(String(mc["lifetime_budget"]))
        : null;

      const prior = priorByExternal.get(externalId);
      if (shouldTriggerCampaignFreeze({
        priorStatus: prior?.status ?? null,
        newStatus: status,
      })) {
        freezeCandidateIds.push(externalId);
      }

      // Detect merchant-side transitions (edits made directly in Meta).
      if (!prior) {
        campaignChanges.push({ campaignId: '', externalCampaignId: externalId, name, kind: 'CampaignCreated' });
      } else {
        if (prior.status !== status) {
          if (status === EntityStatus.PAUSED) {
            campaignChanges.push({ campaignId: prior.id, externalCampaignId: externalId, name, kind: 'CampaignPaused' });
          } else if (status === EntityStatus.ACTIVE) {
            campaignChanges.push({ campaignId: prior.id, externalCampaignId: externalId, name, kind: 'CampaignActivated' });
          }
        }
        const priorBudget = prior.dailyBudget ?? prior.lifetimeBudget;
        const newBudget = dailyBudget ?? lifetimeBudget;
        if (priorBudget != null && newBudget != null && priorBudget !== newBudget) {
          campaignChanges.push({
            campaignId: prior.id,
            externalCampaignId: externalId,
            name,
            kind: 'BudgetChanged',
            prevBudgetMinor: priorBudget.toString(),
            newBudgetMinor: newBudget.toString(),
          });
        }
      }

      return this.prisma.campaign.upsert({
        where: { adAccountId_externalCampaignId: { adAccountId, externalCampaignId: externalId } },
        create: {
          adAccountId,
          externalCampaignId: externalId,
          name,
          objective,
          status,
          metaEffectiveStatus,
          dailyBudget,
          lifetimeBudget,
        },
        update: {
          name,
          objective,
          status,
          metaEffectiveStatus,
          dailyBudget,
          lifetimeBudget,
        },
      });
    });

    const txOps = returnedExternalIds.length > 0
      ? [
          ...upserts,
          this.prisma.campaign.updateMany({
            where: {
              adAccountId,
              externalCampaignId: { notIn: returnedExternalIds },
              status: { in: [EntityStatus.ACTIVE, EntityStatus.PAUSED] },
            },
            data: { status: EntityStatus.ARCHIVED },
          }),
        ]
      : upserts;

    await this.prisma.$transaction(txOps);

    const campaigns = await this.prisma.campaign.findMany({ where: { adAccountId } });
    console.log(`${tag} reconciled ${campaigns.length} campaign row(s)`);

    let frozen = 0;
    if (freezeCandidateIds.length > 0) {
      const campaignByExternal = new Map(campaigns.map((c) => [c.externalCampaignId, c.id]));
      for (const externalId of freezeCandidateIds) {
        const internalId = campaignByExternal.get(externalId);
        if (!internalId) continue;
        try {
          const result = await freezeCampaign(this.prisma, this.meta, internalId, { now });
          if (result.ok && !result.skipped) frozen++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`${tag} freeze campaign=${externalId} FAILED — ${msg}`);
        }
      }
      if (frozen > 0) {
        console.log(`${tag} frozen ${frozen} campaign snapshot(s)`);
      }
    }

    // Resolve internal ids for campaigns that were created this run (their
    // change rows were collected before the upsert existed).
    if (campaignChanges.some((c) => !c.campaignId)) {
      const idByExternal = new Map(campaigns.map((c) => [c.externalCampaignId, c.id]));
      for (const change of campaignChanges) {
        if (!change.campaignId) change.campaignId = idByExternal.get(change.externalCampaignId) ?? '';
      }
    }
    return { campaignsUpserted: campaigns.length, frozen, campaignChanges };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CAMPAIGN DISCOVERY + CAMPAIGN-LEVEL DAILY STATS
  //
  //  Without Campaign rows, the brain orchestrator returns "no campaigns
  //  under account — nothing to do" and the V2 cognitive layer can't build
  //  market baselines (both query prisma.campaign by adAccountId).
  //
  //  This method:
  //    1. Lists campaigns from Meta and upserts the Campaign table on
  //       (adAccountId, externalCampaignId) — idempotent.
  //    2. For each campaign, pulls campaign-level daily insights over the
  //       supplied window, maps them, and upserts DailyStat with
  //       entityType=CAMPAIGN, entityId=internal Campaign.id (NOT Meta id —
  //       the brain joins on the internal cuid).
  //
  //  Concurrency=3 balances throughput against Meta's per-account rate
  //  limits; raw_insights is intentionally NOT written here (audit trail
  //  for accounts is sufficient for now; revisit if attribution disputes
  //  require per-campaign provenance).
  // ════════════════════════════════════════════════════════════════════════
  async syncCampaigns(
    adAccountId: string,
    opts: { since: Date; until: Date; now?: Date }
  ): Promise<{ campaignsUpserted: number; dailyRowsUpserted: number; frozen: number; campaignChanges: import('../services/refresh/refreshEngine').CampaignChange[] }> {
    const acct = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    const tag = `[syncCampaigns:${acct.externalAccountId}]`;
    const now = opts.now ?? new Date();

    const { campaignsUpserted, frozen, campaignChanges } = await this.reconcileCampaignStatuses(adAccountId, { now });

    const campaigns = await this.prisma.campaign.findMany({ where: { adAccountId } });
    console.log(`${tag} ${campaigns.length} campaign row(s) — now pulling daily insights…`);

    let totalDailyUpserted = 0;

    // ── Bounded-concurrency loop over campaigns ───────────────────────────
    for (let i = 0; i < campaigns.length; i += CAMPAIGN_CONCURRENCY) {
      const slice = campaigns.slice(i, i + CAMPAIGN_CONCURRENCY);
      const results = await Promise.allSettled(
        slice.map(async (camp) => {
          const rows = await withCode17Retry(
            `getInsights(${camp.externalCampaignId})`,
            () => this.meta.getInsights({
              externalId: camp.externalCampaignId,
              level: 'campaign',
              since: opts.since,
              until: opts.until,
            }),
          );
          if (rows.length === 0) return 0;

          const dailyBatch = rows.map((r) => ({
            entityType: EntityType.CAMPAIGN,
            entityId: camp.id,
            insight: mapMetaInsight(r, {
              currencyMinorFactor: currencyFactorForMapper(
                acct.currency,
                acct.currencyMinorFactor,
                `${tag} campaign insights`,
              ),
            }),
          }));
          await this.dailyRepo.upsertMany(dailyBatch);
          return dailyBatch.length;
        })
      );

      for (let j = 0; j < results.length; j++) {
        const r = results[j]!;
        const camp = slice[j]!;
        if (r.status === 'fulfilled') {
          totalDailyUpserted += r.value;
        } else {
          const err = r.reason;
          const msg = err instanceof MetaApiError
            ? `Meta ${err.status}: ${err.message}`
            : err instanceof Error ? err.message : String(err);
          console.error(`${tag} campaign=${camp.externalCampaignId} insights FAILED — ${msg}`);
          // Continue with other campaigns; partial success is better than abort.
        }
      }

      if (i + CAMPAIGN_CONCURRENCY < campaigns.length) {
        await sleep(INTER_CHUNK_DELAY_MS);
      }
    }

    console.log(`${tag} done — ${campaigns.length} campaigns, ${totalDailyUpserted} daily rows`);

    return { campaignsUpserted, dailyRowsUpserted: totalDailyUpserted, frozen, campaignChanges };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  AD-SET + AD + CREATIVE DISCOVERY  (Phase 5 — Pass A + B)
  //
  //  Walks every campaign already persisted under `adAccountId`, fetches its
  //  ad sets and ads, and upserts the AdSet / Ad / AdCreative tables.
  //
  //  Key design choices:
  //
  //    1. Discovery only — NO insights pull here. Daily stats for ads/ad-sets
  //       are deliberately deferred (the Brain still operates at campaign
  //       level for Phase 1). Adding ad-level DailyStat is a future Pass D.
  //
  //    2. Creative dedupe — many Meta ads share one creative (boosted post,
  //       carousel reused, etc.). We upsert AdCreative on
  //       (adAccountId, externalCreativeId) FIRST, then point Ad.creativeId
  //       at it. Net effect: 100 ads using 1 creative = 1 AdCreative row.
  //
  //    3. Bounded concurrency — campaigns processed in batches of
  //       CAMPAIGN_CONCURRENCY; INTER_CHUNK_DELAY_MS pause between batches.
  //       Inside a campaign we serialize ad-sets to keep total RPS under
  //       Meta's per-account rate ceiling.
  //
  //    4. Fault isolation — Promise.allSettled at the campaign level and
  //       try/catch around each ad-set fetch so one bad campaign cannot
  //       abort the whole pass. Errors are logged with context.
  // ════════════════════════════════════════════════════════════════════════
  /**
   * Discover ad-sets, ads, and creatives for ONE campaign (Pass A+B body).
   * Extracted so both the batch pass (syncAdSetsAndAds, eligibility-filtered
   * for Meta's call-volume ceiling) and the on-demand single-campaign path
   * (discoverCampaignOnDemand, used when a merchant opens the inspector for
   * a campaign the batch pass skipped) share one implementation — no drift.
   */
  private async discoverOneCampaign(
    adAccountId: string,
    camp: { id: string; externalCampaignId: string },
    creativeIdCache: Map<string, string>,
  ): Promise<{ localAdSets: number; localAds: number; localCreatives: number }> {
    const metaAdSets = await withCode17Retry(
      `listAdSets(${camp.externalCampaignId})`,
      () => this.meta.listAdSets(camp.externalCampaignId),
    );
    let localAdSets = 0;
    let localAds = 0;
    let localCreatives = 0;

    for (const rawAdSet of metaAdSets) {
      const norm = mapMetaAdSet(rawAdSet);
      const adSetRow = await this.prisma.adSet.upsert({
        where: {
          campaignId_externalAdSetId: {
            campaignId: camp.id,
            externalAdSetId: norm.externalAdSetId,
          },
        },
        create: {
          campaignId: camp.id,
          externalAdSetId: norm.externalAdSetId,
          name: norm.name,
          status: mapMetaEntityStatus(norm.status),
          dailyBudget: norm.dailyBudgetMinor,
          optimizationGoal: norm.optimizationGoal,
          destinationType: norm.destinationType,
          targetingJson: norm.targeting as Prisma.InputJsonValue ?? Prisma.JsonNull,
          learningPhaseStatus: norm.learningPhaseStatus,
        },
        update: {
          name: norm.name,
          status: mapMetaEntityStatus(norm.status),
          dailyBudget: norm.dailyBudgetMinor,
          optimizationGoal: norm.optimizationGoal,
          destinationType: norm.destinationType,
          targetingJson: norm.targeting as Prisma.InputJsonValue ?? Prisma.JsonNull,
          learningPhaseStatus: norm.learningPhaseStatus,
        },
        select: { id: true },
      });
      localAdSets++;

      // ── Pass B: Ads under this ad-set (+ inline creatives) ──────
      const metaAds = await withCode17Retry(
        `listAds(${norm.externalAdSetId})`,
        () => this.meta.listAds(norm.externalAdSetId),
      );

      for (const rawAd of metaAds) {
        const adNorm = mapMetaAd(rawAd);

        // Resolve/upsert creative FIRST so we have its internal id
        // for the Ad.creativeId FK.
        let creativeInternalId: string | null = null;
        if (adNorm.creative) {
          const cached = creativeIdCache.get(adNorm.creative.externalCreativeId);
          if (cached) {
            creativeInternalId = cached;
          } else {
            const cRow = await this.prisma.adCreative.upsert({
              where: {
                adAccountId_externalCreativeId: {
                  adAccountId,
                  externalCreativeId: adNorm.creative.externalCreativeId,
                },
              },
              create: {
                adAccountId,
                externalCreativeId: adNorm.creative.externalCreativeId,
                name: adNorm.creative.name,
                thumbnailUrl: adNorm.creative.thumbnailUrl,
                imageHash: adNorm.creative.imageHash,
                videoId: adNorm.creative.videoId,
                primaryText: adNorm.creative.primaryText,
                headline: adNorm.creative.headline,
                description: adNorm.creative.description,
                callToActionType: adNorm.creative.callToActionType,
                raw: adNorm.creative.raw as Prisma.InputJsonValue,
              },
              update: {
                name: adNorm.creative.name,
                thumbnailUrl: adNorm.creative.thumbnailUrl,
                imageHash: adNorm.creative.imageHash,
                videoId: adNorm.creative.videoId,
                primaryText: adNorm.creative.primaryText,
                headline: adNorm.creative.headline,
                description: adNorm.creative.description,
                callToActionType: adNorm.creative.callToActionType,
                raw: adNorm.creative.raw as Prisma.InputJsonValue,
              },
              select: { id: true },
            });
            creativeInternalId = cRow.id;
            creativeIdCache.set(adNorm.creative.externalCreativeId, cRow.id);
            localCreatives++;
          }
        }

        await this.prisma.ad.upsert({
          where: {
            adSetId_externalAdId: {
              adSetId: adSetRow.id,
              externalAdId: adNorm.externalAdId,
            },
          },
          create: {
            adSetId: adSetRow.id,
            externalAdId: adNorm.externalAdId,
            name: adNorm.name,
            status: mapMetaEntityStatus(adNorm.status),
            creativeId: creativeInternalId,
            // Keep the legacy blob populated until consumers migrate fully.
            creativeJson: (adNorm.creative?.raw as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          },
          update: {
            name: adNorm.name,
            status: mapMetaEntityStatus(adNorm.status),
            creativeId: creativeInternalId,
            creativeJson: (adNorm.creative?.raw as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          },
        });
        localAds++;
      }
    }

    return { localAdSets, localAds, localCreatives };
  }

  /**
   * On-demand discovery for ONE campaign, bypassing the batch eligibility
   * filter (ACTIVE OR recently-spent) that protects Meta's per-account call
   * ceiling. Used when a merchant explicitly opens a campaign the batch pass
   * skipped (e.g. paused with no spend in the sync window) — the inspector
   * would otherwise show "no creatives yet" forever, which is dishonest: the
   * scheduled sync will never revisit that campaign under the batch filter.
   *
   * Read-only against Meta (GET ad-sets/ads/insights) — writes only to our
   * own DB. Not a Meta write-action, so it carries none of those risks.
   * Bounded to a handful of Meta calls (one campaign, not the whole account).
   */
  async discoverCampaignOnDemand(
    adAccountId: string,
    campaignId: string,
    opts: { insightsSince?: Date; insightsUntil?: Date } = {},
  ): Promise<{
    found: boolean;
    adSetsUpserted: number;
    adsUpserted: number;
    creativesUpserted: number;
    insightRows: number;
  }> {
    const [camp, acct] = await Promise.all([
      this.prisma.campaign.findFirst({
        where: { id: campaignId, adAccountId },
        select: { id: true, externalCampaignId: true },
      }),
      this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } }),
    ]);
    if (!camp) {
      return { found: false, adSetsUpserted: 0, adsUpserted: 0, creativesUpserted: 0, insightRows: 0 };
    }

    const creativeIdCache = new Map<string, string>();
    const { localAdSets, localAds, localCreatives } = await this.discoverOneCampaign(adAccountId, camp, creativeIdCache);

    const until = opts.insightsUntil ?? new Date();
    const since = opts.insightsSince ?? new Date(until.getTime() - 30 * 86400 * 1000);
    const { localRows } = await this.syncOneCampaignAdInsights(acct, camp, { since, until });

    return {
      found: true,
      adSetsUpserted: localAdSets,
      adsUpserted: localAds,
      creativesUpserted: localCreatives,
      insightRows: localRows,
    };
  }

  async syncAdSetsAndAds(
    adAccountId: string,
    opts: { since?: Date } = {}
  ): Promise<{ adSetsUpserted: number; adsUpserted: number; creativesUpserted: number }> {
    const acct = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    const tag = `[syncAdsAndCreatives:${acct.externalAccountId}]`;

    // Default to a 30-day spend lookback when the caller doesn't pass one —
    // matches the dashboard's default inspector window so "campaigns the
    // operator sees" and "campaigns we walk for creatives" are the same set.
    const since = opts.since ?? new Date(Date.now() - 30 * 86400 * 1000);

    const allCampaigns = await this.prisma.campaign.findMany({
      where: { adAccountId },
      select: { id: true, externalCampaignId: true, name: true, status: true },
    });
    if (allCampaigns.length === 0) {
      console.log(`${tag} no campaigns under account — nothing to discover`);
      return { adSetsUpserted: 0, adsUpserted: 0, creativesUpserted: 0 };
    }

    // ── Optimization: filter to ACTIVE OR recently-spent campaigns ─────────
    //
    // Meta enforces a per-ad-account call-volume ceiling (error code 17).
    // On accounts with 70+ historical campaigns, walking every one to fetch
    // ad-sets + ads instantly burns the entire budget — and ~90% of those
    // calls return data for paused campaigns the operator can no longer
    // act on. We restrict to:
    //
    //   • status = ACTIVE             — currently delivering, always worth refresh
    //   • any campaign with non-zero spend inside the sync window
    //
    // A paused campaign that spent yesterday still belongs in the set: the
    // operator may want to inspect why it paused. A campaign last active in
    // 2024 does NOT — fetching its dead creatives wastes the API budget that
    // the live ones need.
    //
    // Pulling spend totals: ONE aggregate query over DailyStat keyed by the
    // campaign IDs we just listed. Cheap (small N, indexed columns) and
    // happens BEFORE any Meta call, so the budget is unaffected by it.
    const campaignIds = allCampaigns.map((c) => c.id);
    const spentRows = await this.prisma.dailyStat.groupBy({
      by: ['entityId'],
      where: {
        entityType: EntityType.CAMPAIGN,
        entityId: { in: campaignIds },
        date: { gte: since },
        spend: { gt: 0n },
      },
      _sum: { spend: true },
    });
    const recentlySpentIds = new Set(spentRows.map((r) => r.entityId));

    const campaigns = allCampaigns.filter(
      (c) => c.status === EntityStatus.ACTIVE || recentlySpentIds.has(c.id),
    );
    const skipped = allCampaigns.length - campaigns.length;
    console.log(
      `${tag} walking ${campaigns.length}/${allCampaigns.length} campaign(s) for ad-sets, ads, creatives ` +
      `(skipped ${skipped} inactive+no-spend; window since ${ymd(since)})`
    );

    if (campaigns.length === 0) {
      console.log(`${tag} no eligible campaigns after filter — nothing to discover`);
      return { adSetsUpserted: 0, adsUpserted: 0, creativesUpserted: 0 };
    }

    let adSetsUpserted = 0;
    let adsUpserted = 0;
    let creativesUpserted = 0;
    // Track creative dedupe inside a single run so we don't issue redundant
    // upserts when N ads in the same batch share one creative.
    const creativeIdCache = new Map<string, string>();   // externalCreativeId → internal AdCreative.id

    for (let i = 0; i < campaigns.length; i += CAMPAIGN_CONCURRENCY) {
      const slice = campaigns.slice(i, i + CAMPAIGN_CONCURRENCY);

      const settled = await Promise.allSettled(
        slice.map(async (camp, sliceIdx) => {
          // Stagger the start of each campaign inside the slice — keeps the
          // burst into Meta from being three simultaneous calls when this
          // promise.allSettled fires. Cheap, big budget savings on hot accounts.
          if (sliceIdx > 0) await sleep(INTER_CAMPAIGN_DELAY_MS);
          const result = await this.discoverOneCampaign(adAccountId, camp, creativeIdCache);
          return { ...result, campLabel: camp.externalCampaignId };
        })
      );

      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]!;
        const camp = slice[j]!;
        if (r.status === 'fulfilled') {
          adSetsUpserted += r.value.localAdSets;
          adsUpserted += r.value.localAds;
          creativesUpserted += r.value.localCreatives;
        } else {
          const err = r.reason;
          const msg = err instanceof MetaApiError
            ? `Meta ${err.status}: ${err.message}`
            : err instanceof Error ? err.message : String(err);
          console.error(`${tag} campaign=${camp.externalCampaignId} ad-set/ad sync FAILED — ${msg}`);
          // Continue with other campaigns; partial success is better than abort.
        }
      }

      if (i + CAMPAIGN_CONCURRENCY < campaigns.length) {
        await sleep(INTER_CHUNK_DELAY_MS);
      }
    }

    console.log(`${tag} done — ${adSetsUpserted} ad-sets, ${adsUpserted} ads, ${creativesUpserted} creatives`);
    return { adSetsUpserted, adsUpserted, creativesUpserted };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  AD-LEVEL DAILY STATS  (Pass D — Phase 2 AI agent, T6 get_creative_performance)
  //
  //  syncAdSetsAndAds() above is discovery-only and explicitly defers
  //  ad-level metrics ("Adding ad-level DailyStat is a future Pass D"). The
  //  AI agent's get_creative_performance tool needs real per-ad spend/
  //  messages to rank creatives — without this pass that tool would always
  //  return empty results, which is worse than not having the tool.
  //
  //  Method: for each eligible campaign, call Meta's insights endpoint at
  //  level='ad' with 'ad_id' added to the requested fields (Meta does NOT
  //  include entity-id fields by default — they must be requested). Map
  //  each row's ad_id (Meta's id) to our internal Ad.id via a lookup built
  //  from Ad.externalAdId, then upsert DailyStat with entityType=AD.
  //
  //  Rows whose ad_id has no matching Ad row are skipped with a warning
  //  (can happen if an ad was created after the last syncAdSetsAndAds
  //  discovery pass) — never crashes the run over one stale id.
  //
  //  Same eligibility filter as syncAdSetsAndAds (ACTIVE OR recently-spent)
  //  to stay inside Meta's per-account call-volume ceiling (error code 17).
  // ════════════════════════════════════════════════════════════════════════
  /**
   * Pull + persist ad-level insights for ONE campaign. Extracted so the batch
   * pass (syncAdInsights) and the on-demand single-campaign path
   * (discoverCampaignOnDemand) share one implementation.
   */
  private async syncOneCampaignAdInsights(
    acct: { currency: string; currencyMinorFactor: number; externalAccountId: string },
    camp: { id: string; externalCampaignId: string },
    opts: { since: Date; until: Date },
    adLevelFields?: string,
  ): Promise<{ localRows: number; localUnmatched: number }> {
    const fields = adLevelFields ?? [...DEFAULT_INSIGHT_FIELDS, 'ad_id', ...AD_RELEVANCE_FIELDS].join(',');
    const tag = `[syncAdInsights:${acct.externalAccountId}]`;

    // Build the external→internal Ad id map for THIS campaign only —
    // bounded query, avoids loading the whole account's ads into memory.
    const ads = await this.prisma.ad.findMany({
      where: { adSet: { campaignId: camp.id } },
      select: { id: true, externalAdId: true },
    });
    if (ads.length === 0) return { localRows: 0, localUnmatched: 0 };
    const adIdMap = new Map(ads.map((a) => [a.externalAdId, a.id]));

    const rows = await withCode17Retry(
      `getInsights(${camp.externalCampaignId}, level=ad)`,
      () => this.meta.getInsights({
        externalId: camp.externalCampaignId,
        level: 'ad',
        since: opts.since,
        until: opts.until,
        fields,
      }),
    );
    if (rows.length === 0) return { localRows: 0, localUnmatched: 0 };

    let localUnmatched = 0;
    const dailyBatch: Array<{ entityType: EntityType; entityId: string; insight: ReturnType<typeof mapMetaInsight> }> = [];
    // Latest relevance grade per ad — Meta returns it per row; keep the
    // most recent day's value so the Ad row reflects current delivery.
    const relByAd = new Map<string, { rel: ReturnType<typeof mapAdRelevance>; date: string }>();
    for (const r of rows) {
      const externalAdId = String((r as Record<string, unknown>)['ad_id'] ?? '');
      const internalAdId = externalAdId ? adIdMap.get(externalAdId) : undefined;
      if (!internalAdId) {
        localUnmatched++;
        continue;
      }
      dailyBatch.push({
        entityType: EntityType.AD,
        entityId: internalAdId,
        insight: mapMetaInsight(r, {
          currencyMinorFactor: currencyFactorForMapper(
            acct.currency,
            acct.currencyMinorFactor,
            `${tag} ad insights`,
          ),
        }),
      });
      const rel = mapAdRelevance(r);
      if (rel) {
        const rowDate = String((r as Record<string, unknown>)['date_start'] ?? '');
        const prev = relByAd.get(internalAdId);
        if (!prev || rowDate >= prev.date) relByAd.set(internalAdId, { rel, date: rowDate });
      }
    }
    if (dailyBatch.length > 0) await this.dailyRepo.upsertMany(dailyBatch);
    await this.persistAdRelevance(relByAd);
    return { localRows: dailyBatch.length, localUnmatched };
  }

  async syncAdInsights(
    adAccountId: string,
    opts: { since: Date; until: Date }
  ): Promise<{ campaignsProcessed: number; rowsUpserted: number; unmatchedAdIds: number }> {
    const acct = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    const tag = `[syncAdInsights:${acct.externalAccountId}]`;

    const allCampaigns = await this.prisma.campaign.findMany({
      where: { adAccountId },
      select: { id: true, externalCampaignId: true, status: true },
    });
    if (allCampaigns.length === 0) {
      console.log(`${tag} no campaigns under account — nothing to sync`);
      return { campaignsProcessed: 0, rowsUpserted: 0, unmatchedAdIds: 0 };
    }

    const campaignIds = allCampaigns.map((c) => c.id);
    const spentRows = await this.prisma.dailyStat.groupBy({
      by: ['entityId'],
      where: {
        entityType: EntityType.CAMPAIGN,
        entityId: { in: campaignIds },
        date: { gte: opts.since },
        spend: { gt: 0n },
      },
      _sum: { spend: true },
    });
    const recentlySpentIds = new Set(spentRows.map((r) => r.entityId));
    const campaigns = allCampaigns.filter(
      (c) => c.status === EntityStatus.ACTIVE || recentlySpentIds.has(c.id),
    );
    if (campaigns.length === 0) {
      console.log(`${tag} no eligible campaigns after filter — nothing to sync`);
      return { campaignsProcessed: 0, rowsUpserted: 0, unmatchedAdIds: 0 };
    }

    const adLevelFields = [...DEFAULT_INSIGHT_FIELDS, 'ad_id', ...AD_RELEVANCE_FIELDS].join(',');
    let rowsUpserted = 0;
    let unmatchedAdIds = 0;
    let campaignsProcessed = 0;

    for (let i = 0; i < campaigns.length; i += CAMPAIGN_CONCURRENCY) {
      const slice = campaigns.slice(i, i + CAMPAIGN_CONCURRENCY);

      const settled = await Promise.allSettled(
        slice.map(async (camp, sliceIdx) => {
          if (sliceIdx > 0) await sleep(INTER_CAMPAIGN_DELAY_MS);
          return this.syncOneCampaignAdInsights(acct, camp, opts, adLevelFields);
        })
      );

      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]!;
        const camp = slice[j]!;
        if (r.status === 'fulfilled') {
          rowsUpserted += r.value.localRows;
          unmatchedAdIds += r.value.localUnmatched;
          campaignsProcessed++;
        } else {
          const err = r.reason;
          const msg = err instanceof MetaApiError
            ? `Meta ${err.status}: ${err.message}`
            : err instanceof Error ? err.message : String(err);
          console.error(`${tag} campaign=${camp.externalCampaignId} ad insights FAILED — ${msg}`);
        }
      }

      if (i + CAMPAIGN_CONCURRENCY < campaigns.length) {
        await sleep(INTER_CHUNK_DELAY_MS);
      }
    }

    if (unmatchedAdIds > 0) {
      console.warn(`${tag} ${unmatchedAdIds} insight row(s) had no matching Ad — likely created after last discovery sync`);
    }
    console.log(`${tag} done — ${campaignsProcessed} campaigns, ${rowsUpserted} ad-level daily rows`);
    return { campaignsProcessed, rowsUpserted, unmatchedAdIds };
  }

  /**
   * Persist Meta's latest relevance grades onto Ad rows. Enrichment only —
   * wrapped so any failure logs and returns without failing the core sync.
   * Raw enum strings are stored; translation to advice happens at read time
   * in knowledge/adRelevanceIntelligence.ts.
   */
  private async persistAdRelevance(
    relByAd: Map<string, { rel: { quality: string; engagement: string; conversion: string } | null; date: string }>,
  ): Promise<void> {
    if (relByAd.size === 0) return;
    const now = new Date();
    try {
      await Promise.all(
        Array.from(relByAd.entries()).map(([adId, { rel }]) => {
          if (!rel) return Promise.resolve(null);
          return this.prisma.ad.update({
            where: { id: adId },
            data: {
              qualityRanking: rel.quality,
              engagementRanking: rel.engagement,
              conversionRanking: rel.conversion,
              rankingsSyncedAt: now,
            },
          }).catch(() => null); // ad may have been deleted between discovery and now
        }),
      );
    } catch (e) {
      console.warn(`[sync] persistAdRelevance skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BREAKDOWN SYNC (Phase 5 — Pass C)
  //
  //  Pulls campaign-level daily insights sliced by ONE breakdown dimension
  //  at a time, mapping each row into the wide BreakdownStat table keyed on
  //  (entityType, entityId, date, breakdownKey, breakdownValue).
  //
  //  Why one dimension per request:
  //  ────────────────────────────────
  //  Meta's `breakdowns` parameter accepts only certain combinations; many
  //  pairs are mutually exclusive (e.g. `age`+`publisher_platform` returns
  //  an empty / errored set). Issuing FOUR separate calls per campaign — one
  //  per dimension — sidesteps the entire compatibility matrix at the cost
  //  of N× requests. With CAMPAIGN_CONCURRENCY=3 and a small inter-dim
  //  delay, total RPS stays inside Meta's per-account ceiling.
  //
  //  Idempotency:
  //  ────────────
  //  BreakdownStat has a unique constraint on
  //  (entityType, entityId, date, breakdownKey, breakdownValue), so re-runs
  //  over an overlapping window converge via upsert — same guarantee as
  //  DailyStat.
  // ════════════════════════════════════════════════════════════════════════
  async syncBreakdowns(
    adAccountId: string,
    opts: { since: Date; until: Date }
  ): Promise<{ campaignsProcessed: number; rowsUpserted: number }> {
    const acct = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    const tag = `[syncBreakdowns:${acct.externalAccountId}]`;

    const campaigns = await this.prisma.campaign.findMany({
      where: { adAccountId },
      select: { id: true, externalCampaignId: true },
    });
    if (campaigns.length === 0) {
      console.log(`${tag} no campaigns — nothing to break down`);
      return { campaignsProcessed: 0, rowsUpserted: 0 };
    }

    // Each dimension is fetched separately — see header for why.
    // 'hourly_stats_aggregated_by_advertiser_time_zone' added for Phase 2 v3
    // (AI agent T9 get_hourly_pattern tool). Meta stores it under that exact
    // field name on breakdown rows; the generic mapMetaBreakdownInsight handles
    // it without a mapper change.
    const DIMENSIONS = [
      'age',
      'gender',
      'publisher_platform',
      'platform_position',
      'hourly_stats_aggregated_by_advertiser_time_zone',
    ] as const;
    const INTER_DIM_DELAY_MS = 200;

    let rowsUpserted = 0;
    let campaignsProcessed = 0;

    for (let i = 0; i < campaigns.length; i += CAMPAIGN_CONCURRENCY) {
      const slice = campaigns.slice(i, i + CAMPAIGN_CONCURRENCY);

      const settled = await Promise.allSettled(
        slice.map(async (camp) => {
          let localRows = 0;
          for (let d = 0; d < DIMENSIONS.length; d++) {
            const dim = DIMENSIONS[d]!;
            // Skip dimensions Meta already rejected for this account this
            // process lifetime — re-asking guarantees another ≥400 error.
            if (rejectedBreakdownDims.has(`${adAccountId}:${dim}`)) continue;
            try {
              const rows = await withCode17Retry(
                `getInsights(${camp.externalCampaignId}, breakdown=${dim})`,
                () => this.meta.getInsights({
                  externalId: camp.externalCampaignId,
                  level: 'campaign',
                  since: opts.since,
                  until: opts.until,
                  breakdowns: [dim],
                }),
              );

              if (rows.length === 0) {
                if (d < DIMENSIONS.length - 1) await sleep(INTER_DIM_DELAY_MS);
                continue;
              }

              // Upsert each row individually — counts per dimension are small
              // (≤ ~30 days × ~10 segments) so a per-row upsert keeps the
              // logic simple and the unique-constraint guarantee intact.
              for (const r of rows) {
                const norm = mapMetaBreakdownInsight(r, dim, {
                  currencyMinorFactor: currencyFactorForMapper(
                    acct.currency,
                    acct.currencyMinorFactor,
                    `${tag} breakdown ${dim}`,
                  ),
                });
                if (!norm) continue;

                await this.prisma.breakdownStat.upsert({
                  where: {
                    entityType_entityId_date_breakdownKey_breakdownValue: {
                      entityType: EntityType.CAMPAIGN,
                      entityId: camp.id,
                      date: new Date(norm.date),
                      breakdownKey: norm.breakdownKey,
                      breakdownValue: norm.breakdownValue,
                    },
                  },
                  create: {
                    entityType: EntityType.CAMPAIGN,
                    entityId: camp.id,
                    date: new Date(norm.date),
                    breakdownKey: norm.breakdownKey,
                    breakdownValue: norm.breakdownValue,
                    spend: BigInt(norm.spendMinor),
                    impressions: BigInt(norm.impressions),
                    clicks: BigInt(norm.clicks),
                    messages: BigInt(norm.messages),
                  },
                  update: {
                    spend: BigInt(norm.spendMinor),
                    impressions: BigInt(norm.impressions),
                    clicks: BigInt(norm.clicks),
                    messages: BigInt(norm.messages),
                  },
                });
                localRows++;
              }
            } catch (err) {
              // Meta rejects some breakdown combinations at the platform layer
              // (most consistently: `platform_position` paired with the
              // messaging-action insight fields). When that happens the right
              // move is a one-line warning and skip — it is a permanent shape
              // mismatch, not a transient outage, so escalating it as an
              // error spams the log and obscures real issues.
              if (isInvalidBreakdownCombination(err)) {
                rejectedBreakdownDims.add(`${adAccountId}:${dim}`);
                console.warn(
                  `${tag} campaign=${camp.externalCampaignId} dim=${dim} skipped — ` +
                  `Meta rejects this breakdown combination (cached: no retry until next deploy)`,
                );
              } else {
                const msg = err instanceof MetaApiError
                  ? `Meta ${err.status}: ${err.message}`
                  : err instanceof Error ? err.message : String(err);
                console.error(`${tag} campaign=${camp.externalCampaignId} dim=${dim} FAILED — ${msg}`);
              }
              // Continue to next dimension; partial coverage > total abort.
            }

            if (d < DIMENSIONS.length - 1) await sleep(INTER_DIM_DELAY_MS);
          }
          return localRows;
        })
      );

      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]!;
        const camp = slice[j]!;
        if (r.status === 'fulfilled') {
          rowsUpserted += r.value;
          campaignsProcessed++;
        } else {
          const err = r.reason;
          const msg = err instanceof MetaApiError
            ? `Meta ${err.status}: ${err.message}`
            : err instanceof Error ? err.message : String(err);
          console.error(`${tag} campaign=${camp.externalCampaignId} breakdown sync FAILED — ${msg}`);
        }
      }

      if (i + CAMPAIGN_CONCURRENCY < campaigns.length) {
        await sleep(INTER_CHUNK_DELAY_MS);
      }
    }

    console.log(`${tag} done — ${campaignsProcessed}/${campaigns.length} campaigns, ${rowsUpserted} breakdown rows`);
    return { campaignsProcessed, rowsUpserted };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  INTRA-DAY VELOCITY — "today so far" from Meta's date_preset=today.
  //
  //  Meta evaluates this in the ad account's reporting timezone. The row is
  //  upserted into DailyStat with today's date so the dashboard can surface
  //  partial-day spend/impressions/messages without waiting for the full-day
  //  attribution window to close. Re-running is safe (upsert overwrites).
  //  This is cheap: 1 Meta call per account, no pagination expected.
  // ════════════════════════════════════════════════════════════════════════
  async syncToday(
    adAccountId: string,
  ): Promise<{ rowsUpserted: number }> {
    const acct = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    const tag = `[syncToday:${acct.externalAccountId}]`;
    const rows = await this.meta.getTodayInsights({
      externalId: acct.externalAccountId,
      level: 'account',
    });
    if (rows.length === 0) return { rowsUpserted: 0 };

    const dailyBatch = rows.map((r) => ({
      entityType: EntityType.ACCOUNT,
      entityId: adAccountId,
      insight: mapMetaInsight(r, {
        currencyMinorFactor: currencyFactorForMapper(
          acct.currency,
          acct.currencyMinorFactor,
          `${tag} today insights`,
        ),
      }),
    }));
    await this.dailyRepo.upsertMany(dailyBatch);
    await this.markSynced(adAccountId, new Date());
    console.log(`${tag} today velocity: ${dailyBatch.length} row(s) upserted`);
    return { rowsUpserted: dailyBatch.length };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CHUNKED SYNC — drives a SyncJob row over a configurable window.
  //
  //  Reads SyncJob.windowSince/until/windowDays from the DB (the route only
  //  persists intent — never passes args). Loops most-recent-first in
  //  7-day chunks; updates progress/chunksDone/cursorDate after each chunk.
  //
  //  Same idempotency guarantees as `sync()` — daily_stats upserts on the
  //  composite unique key, so partial completions converge on retry.
  // ════════════════════════════════════════════════════════════════════════
  async syncChunked(jobId: string): Promise<void> {
    const job = await this.prisma.syncJob.findUniqueOrThrow({ where: { id: jobId } });
    const adAccountId = job.adAccountId;
    const tag = `[syncChunked:${jobId.slice(0, 8)}]`;

    // Hold the lock on a dedicated connection. On contention, leave the job
    // PENDING (never FAILED) so BullMQ / reuse-active-job can retry cleanly.
    const locked = await withAdvisoryLock(adAccountId, () =>
      this.syncChunkedLocked(jobId, job),
    );
    if (!locked.acquired) {
      console.warn(`${tag} Advisory lock held — another sync running. Leaving PENDING for retry.`);
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: {
          status: SyncJobStatus.PENDING,
          error: 'Waiting — another sync is already in progress for this account',
        },
      });
      const err = new Error('SYNC_LOCK_HELD');
      (err as Error & { code?: string }).code = 'SYNC_LOCK_HELD';
      throw err;
    }
  }

  /** Inner chunked sync — caller must already hold the per-account advisory lock. */
  private async syncChunkedLocked(
    jobId: string,
    job: { adAccountId: string; windowSince: Date; windowUntil: Date },
  ): Promise<void> {
    const adAccountId = job.adAccountId;
    const tag = `[syncChunked:${jobId.slice(0, 8)}]`;

    let acct = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    if (currencyFactorNeedsHeal(acct.currency, acct.currencyMinorFactor)) {
      const healed = await healAccountCurrencyAndSpend(this.prisma, acct);
      acct = { ...acct, currencyMinorFactor: healed };
      console.log(
        `[currency-heal] syncChunked ${acct.externalAccountId} ${acct.currency} factor → ${healed}`,
      );
    }
    const since = job.windowSince;
    const until = job.windowUntil;

    // Build chunks: most-recent-first, CHUNK_SIZE_DAYS each, last chunk may be short.
    const chunks: Array<{ since: Date; until: Date }> = [];
    let cursor = new Date(until);
    while (cursor.getTime() >= since.getTime()) {
      const chunkUntil = new Date(cursor);
      const chunkSince = new Date(cursor.getTime() - (CHUNK_SIZE_DAYS - 1) * 86400 * 1000);
      const clampedSince = chunkSince.getTime() < since.getTime() ? new Date(since) : chunkSince;
      chunks.push({ since: clampedSince, until: chunkUntil });
      cursor = new Date(clampedSince.getTime() - 86400 * 1000);
    }

    await this.prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: SyncJobStatus.PROCESSING,
        startedAt: new Date(),
        chunksTotal: chunks.length,
      },
    });

    console.log(`${tag} START — ${chunks.length} chunks over ${ymd(since)} → ${ymd(until)}`);

    let totalFetched = 0;
    let totalUpserted = 0;
    const reconcileNow = new Date();

    // syncCampaigns internally calls reconcileCampaignStatuses — no need for
    // a separate early reconcile (was a duplicate Meta listCampaigns call).
    try {
      const campResult = await this.syncCampaigns(adAccountId, { since, until, now: reconcileNow });
      console.log(
        `${tag} campaigns (daily insights): ${campResult.campaignsUpserted} upserted, ` +
        `${campResult.dailyRowsUpserted} daily rows`,
      );
    } catch (e) {
      const msg = e instanceof MetaApiError
        ? `Meta ${e.status}: ${e.message}`
        : e instanceof Error ? e.message : String(e);
      console.error(`${tag} syncCampaigns daily insights FAILED (non-fatal) — ${msg}`);
    }

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        console.log(`${tag} chunk ${i + 1}/${chunks.length} — ${ymd(chunk.since)} → ${ymd(chunk.until)}`);

        const rows = await this.meta.getInsights({
          externalId: acct.externalAccountId,
          level: 'account',
          since: chunk.since,
          until: chunk.until,
        });
        totalFetched += rows.length;

        if (rows.length > 0) {
          const rawBatch = rows.map((r) => ({
            entityType: EntityType.ACCOUNT,
            entityId: adAccountId,
            date: new Date(String(r.date_start)),
            rawJson: r,
          }));
          await this.rawRepo.appendMany(rawBatch);

          const dailyBatch = rows.map((r) => ({
            entityType: EntityType.ACCOUNT,
            entityId: adAccountId,
            insight: mapMetaInsight(r, {
              currencyMinorFactor: currencyFactorForMapper(
                acct.currency,
                acct.currencyMinorFactor,
                `${tag} chunked account insights`,
              ),
            }),
          }));
          await this.dailyRepo.upsertMany(dailyBatch);
          totalUpserted += dailyBatch.length;
        }

        const chunksDone = i + 1;
        const progress = Math.round((chunksDone / chunks.length) * 100);
        await this.prisma.syncJob.update({
          where: { id: jobId },
          data: {
            chunksDone,
            progress,
            cursorDate: chunk.since,
            rowsFetched: totalFetched,
            rowsUpserted: totalUpserted,
          },
        });

        if (i < chunks.length - 1) await sleep(INTER_CHUNK_DELAY_MS);
      }

      // Phase 5 Pass A + B — discover ad-sets, ads, and dedupe creatives.
      // Non-fatal so an outage on this newer surface area cannot regress the
      // already-working account/campaign sync. Runs AFTER syncCampaigns so the
      // Campaign rows it walks are guaranteed to exist.
      try {
        const adsResult = await this.syncAdSetsAndAds(adAccountId, { since });
        console.log(
          `${tag} ads/creatives: ${adsResult.adSetsUpserted} ad-sets, ` +
          `${adsResult.adsUpserted} ads, ${adsResult.creativesUpserted} creatives`
        );
      } catch (e) {
        const msg = e instanceof MetaApiError
          ? `Meta ${e.status}: ${e.message}`
          : e instanceof Error ? e.message : String(e);
        console.error(`${tag} syncAdSetsAndAds FAILED (non-fatal) — ${msg}`);
      }

      // Pass D — ad-level daily stats (feeds T6 get_creative_performance).
      // Non-fatal; runs AFTER syncAdSetsAndAds so the Ad rows it needs for
      // ad_id → internal id mapping are guaranteed to exist.
      try {
        const adInsightsResult = await this.syncAdInsights(adAccountId, { since, until });
        console.log(
          `${tag} ad insights: ${adInsightsResult.campaignsProcessed} campaigns, ` +
          `${adInsightsResult.rowsUpserted} ad-level daily rows` +
          (adInsightsResult.unmatchedAdIds > 0 ? `, ${adInsightsResult.unmatchedAdIds} unmatched` : '')
        );
      } catch (e) {
        const msg = e instanceof MetaApiError
          ? `Meta ${e.status}: ${e.message}`
          : e instanceof Error ? e.message : String(e);
        console.error(`${tag} syncAdInsights FAILED (non-fatal) — ${msg}`);
      }

      // Phase 5 Pass C — campaign-level breakdowns (age/gender/platform/position).
      // Non-fatal: feeds the Audience tab but is not load-bearing for the
      // numbers shown elsewhere. Runs last so all required Campaign rows exist.
      try {
        const bdResult = await this.syncBreakdowns(adAccountId, { since, until });
        console.log(
          `${tag} breakdowns: ${bdResult.campaignsProcessed} campaigns, ` +
          `${bdResult.rowsUpserted} segment rows`
        );
      } catch (e) {
        const msg = e instanceof MetaApiError
          ? `Meta ${e.status}: ${e.message}`
          : e instanceof Error ? e.message : String(e);
        console.error(`${tag} syncBreakdowns FAILED (non-fatal) — ${msg}`);
      }

      await this.markSynced(adAccountId, new Date());
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: {
          status: SyncJobStatus.COMPLETED,
          progress: 100,
          completedAt: new Date(),
        },
      });
      console.log(`${tag} COMPLETE — ${totalUpserted} rows upserted across ${chunks.length} chunks`);
    } catch (e) {
      const error = e instanceof MetaApiError
        ? `Meta ${e.status}: ${e.message}`
        : e instanceof Error ? e.message : String(e);
      console.error(`${tag} FAILED — ${error}`);
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: {
          status: SyncJobStatus.FAILED,
          error,
          completedAt: new Date(),
        },
      });
    }
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
