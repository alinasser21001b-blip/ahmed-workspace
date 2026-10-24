-- متابعة الوكالة: initial schema.
-- Better Auth tables are generated from better-auth@1.7.12 (scripts/gen-auth-schema.mjs).
-- Every timestamp is stored as an ISO-8601 UTC string.

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "username" text unique, "displayUsername" text);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- Team members. Role and rank live here, never in the auth tables, so no auth
-- endpoint can change them.
create table members (
  user_id text primary key references "user" ("id"),
  username text not null unique,
  display_name text not null,
  role text not null check (role in ('owner', 'exec', 'account_manager', 'photographer')),
  rank integer not null,
  title text not null,
  must_change_password integer not null default 0,
  active integer not null default 1,
  created_at text not null
);

create table clients (
  id text primary key,
  name text not null,
  account_manager_id text not null references members (user_id),
  supervisor_id text references members (user_id),
  created_at text not null
);

-- Which non-owner members see a client's work. 'manage' runs the account,
-- 'oversee' follows it from above. The photographer has no client scope: he
-- sees only tasks he is part of.
create table client_scopes (
  client_id text not null references clients (id),
  user_id text not null references members (user_id),
  level text not null check (level in ('manage', 'oversee')),
  primary key (client_id, user_id)
);

create table tasks (
  id text primary key,
  client_id text not null references clients (id),
  parent_id text references tasks (id),
  template text,
  title text not null,
  description text not null default '',
  acceptance text not null default '',
  requester_id text not null references members (user_id),
  assignee_id text not null references members (user_id),
  reviewer_id text not null references members (user_id),
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  status text not null default 'new' check (status in ('new', 'acknowledged', 'in_progress', 'in_review', 'changes_requested', 'done', 'cancelled')),
  due_at text,
  client_due_at text,
  original_due_at text,
  ref_url text,
  requires_publish integer not null default 0,
  publish_url text,
  next_step text not null default '',
  is_demo integer not null default 0,
  archived_at text,
  cycle integer not null default 1,
  cycle_started_at text not null,
  ack_epoch integer not null default 0,
  ack_clock_from text not null,
  due_version integer not null default 1,
  review_round integer not null default 0,
  version integer not null default 1,
  create_key text,
  created_at text not null,
  updated_at text not null,
  acknowledged_at text,
  started_at text,
  submitted_at text,
  completed_at text,
  cancelled_at text,
  cancel_reason text,
  unique (requester_id, create_key)
);
create index tasks_client_idx on tasks (client_id, status);
create index tasks_assignee_idx on tasks (assignee_id, status);
create index tasks_reviewer_idx on tasks (reviewer_id, status);
create index tasks_requester_idx on tasks (requester_id);
create index tasks_parent_idx on tasks (parent_id);

-- Explicit single-task access, recorded when the owner assigns someone
-- outside the client's team.
create table task_grants (
  task_id text not null references tasks (id),
  user_id text not null references members (user_id),
  granted_by text not null references members (user_id),
  reason text not null,
  created_at text not null,
  primary key (task_id, user_id)
);
create index task_grants_user_idx on task_grants (user_id);

create table comments (
  id text primary key,
  task_id text not null references tasks (id),
  author_id text not null references members (user_id),
  kind text not null check (kind in ('comment', 'clarification_request', 'clarification_answer', 'changes_requested', 'review_note')),
  body text not null,
  client_key text,
  created_at text not null,
  unique (task_id, author_id, client_key)
);
create index comments_task_idx on comments (task_id, created_at);

create table deliverables (
  id text primary key,
  task_id text not null references tasks (id),
  url text,
  evidence text,
  version_label text,
  review_round integer not null,
  submitted_by text not null references members (user_id),
  created_at text not null
);
create index deliverables_task_idx on deliverables (task_id);

create table blockers (
  id text primary key,
  task_id text not null references tasks (id),
  kind text not null check (kind in ('internal', 'client_wait', 'clarification')),
  reason text not null,
  resolver_id text not null references members (user_id),
  opened_by text not null references members (user_id),
  opened_at text not null,
  expected_at text,
  resolved_at text,
  resolved_by text references members (user_id),
  resolution text
);
create index blockers_task_idx on blockers (task_id, resolved_at);
create index blockers_resolver_idx on blockers (resolver_id, resolved_at);

create table due_proposals (
  id text primary key,
  task_id text not null references tasks (id),
  proposed_by text not null references members (user_id),
  proposed_due_at text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by text references members (user_id),
  decided_at text,
  decision_note text,
  created_at text not null
);
create index due_proposals_task_idx on due_proposals (task_id, status);

-- Append-only audit log. The triggers make that a database rule, not a UI rule.
create table events (
  id integer primary key autoincrement,
  task_id text,
  actor_id text,
  type text not null,
  data text not null default '{}',
  created_at text not null
);
create index events_task_idx on events (task_id, id);
create index events_type_idx on events (type, created_at);
create trigger events_no_update before update on events begin select raise(abort, 'events are append-only'); end;
create trigger events_no_delete before delete on events begin select raise(abort, 'events are append-only'); end;

create table bookings (
  id text primary key,
  client_id text not null references clients (id),
  task_id text references tasks (id),
  resource_id text not null references members (user_id),
  title text not null,
  starts_at text not null,
  ends_at text not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by text not null references members (user_id),
  create_key text,
  created_at text not null,
  cancelled_at text,
  cancel_reason text,
  unique (created_by, create_key)
);
create index bookings_resource_idx on bookings (resource_id, status, starts_at);

create table notifications (
  id text primary key,
  user_id text not null references members (user_id),
  task_id text,
  kind text not null,
  title text not null,
  body text not null,
  url text,
  task_cycle integer,
  ref_id text,
  deliver_at text not null,
  created_at text not null,
  read_at text,
  cancelled_at text,
  dedupe_key text not null unique
);
create index notifications_user_idx on notifications (user_id, deliver_at);

create table push_subscriptions (
  id text primary key,
  user_id text not null references members (user_id),
  session_id text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at text not null,
  last_success_at text,
  last_error text,
  failures integer not null default 0,
  revoked_at text
);
create index push_subscriptions_user_idx on push_subscriptions (user_id, revoked_at);

create table outbox (
  id text primary key,
  notification_id text not null unique references notifications (id),
  user_id text not null references members (user_id),
  task_id text,
  task_cycle integer,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at text not null,
  last_error text,
  created_at text not null,
  sent_at text
);
create index outbox_due_idx on outbox (status, next_attempt_at);

create table settings (
  key text primary key,
  value text not null,
  updated_at text not null,
  updated_by text
);

create table scheduler_runs (
  id integer primary key autoincrement,
  started_at text not null,
  finished_at text,
  ok integer not null default 0,
  summary text,
  error text
);

create table setup_tokens (
  id text primary key,
  user_id text not null references members (user_id),
  token_hash text not null unique,
  expires_at text not null,
  used_at text,
  revoked_at text,
  created_by text,
  created_at text not null
);

-- First statement of every multi-statement write: the row cannot be inserted
-- unless its condition holds (the task version still matches, or a slot is
-- still free), which aborts and rolls back the whole batch. The last
-- statement of the batch deletes it again.
create table op_guard (
  id text primary key,
  ok integer not null,
  constraint op_guard_conflict check (ok = 1)
);

create table request_limits (
  key text primary key,
  count integer not null,
  window_start text not null
);

-- Seed: the four team members and the two clients. Emails are internal
-- identities on the reserved .invalid domain; no mail is ever sent to them.
insert into "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt", "username", "displayUsername") values
  ('u_mohammed', 'محمد', 'mohammed@team.agency-followup.invalid', 0, null, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z', 'mohammed', 'mohammed'),
  ('u_ammar', 'عمار', 'ammar@team.agency-followup.invalid', 0, null, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z', 'ammar', 'ammar'),
  ('u_sama', 'سما', 'sama@team.agency-followup.invalid', 0, null, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z', 'sama', 'sama'),
  ('u_hussein', 'حسين', 'hussein@team.agency-followup.invalid', 0, null, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z', 'hussein', 'hussein');

insert into members (user_id, username, display_name, role, rank, title, must_change_password, active, created_at) values
  ('u_mohammed', 'mohammed', 'محمد', 'owner', 3, 'مدير الوكالة', 0, 1, '2026-10-24T00:00:00.000Z'),
  ('u_ammar', 'ammar', 'عمار', 'exec', 2, 'المدير التنفيذي ومسؤول إعلام مستشفى ورد', 0, 1, '2026-10-24T00:00:00.000Z'),
  ('u_sama', 'sama', 'سما', 'account_manager', 1, 'مسؤولة إعلام عيادة بغداد للسمنة', 0, 1, '2026-10-24T00:00:00.000Z'),
  ('u_hussein', 'hussein', 'حسين', 'photographer', 0, 'المصور', 0, 1, '2026-10-24T00:00:00.000Z');

insert into clients (id, name, account_manager_id, supervisor_id, created_at) values
  ('c_obesity', 'عيادة بغداد للسمنة', 'u_sama', 'u_ammar', '2026-10-24T00:00:00.000Z'),
  ('c_ward', 'مستشفى ورد', 'u_ammar', null, '2026-10-24T00:00:00.000Z');

insert into client_scopes (client_id, user_id, level) values
  ('c_obesity', 'u_sama', 'manage'),
  ('c_obesity', 'u_ammar', 'oversee'),
  ('c_ward', 'u_ammar', 'manage');

-- Declared starting assumptions. Mohammed edits them; the UI labels them as assumptions.
insert into settings (key, value, updated_at, updated_by) values
  ('work_hours', '{"tz":"Asia/Baghdad","days":[0,1,2,3,4],"start":"09:00","end":"18:00","assumed":true}', '2026-10-24T00:00:00.000Z', null),
  ('rules', '{"ack":{"normal":[60,120,240,480],"urgent":[15,30,60,120]},"dueSoonMinutes":{"normal":60,"urgent":30},"blockerFollowMinutes":{"normal":120,"urgent":60},"reviewMinutes":{"normal":[120,240],"urgent":[30,60]},"urgentOutsideHours":false,"demoReminders":false}', '2026-10-24T00:00:00.000Z', null),
  ('demo_seed', 'pending', '2026-10-24T00:00:00.000Z', null);
