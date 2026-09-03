-- migrate:up

-- Fixed text pages the operators write themselves — the rules, an FAQ — so that adding one is
-- not a deploy. Deliberately not a content management system: a slug, a title, a body, and who
-- last touched it.
CREATE TABLE public.custom_page
(
    -- The URL segment, which is also the identity: renaming a page's address is creating a
    -- different page, and the link somebody bookmarked should say which one they meant.
    slug            TEXT PRIMARY KEY,
    title           TEXT        NOT NULL,
    -- Markdown, not HTML and not a document tree: nothing else in the product offers rich-text
    -- input, and storing markup an editor produced would commit us to that editor.
    body            TEXT        NOT NULL,
    -- Whether somebody without an account may read it. The rules and an FAQ usually should be
    -- readable before joining; a page about how the team works usually should not.
    is_public       BOOLEAN     NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Nullable for the usual reason: the account that wrote it may be deleted later, and losing
    -- who did must not take the page with it.
    last_edited_by  UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- migrate:down

DROP TABLE public.custom_page;
