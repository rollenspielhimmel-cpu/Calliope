-- migrate:up

-- The public forum: categories that only group, sub-forums that hold threads, and threads that
-- hold posts. Deliberately its own set of tables rather than an extension of writing_thread.
--
-- The reason is authorisation, not shape. A group thread is reached by resolving the caller's
-- role in its group — `selectRoleForUser` — and every route that reads or writes one depends on
-- `writing_thread.writing_group_id` being NOT NULL. Hanging forum threads off the same table
-- would make that column nullable and give every existing query a second branch, where a
-- forgotten branch fails *open*. What is worth sharing is shared instead: the `document` format,
-- its text extraction and the editor, none of which know what a group is.

-- Ordered from open to closed, and the order is load-bearing: Postgres compares enum values by
-- declaration, so `visibility >= 'moderation'` means "at least that restricted" and the stricter
-- of two values is simply the greater one.
CREATE TYPE public.forum_visibility AS ENUM (
    'everyone',       -- readable without an account at all
    'members',        -- any signed-in member
    'moderation',     -- moderators and administrators
    'administration'  -- administrators only
    );

-- A heading and nothing else: categories hold no content of their own.
CREATE TABLE public.forum_category
(
    id         UUID PRIMARY KEY     DEFAULT uuidv7(),
    title      TEXT        NOT NULL,
    -- Where it sits among the others. Not unique: two categories given the same position are a
    -- display detail, not a state worth refusing an edit over — `id` breaks the tie.
    position   INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX forum_category_position_idx ON public.forum_category (position, id);

CREATE TABLE public.sub_forum
(
    id          UUID PRIMARY KEY     DEFAULT uuidv7(),
    -- RESTRICT, not CASCADE: deleting a category must not silently take threads with it. The
    -- sub-forums are moved or deleted first, deliberately.
    category_id UUID        NOT NULL REFERENCES public.forum_category (id) ON UPDATE CASCADE ON DELETE RESTRICT,

    title       TEXT        NOT NULL,
    -- Shown under the title in the overview, as in the original: one or two lines saying what
    -- belongs here. Required, because a sub-forum nobody can place is one nobody posts in.
    description TEXT        NOT NULL,

    visibility  public.forum_visibility NOT NULL DEFAULT 'members',

    position    INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sub_forum_category_id_idx ON public.sub_forum (category_id, position, id);

CREATE TABLE public.forum_thread
(
    id               UUID PRIMARY KEY     DEFAULT uuidv7(),
    -- RESTRICT for the same reason as above: a sub-forum with threads in it is emptied on
    -- purpose, never by deleting the thing above it.
    sub_forum_id     UUID        NOT NULL REFERENCES public.sub_forum (id) ON UPDATE CASCADE ON DELETE RESTRICT,

    title            TEXT        NOT NULL,

    -- Null means "whatever the sub-forum says", which is what almost every thread wants.
    --
    -- Where it is set it can only *narrow*: the effective visibility is the stricter — the
    -- greater — of the two. A thread marked `everyone` inside an administration sub-forum stays
    -- administration-only, which is what makes moving a thread into a closed sub-forum a way to
    -- hide it. The opposite rule would turn one careless move into a disclosure.
    visibility       public.forum_visibility,

    created_by       UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the thread list of one sub-forum reads, in the order it reads it.
CREATE INDEX forum_thread_sub_forum_id_idx
    ON public.forum_thread (sub_forum_id, last_activity_at DESC, id);

CREATE TABLE public.forum_post
(
    id              UUID PRIMARY KEY     DEFAULT uuidv7(),
    forum_thread_id UUID        NOT NULL REFERENCES public.forum_thread (id) ON UPDATE CASCADE ON DELETE CASCADE,

    -- The same Tiptap document a writing_post stores, and the same rule: never HTML. The format,
    -- its schema and the editor are shared; only the table is not.
    document        JSONB       NOT NULL,
    -- The prose of `document`, extracted by the server and never sent by the client — as in
    -- writing_post, because search, a report excerpt and the length bound all read text.
    text            TEXT        NOT NULL,

    -- No `is_draft`. A forum post is sent or it is not: the draft machinery next door answers a
    -- question about composing long-form prose together, which this is not.

    created_by      UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Null until an already-published post is changed, which is the only edit a reader is told
    -- about. Same meaning as writing_post.edited_at.
    edited_at       TIMESTAMPTZ,
    edited_by       UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Posts are read oldest first within a thread, and counted per sub-forum through the thread.
CREATE INDEX forum_post_forum_thread_id_idx ON public.forum_post (forum_thread_id, created_at, id);

-- Every post moves its thread, unlike next door where a draft deliberately does not — there are
-- no drafts here, so there is nothing to skip.
CREATE FUNCTION public.set_last_activity_at_for_forum_thread()
    RETURNS TRIGGER
    SET search_path TO ''
AS
$$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        UPDATE public.forum_thread
        SET last_activity_at = now()
        WHERE id = OLD.forum_thread_id;
    ELSE
        UPDATE public.forum_thread
        SET last_activity_at = now()
        WHERE id = NEW.forum_thread_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_last_activity_at_for_forum_thread
    AFTER INSERT OR UPDATE OR DELETE
    ON public.forum_post
    FOR EACH ROW
EXECUTE FUNCTION public.set_last_activity_at_for_forum_thread();

-- Renaming or moving a thread is not activity in it; only its own timestamp column is.
CREATE TRIGGER set_last_activity_at
    BEFORE UPDATE
    ON public.forum_thread
    FOR EACH ROW
EXECUTE FUNCTION public.set_last_activity_at();

-- migrate:down

DROP TRIGGER set_last_activity_at ON public.forum_thread;

DROP TRIGGER set_last_activity_at_for_forum_thread ON public.forum_post;

DROP FUNCTION public.set_last_activity_at_for_forum_thread();

DROP INDEX public.forum_post_forum_thread_id_idx;

DROP TABLE public.forum_post;

DROP INDEX public.forum_thread_sub_forum_id_idx;

DROP TABLE public.forum_thread;

DROP INDEX public.sub_forum_category_id_idx;

DROP TABLE public.sub_forum;

DROP INDEX public.forum_category_position_idx;

DROP TABLE public.forum_category;

DROP TYPE public.forum_visibility;
