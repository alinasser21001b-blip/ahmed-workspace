-- Indexes for lookups on every task write: cancelling a task's pending
-- notifications, and a task's bookings on its detail page.
create index if not exists notifications_task_idx on notifications (task_id, kind);
create index if not exists bookings_task_idx on bookings (task_id, status);
create index if not exists push_subscriptions_session_idx on push_subscriptions (session_id);
