-- When the current due date was set. Time spent waiting on others is given
-- back to the assignee only from this moment: a date agreed after a wait
-- already allows for it, so that wait is not added on top again.
alter table tasks add column wait_clock_from text;
