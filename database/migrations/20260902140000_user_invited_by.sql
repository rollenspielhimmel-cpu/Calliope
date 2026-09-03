-- migrate:up

-- Who brought this member in, when they registered through somebody's invitation link. The
-- group-level twin is user_in_writing_group.invited_by, which this deliberately mirrors: that
-- one records who asked somebody into a group, this one who asked them onto the platform.
--
-- Nullable and staying that way: almost everybody arrives on their own, and an invitation that
-- cannot be attributed is not an error.
ALTER TABLE public.user
    -- ON DELETE SET NULL rather than CASCADE, for the obvious reason: the inviter leaving must
    -- not take the accounts they brought with them.
    ADD COLUMN invited_by UUID REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Partial: null on all but the accounts that actually came through a link. The query this
-- serves counts arrivals per inviter, so it reads by this column.
CREATE INDEX user_invited_by_idx ON public.user (invited_by) WHERE invited_by IS NOT NULL;

-- migrate:down

DROP INDEX public.user_invited_by_idx;

ALTER TABLE public.user
    DROP COLUMN invited_by;
