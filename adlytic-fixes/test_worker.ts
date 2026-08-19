// Exercises:
//   1. The mapper translates real Meta JSON (with all the quirks: strings,
//      missing keys, actions arrays, zero-value omissions) correctly.
//   2. The worker is idempotent — running sync twice produces the same final
//      daily_stats state, not duplicates.
//   3. The cordon holds — the worker never writes to engine tables.
//   4. Backfill works — when Meta returns updated numbers for yesterday, the
//      daily_stats row is overwritten, not duplicated.
//
// No DB, no real Meta. Uses fakes/mocks to test logic directly.

import { mapMetaInsight } from "./src/mappers/insightMapper";
import type { MetaInsightRow } from "./src/services/metaClient";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  — got: ${JSON.stringify(got)}`); }
}

// ════════════════ MAPPER TESTS ════════════════
console.log("\n── Mapper: realistic Meta payloads ──");

// Fixture 1: a realistic Meta account-level row, exactly as the API returns it
// (numbers as strings, results inside actions[], some keys omitted)
const metaRow1: MetaInsightRow = {
  date_start: "2026-06-13",
  date_stop: "2026-06-13",
  spend: "15.47",           // strings — Meta does this
  impressions: "2974",
  reach: "1830",
  clicks: "87",
  ctr: "2.926",
  cpc: "0.1778",
  cpm: "5.2018",
  frequency: "1.625",
  actions: [
    { action_type: "link_click", value: "87" },
    { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "12" },
    { action_type: "page_engagement", value: "143" },
  ],
};

// USD account: minorFactor = 100 → spend 15.47 → 1547 cents
const out1 = mapMetaInsight(metaRow1, { currencyMinorFactor: 100 });
check("date passed through", out1.date === "2026-06-13", out1.date);
check("spend → 1547 minor units (USD cents)", out1.spendMinor === 1547, out1.spendMinor);
check("impressions parsed from string", out1.impressions === 2974, out1.impressions);
check("clicks parsed", out1.clicks === 87, out1.clicks);
check("messages extracted from actions[]", out1.messages === 12, out1.messages);
check("purchases zero when no matching action", out1.purchases === 0, out1.purchases);
check("conversions = messages + purchases + leads", out1.conversions === 12, out1.conversions);
check("ctr parsed to 2.926", out1.ctr === 2.926, out1.ctr);
check("frequency parsed", out1.frequency === 1.625, out1.frequency);
check("roas null when no revenue", out1.roas === null, out1.roas);

// Fixture 2: IQD account (minor factor 1), with missing keys
const metaRow2: MetaInsightRow = {
  date_start: "2026-06-12",
  spend: "13420",          // IQD, factor 1 → already minor
  impressions: "1500",
  // reach OMITTED — Meta drops zero/null fields
  // clicks OMITTED
  ctr: "0",
  // actions OMITTED entirely
};
const out2 = mapMetaInsight(metaRow2, { currencyMinorFactor: 1 });
check("IQD: spend 13420 stays 13420 (factor 1)", out2.spendMinor === 13420, out2.spendMinor);
check("missing reach → 0, not NaN", out2.reach === 0, out2.reach);
check("missing clicks → 0", out2.clicks === 0, out2.clicks);
check("missing actions → messages 0", out2.messages === 0, out2.messages);
check("ctr '0' string → 0 (not null)", out2.ctr === 0, out2.ctr);

// Fixture 3: malformed inputs — must not crash, must produce a sane row
const metaRow3: MetaInsightRow = {
  date_start: "2026-06-11",
  spend: "",                // empty string
  impressions: null as unknown as string,
  clicks: "abc",            // garbage
  ctr: undefined as unknown as string,
  actions: [
    { action_type: "purchase", value: "3" },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
  ],
  action_values: [
    { action_type: "purchase", value: "120.50" },
  ],
};
const out3 = mapMetaInsight(metaRow3, { currencyMinorFactor: 100 });
check("empty spend → 0", out3.spendMinor === 0, out3.spendMinor);
check("null impressions → 0", out3.impressions === 0, out3.impressions);
check("garbage clicks → 0", out3.clicks === 0, out3.clicks);
check("undefined ctr → null", out3.ctr === null, out3.ctr);
check("overlapping purchase types pick preferred (purchase=3, not sum 5)", out3.purchases === 3, out3.purchases);
check("conversions = purchases when no messages/leads", out3.conversions === 3, out3.conversions);

// Fixture 4: ROAS — revenue present, spend present
const metaRow4: MetaInsightRow = {
  date_start: "2026-06-10",
  spend: "10.00",
  impressions: "1000",
  actions: [{ action_type: "purchase", value: "2" }],
  action_values: [{ action_type: "purchase", value: "40.00" }],
};
const out4 = mapMetaInsight(metaRow4, { currencyMinorFactor: 100 });
check("ROAS computed: 40/10 = 4x", out4.roas === 4, out4.roas);
check("purchases 2", out4.purchases === 2, out4.purchases);

// Fixture 6: ROAS factor-invariance — ratio cancels currency scale (C-3 guard)
const metaRowRoas: MetaInsightRow = {
  date_start: "2026-06-09",
  spend: "100.00",
  impressions: "5000",
  actions: [{ action_type: "purchase", value: "1" }],
  action_values: [{ action_type: "purchase", value: "350.00" }],
};
const roasFactor1 = mapMetaInsight(metaRowRoas, { currencyMinorFactor: 1 });
const roasFactor100 = mapMetaInsight(metaRowRoas, { currencyMinorFactor: 100 });
check("ROAS identical under factor=1 and factor=100", roasFactor1.roas === roasFactor100.roas, { f1: roasFactor1.roas, f100: roasFactor100.roas });
check("ROAS factor-invariance value is 3.5x", roasFactor1.roas === 3.5, roasFactor1.roas);

// Meta purchase_roas path is also factor-invariant (never scaled)
const metaRowMetaRoas: MetaInsightRow = {
  date_start: "2026-06-08",
  spend: "50.00",
  impressions: "1000",
  purchase_roas: [{ action_type: "omni_purchase", value: "2.75" }],
  action_values: [{ action_type: "purchase", value: "999.00" }],
};
const metaRoas1 = mapMetaInsight(metaRowMetaRoas, { currencyMinorFactor: 1 });
const metaRoas100 = mapMetaInsight(metaRowMetaRoas, { currencyMinorFactor: 100 });
check("Meta purchase_roas identical under factor=1 and factor=100", metaRoas1.roas === metaRoas100.roas, { f1: metaRoas1.roas, f100: metaRoas100.roas });

// Fixture 5: missing date is an error (Meta would never do this, but verify)
let threw = false;
try { mapMetaInsight({ spend: "1.00" } as MetaInsightRow, { currencyMinorFactor: 100 }); }
catch { threw = true; }
check("missing date_start throws", threw);

// ════════════════ WORKER ORCHESTRATION TESTS ════════════════
// Mock the four moving parts: PrismaClient delegates, MetaClient, the two repos.
// We assert the worker calls them in the right order, with the right data,
// and NEVER touches engine tables.

console.log("\n── Worker: orchestration + cordon ──");

interface Call { table: string; op: string; key?: unknown; data?: unknown }
const calls: Call[] = [];

class MockMetaClient {
  rows: MetaInsightRow[] = [];
  async getInsights() { return this.rows; }
}

// In-memory store keyed like the daily_stats unique index would key it.
const dailyStore = new Map<string, any>();

const mockPrisma: any = {
  adAccount: {
    findUniqueOrThrow: async ({ where }: any) => ({
      id: where.id,
      externalAccountId: "act_furniture_test",
      currency: "IQD",
      currencyMinorFactor: 1, // IQD
      lastSyncedAt: null,
    }),
    update: async ({ where, data }: any) => {
      calls.push({ table: "ad_accounts", op: "update", key: where, data });
      return { id: where.id };
    },
  },
  rawInsight: {
    create: async ({ data }: any) => { calls.push({ table: "raw_insights", op: "create", data }); return data; },
    createMany: async ({ data }: any) => { for (const d of data) calls.push({ table: "raw_insights", op: "create", data: d }); return { count: data.length }; },
  },
  dailyStat: {
    upsert: async ({ where, create, update }: any) => {
      const k = JSON.stringify(where);
      calls.push({ table: "daily_stats", op: "upsert", key: where, data: create });
      if (dailyStore.has(k)) {
        const existing = dailyStore.get(k);
        dailyStore.set(k, { ...existing, ...update });
      } else {
        dailyStore.set(k, { ...create });
      }
      return dailyStore.get(k);
    },
  },
  $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
  $queryRawUnsafe: async (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) return [{ pg_try_advisory_lock: true }];
    if (sql.includes("pg_advisory_unlock")) return [];
    return [];
  },
  $executeRawUnsafe: async () => undefined,
  // Engine tables — if the worker ever touches these, the test must fail loudly
  metricTrend: { create: () => { throw new Error("VIOLATION: worker wrote to metric_trends"); } },
  detectedIssue: { create: () => { throw new Error("VIOLATION: worker wrote to detected_issues"); } },
  recommendation: { create: () => { throw new Error("VIOLATION: worker wrote to recommendations"); } },
  healthScore:   { create: () => { throw new Error("VIOLATION: worker wrote to health_scores"); } },
  knowledgeRule: { create: () => { throw new Error("VIOLATION: worker wrote to knowledge_rules"); } },
};

// Late import so we get the real worker, then inject the mocks
import { SyncAccountWorker } from "./src/workers/syncAccount";

async function main() {

const meta = new MockMetaClient();
const worker = new SyncAccountWorker(mockPrisma, meta as any);

// First sync: 3 days of data
meta.rows = [
  { date_start: "2026-06-12", spend: "13000", impressions: "2500", clicks: "60", ctr: "2.4",
    actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "5" }] },
  { date_start: "2026-06-13", spend: "14000", impressions: "2700", clicks: "70", ctr: "2.6",
    actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "7" }] },
  { date_start: "2026-06-14", spend: "15000", impressions: "2900", clicks: "75", ctr: "2.6",
    actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "8" }] },
];
const r1 = await worker.sync("acc_furn", { now: new Date("2026-06-14T12:00:00Z") });
check("first sync ok", r1.ok === true, r1);
check("fetched 3 rows", r1.rowsFetched === 3, r1.rowsFetched);
check("upserted 3 rows", r1.rowsUpserted === 3, r1.rowsUpserted);
check("daily_stats has 3 rows after first sync", dailyStore.size === 3, dailyStore.size);

// Verify ordering: raw_insights writes BEFORE daily_stats writes
const rawIdx = calls.findIndex(c => c.table === "raw_insights");
const dailyIdx = calls.findIndex(c => c.table === "daily_stats");
check("raw_insights written before daily_stats", rawIdx < dailyIdx && rawIdx >= 0, { rawIdx, dailyIdx });

// Verify the cordon — only these three tables touched
const tablesTouched = new Set(calls.map(c => c.table));
check("only raw_insights, daily_stats, ad_accounts touched",
  tablesTouched.size === 3 &&
  tablesTouched.has("raw_insights") &&
  tablesTouched.has("daily_stats") &&
  tablesTouched.has("ad_accounts"),
  [...tablesTouched]);
check("did NOT touch metric_trends", !tablesTouched.has("metric_trends"));
check("did NOT touch detected_issues", !tablesTouched.has("detected_issues"));
check("did NOT touch recommendations", !tablesTouched.has("recommendations"));
check("did NOT touch health_scores", !tablesTouched.has("health_scores"));

// Verify the mapper actually ran (spend went into daily_stats as BigInt minor units)
const firstDailyCreate = calls.find(c => c.table === "daily_stats");
const spendVal = (firstDailyCreate?.data as any)?.spend;
check("daily_stats spend is a BigInt", typeof spendVal === "bigint", typeof spendVal);
check("daily_stats spend 13000n for IQD factor-1", spendVal === 13000n, spendVal);

// ════════════════ IDEMPOTENCY TEST ════════════════
console.log("\n── Worker: idempotency on rerun ──");
const sizeBeforeRerun = dailyStore.size;
const r2 = await worker.sync("acc_furn", { now: new Date("2026-06-14T13:00:00Z") });
check("rerun ok", r2.ok === true);
check("daily_stats size unchanged after rerun", dailyStore.size === sizeBeforeRerun,
  { before: sizeBeforeRerun, after: dailyStore.size });

// ════════════════ BACKFILL TEST ════════════════
console.log("\n── Worker: Meta attribution backfill ──");
// Same days, but Meta now reports MORE messages for 06-13 (attribution caught up)
meta.rows = [
  { date_start: "2026-06-12", spend: "13000", impressions: "2500", clicks: "60", ctr: "2.4",
    actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "5" }] },
  { date_start: "2026-06-13", spend: "14000", impressions: "2700", clicks: "70", ctr: "2.6",
    actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "12" }] }, // was 7, now 12
  { date_start: "2026-06-14", spend: "15000", impressions: "2900", clicks: "75", ctr: "2.6",
    actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "8" }] },
];
await worker.sync("acc_furn", { now: new Date("2026-06-14T14:00:00Z") });
check("still 3 daily_stats rows after backfill (no duplicates)", dailyStore.size === 3, dailyStore.size);

// Pull the 06-13 row and confirm messages updated to 12
const updatedKey = [...dailyStore.keys()].find(k => k.includes("2026-06-13"));
const updatedRow = updatedKey ? dailyStore.get(updatedKey) : null;
check("06-13 messages updated to 12n via upsert (backfill works)",
  updatedRow?.messages === 12n, updatedRow?.messages);

// ════════════════ ERROR HANDLING ════════════════
console.log("\n── Worker: error handling ──");
meta.rows = [];
// Simulate Meta failure
(meta as any).getInsights = async () => { throw new Error("Meta 500: server gone"); };
const r3 = await worker.sync("acc_furn", { now: new Date() });
check("sync returns ok=false on Meta failure (does not throw)", r3.ok === false, r3.ok);
check("error message preserved", r3.error?.includes("Meta 500") === true, r3.error);

// ════════════════ RECONCILE: vanished-campaign archiving ════════════════
// syncCampaigns() must down-convert campaigns Meta no longer lists (archived/
// deleted on Meta) from ACTIVE/PAUSED → ARCHIVED, so a stale-ACTIVE row can't
// inflate the dashboard's "Active" count. AND it must NEVER mass-archive when
// Meta returns a transient empty list. These two cases are the whole contract
// of the fix, so we test them directly against the real syncCampaigns.
console.log("\n── Worker: reconcile vanished campaigns ──");

// Minimal in-memory Campaign delegate — implements only the ops syncCampaigns
// touches: findMany, upsert (on the composite key), updateMany (the reconcile).
function makeCampaignStore(seed: any[]) {
  const store = seed.map((c) => ({ ...c }));
  return {
    store,
    delegate: {
      findMany: async ({ where }: any) =>
        store
          .filter((c) => c.adAccountId === where.adAccountId)
          .map((c) => ({ ...c })),
      upsert: async ({ where, create, update }: any) => {
        const { adAccountId: acc, externalCampaignId: ext } =
          where.adAccountId_externalCampaignId;
        const existing = store.find(
          (c) => c.adAccountId === acc && c.externalCampaignId === ext,
        );
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const row = { id: "camp_" + ext, adAccountId: acc, externalCampaignId: ext, ...create };
        store.push(row);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const notIn: string[] = where.externalCampaignId?.notIn ?? [];
        const inStatuses: string[] | null = where.status?.in ?? null;
        let count = 0;
        for (const c of store) {
          if (c.adAccountId !== where.adAccountId) continue;
          if (notIn.includes(c.externalCampaignId)) continue;
          if (inStatuses && !inStatuses.includes(c.status)) continue;
          c.status = data.status;
          count++;
        }
        return { count };
      },
    },
  };
}

// A Meta client stub exposing exactly the two methods syncCampaigns calls.
// listCampaigns drives the "what Meta still returns" set; getInsights returns
// [] so the test stays on the reconcile path (no daily-stat/freeze machinery).
function makeReconcileMeta(listed: any[]) {
  return {
    listCampaigns: async () => listed,
    getInsights: async () => [],
  };
}

function makeReconcilePrisma(campaignDelegate: any) {
  return {
    adAccount: {
      findUniqueOrThrow: async ({ where }: any) => ({
        id: where.id,
        externalAccountId: "act_reconcile_test",
        currency: "IQD",
        currencyMinorFactor: 1,
      }),
    },
    campaign: campaignDelegate,
    dailyStat: { upsert: async () => ({}) },
    // syncCampaigns prepares ops then awaits them; our delegate ops already
    // execute on call, so Promise.all just settles them — same net effect.
    $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
  };
}

const WINDOW = { since: new Date("2026-06-01"), until: new Date("2026-06-14") };

// ── Case A: a vanished ACTIVE campaign gets archived, the listed one survives.
{
  const cs = makeCampaignStore([
    { id: "camp_A", adAccountId: "acc_rec", externalCampaignId: "A", name: "Alpha", status: "ACTIVE", objective: null, dailyBudget: null, lifetimeBudget: null },
    { id: "camp_B", adAccountId: "acc_rec", externalCampaignId: "B", name: "Bravo", status: "ACTIVE", objective: null, dailyBudget: null, lifetimeBudget: null },
  ]);
  // Meta now only returns A (still ACTIVE). B vanished from the listing.
  const metaStub = makeReconcileMeta([{ id: "A", name: "Alpha", status: "ACTIVE", objective: null }]);
  const w = new SyncAccountWorker(makeReconcilePrisma(cs.delegate) as any, metaStub as any);
  await w.syncCampaigns("acc_rec", WINDOW);

  const a = cs.store.find((c) => c.externalCampaignId === "A");
  const b = cs.store.find((c) => c.externalCampaignId === "B");
  check("listed campaign A stays ACTIVE", a?.status === "ACTIVE", a?.status);
  check("vanished campaign B reconciled to ARCHIVED", b?.status === "ARCHIVED", b?.status);
}

// ── Case B: transient EMPTY list must NOT archive anything (the safety guard).
{
  const cs = makeCampaignStore([
    { id: "camp_A", adAccountId: "acc_rec", externalCampaignId: "A", name: "Alpha", status: "ACTIVE", objective: null, dailyBudget: null, lifetimeBudget: null },
    { id: "camp_B", adAccountId: "acc_rec", externalCampaignId: "B", name: "Bravo", status: "PAUSED", objective: null, dailyBudget: null, lifetimeBudget: null },
  ]);
  const metaStub = makeReconcileMeta([]); // Meta returns nothing this run.
  const w = new SyncAccountWorker(makeReconcilePrisma(cs.delegate) as any, metaStub as any);
  await w.syncCampaigns("acc_rec", WINDOW);

  const a = cs.store.find((c) => c.externalCampaignId === "A");
  const b = cs.store.find((c) => c.externalCampaignId === "B");
  check("empty list leaves ACTIVE campaign untouched (no mass-archive)", a?.status === "ACTIVE", a?.status);
  check("empty list leaves PAUSED campaign untouched", b?.status === "PAUSED", b?.status);
}

// ── Case C: a PAUSED campaign that vanishes is also archived (covers both
// reconciled source states, since the guard's `in` set is [ACTIVE, PAUSED]).
{
  const cs = makeCampaignStore([
    { id: "camp_A", adAccountId: "acc_rec", externalCampaignId: "A", name: "Alpha", status: "ACTIVE", objective: null, dailyBudget: null, lifetimeBudget: null },
    { id: "camp_C", adAccountId: "acc_rec", externalCampaignId: "C", name: "Charlie", status: "PAUSED", objective: null, dailyBudget: null, lifetimeBudget: null },
  ]);
  const metaStub = makeReconcileMeta([{ id: "A", name: "Alpha", status: "ACTIVE", objective: null }]);
  const w = new SyncAccountWorker(makeReconcilePrisma(cs.delegate) as any, metaStub as any);
  await w.syncCampaigns("acc_rec", WINDOW);

  const c = cs.store.find((x) => x.externalCampaignId === "C");
  check("vanished PAUSED campaign C reconciled to ARCHIVED", c?.status === "ARCHIVED", c?.status);
}

// ── Case D: configured ACTIVE but effective_status PAUSED → PAUSED in DB.
{
  const cs = makeCampaignStore([
    { id: "camp_A", adAccountId: "acc_rec", externalCampaignId: "A", name: "Alpha", status: "ACTIVE", objective: null, dailyBudget: null, lifetimeBudget: null },
  ]);
  const metaStub = makeReconcileMeta([
    { id: "A", name: "Alpha", status: "ACTIVE", effective_status: "PAUSED", objective: null },
  ]);
  const w = new SyncAccountWorker(makeReconcilePrisma(cs.delegate) as any, metaStub as any);
  await w.syncCampaigns("acc_rec", WINDOW);

  const a = cs.store.find((c) => c.externalCampaignId === "A");
  check("effective_status PAUSED downgrades configured ACTIVE → PAUSED", a?.status === "PAUSED", a?.status);
}

// ── Case E: past stop_time downgrades ACTIVE → PAUSED.
{
  const cs = makeCampaignStore([
    { id: "camp_A", adAccountId: "acc_rec", externalCampaignId: "A", name: "Alpha", status: "ACTIVE", objective: null, dailyBudget: null, lifetimeBudget: null },
  ]);
  const metaStub = makeReconcileMeta([
    {
      id: "A",
      name: "Alpha",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      stop_time: "2020-01-01T00:00:00+0000",
      objective: null,
    },
  ]);
  const w = new SyncAccountWorker(makeReconcilePrisma(cs.delegate) as any, metaStub as any);
  await w.syncCampaigns("acc_rec", WINDOW);

  const a = cs.store.find((c) => c.externalCampaignId === "A");
  check("past stop_time downgrades ACTIVE → PAUSED", a?.status === "PAUSED", a?.status);
}

// ── Case F: reconcileCampaignStatuses directly (not via syncCampaigns).
{
  const cs = makeCampaignStore([
    { id: 'camp_A', adAccountId: 'acc_rec', externalCampaignId: 'A', name: 'Alpha', status: 'ACTIVE', objective: null, dailyBudget: null, lifetimeBudget: null },
  ]);
  const metaStub = makeReconcileMeta([{ id: 'A', name: 'Alpha', status: 'ACTIVE', objective: null }]);
  const w = new SyncAccountWorker(makeReconcilePrisma(cs.delegate) as any, metaStub as any);
  const r = await w.reconcileCampaignStatuses('acc_rec', { now: new Date('2026-06-14T12:00:00Z') });
  check('reconcileCampaignStatuses returns upsert count', r.campaignsUpserted === 1, r);
  check('reconcileCampaignStatuses leaves listed campaign ACTIVE',
    cs.store.find((c) => c.externalCampaignId === 'A')?.status === 'ACTIVE');
}

// ── Case G: reconcileCampaignStatuses surfaces Meta API failures (does not swallow).
{
  const cs = makeCampaignStore([]);
  const metaStub = {
    listCampaigns: async () => { throw new Error('Meta 403: (#200) Permissions error'); },
    getInsights: async () => [],
  };
  const w = new SyncAccountWorker(makeReconcilePrisma(cs.delegate) as any, metaStub as any);
  let reconcileThrew = false;
  try {
    await w.reconcileCampaignStatuses('acc_rec');
  } catch (e) {
    reconcileThrew = true;
    check('reconcileCampaignStatuses throws on Meta failure',
      e instanceof Error && e.message.includes('Meta 403'), e);
  }
  check('reconcileCampaignStatuses did not swallow Meta error', reconcileThrew);
}

// ── Case H: sync() invokes reconcile (campaign delegate touched).
{
  const reconcileCalls: string[] = [];
  const campaignDelegate = {
    findMany: async () => [],
    upsert: async () => ({}),
    updateMany: async () => ({ count: 0 }),
  };
  const syncPrisma: any = {
    ...mockPrisma,
    campaign: {
      findMany: async (...args: any[]) => {
        reconcileCalls.push('findMany');
        return campaignDelegate.findMany(...args);
      },
      upsert: async (...args: any[]) => campaignDelegate.upsert(...args),
      updateMany: async (...args: any[]) => campaignDelegate.updateMany(...args),
    },
  };
  const metaWithCampaigns = new MockMetaClient();
  metaWithCampaigns.rows = [
    { date_start: '2026-06-14', spend: '1000', impressions: '100', clicks: '5', ctr: '5.0',
      actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '1' }] },
  ];
  (metaWithCampaigns as any).listCampaigns = async () => [];
  const syncWorker = new SyncAccountWorker(syncPrisma, metaWithCampaigns as any);
  await syncWorker.sync('acc_furn', { now: new Date('2026-06-14T12:00:00Z') });
  check('sync() calls reconcileCampaignStatuses (campaign findMany)', reconcileCalls.includes('findMany'), reconcileCalls);
}

// ════════════════
console.log(`\n════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);

} // end main

main().catch(e => { console.error(e); process.exit(1); });
