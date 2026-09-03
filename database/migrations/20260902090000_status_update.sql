-- migrate:up

-- A short remark on the logged-in home page, the way Yooco's LiNet status did. Its own table
-- rather than reusing writing_post: a status has no title, no group, and a different reader —
-- everyone signed in, not a group's members — so forcing it through writing_post would mean
-- nullable columns that only make sense for one of the two.
CREATE TABLE public.status_update
(
    id         UUID PRIMARY KEY     DEFAULT uuidv7(),
    created_by UUID        NOT NULL REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    body       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The feed reads newest first; this is that order, ready-made.
CREATE INDEX status_update_created_at_idx ON public.status_update (created_at DESC);

CREATE TABLE public.status_update_comment
(
    id                UUID PRIMARY KEY     DEFAULT uuidv7(),
    status_update_id  UUID        NOT NULL REFERENCES public.status_update (id) ON DELETE CASCADE,
    created_by        UUID        NOT NULL REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    body              TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comments open oldest-first under one status update, so this is that order, ready-made too.
CREATE INDEX status_update_comment_status_update_id_idx
    ON public.status_update_comment (status_update_id, created_at);

-- migrate:down

DROP TABLE public.status_update_comment;
DROP TABLE public.status_update;
