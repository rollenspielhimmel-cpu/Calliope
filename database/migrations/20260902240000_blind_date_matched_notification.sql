-- migrate:up

-- Being matched is the moment Blind-Date turns from a form somebody filled in into something that
-- is happening. In the old system it was a written message with its own template („Date
-- arrangiert"), and it mattered to people — so it is a notification here rather than a group that
-- quietly appears in a list.
--
-- Its own migration and nothing else in it: a new enum value cannot be *used* in the transaction
-- that adds it, and the insert that names it runs in application code the moment this is deployed.
-- The same split `20260902190000` documents for `report_target_type`.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'blind_date_matched';

-- migrate:down

-- Postgres cannot remove an enum value; rebuilding the type and every column that uses it is a
-- great deal of machinery for a value that costs nothing while unused. The down migration
-- deliberately does nothing and says why — as `20260902190000` does.
SELECT 1;
