-- migrate:up

-- Its own migration, and it does nothing else: a new enum value cannot be *used* in the same
-- transaction that adds it, and the CHECK constraint in the next migration names it. Splitting
-- the two is what makes both run.
-- IF NOT EXISTS because the down migration below cannot take the value away again: without it,
-- re-applying after a rollback fails on a value that is still there.
ALTER TYPE public.report_target_type ADD VALUE IF NOT EXISTS 'forum_post';

-- migrate:down

-- Postgres cannot remove an enum value. Rolling this back would mean rebuilding the type and
-- every column that uses it, which is a great deal of machinery for a value that costs nothing
-- while unused — so the down migration deliberately does nothing and says why.
SELECT 1;
