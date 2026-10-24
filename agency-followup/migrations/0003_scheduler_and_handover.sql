-- The cron runs every minute, so its own queries must use indexes: the
-- open-task scan and the cleanup of old scheduler runs.
create index if not exists scheduler_runs_started_idx on scheduler_runs (started_at);
create index if not exists tasks_open_idx on tasks (status) where archived_at is null;

-- When the current reviewer took over a submitted task, and when a blocker
-- reached its current resolver. Waiting time for reminders is measured from
-- these, so nobody is chased for the time before it reached him.
alter table tasks add column reviewer_since text;
alter table blockers add column resolver_since text;
