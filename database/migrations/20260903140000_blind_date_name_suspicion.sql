-- migrate:up

-- A suspected name leak, waiting for a human.
--
-- **The guard no longer acts on its own.** It used to end the Blind-Date, exclude the author and
-- send a mail the moment a name matched. With whole-word matching from three characters up, a
-- username that is an ordinary German word — „Rose", „Wolke", „Sturm" — makes a false positive a
-- real possibility, and the cost of one was two people losing their Blind-Date over a harmless
-- sentence. So the match now only *reports*, and every consequence waits for moderation.
--
-- The row links an ordinary report to the Blind-Date context the confirmation needs. It is
-- deliberately not a new report category: the queue already knows how to show a report, and what
-- is special here is what happens after it is judged, not how it is read.
CREATE TABLE public.blind_date_name_suspicion
(
    id              UUID PRIMARY KEY     DEFAULT uuidv7(),
    -- One report per suspicion. CASCADE, because a suspicion with no report is nothing anybody
    -- could act on.
    report_id       UUID        NOT NULL UNIQUE REFERENCES public.report (id) ON UPDATE CASCADE ON DELETE CASCADE,
    pair_id         UUID        NOT NULL REFERENCES public.blind_date_pair (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- The post the name was found in. SET NULL rather than CASCADE: a deleted post must not take
    -- the record of the suspicion with it, the same rule the report's own references follow.
    writing_post_id UUID        REFERENCES public.writing_post (id) ON UPDATE CASCADE ON DELETE SET NULL,
    -- Who wrote it. The consequences land on them, and only after a human says so.
    suspected_id    UUID        NOT NULL REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Null while it is still open. The two ways it ends are confirmed and dismissed, and nothing
    -- happens to anybody until one of them is set.
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    confirmed       BOOLEAN,

    CONSTRAINT blind_date_name_suspicion_resolution_is_complete CHECK (
        (resolved_at IS NULL) = (confirmed IS NULL)
        )
);

-- The two questions asked of this table: what is open, and is this post under review.
CREATE INDEX blind_date_name_suspicion_open_idx
    ON public.blind_date_name_suspicion (created_at)
    WHERE resolved_at IS NULL;

CREATE INDEX blind_date_name_suspicion_post_idx
    ON public.blind_date_name_suspicion (writing_post_id)
    WHERE resolved_at IS NULL;

-- One open suspicion per post: the guard runs on every post written, and a second row for the
-- same one would put the same sentence in the queue twice.
CREATE UNIQUE INDEX blind_date_name_suspicion_one_open_per_post_idx
    ON public.blind_date_name_suspicion (writing_post_id)
    WHERE resolved_at IS NULL AND writing_post_id IS NOT NULL;

-- migrate:down

DROP TABLE public.blind_date_name_suspicion;
