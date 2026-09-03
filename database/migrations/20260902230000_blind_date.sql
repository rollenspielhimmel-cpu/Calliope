-- migrate:up

-- Blind-Date: two members write together without knowing who the other is, until they both decide
-- to find out. A long-standing RSH ritual, until now run on throwaway accounts and a spreadsheet.
--
-- The whole point of doing it in the product is that **members take part with their real account**.
-- Nothing here creates a second identity; what changes is only how a name is *displayed* inside one
-- group, which is why the reveal is a flag flip and not a migration of anybody's writing.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- What the group itself carries
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Named for what it does, not for why it exists. The group has no business knowing about
-- Blind-Date; it needs to know that its authors are shown under pseudonyms, and Blind-Date is
-- currently the only reason to set that. A future feature wanting the same behaviour gets it
-- without a second flag meaning the same thing.
--
-- The reveal sets this to false. The group is then an ordinary group with real names, keeps every
-- post, and does **not** become public by doing so — whether the writing is published is the
-- pair's decision, taken through the ordinary visibility setting, not a side effect of revealing.
ALTER TABLE public.writing_group
    ADD COLUMN authors_are_pseudonymous BOOLEAN NOT NULL DEFAULT false;

-- Every read path that names an author has to consult this, and most of them reach the group
-- through a thread or a post rather than by id. Partial, because the true rows are the few.
CREATE INDEX writing_group_pseudonymous_idx ON public.writing_group (id)
    WHERE authors_are_pseudonymous;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- What the team offers, and what members apply for
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- The plots the team puts up, typically two at a time. A member may also name any official RSH
-- plot themselves, which is why an application's plot is text and this reference is optional.
CREATE TABLE public.blind_date_offer
(
    id          UUID PRIMARY KEY     DEFAULT uuidv7(),
    title       TEXT        NOT NULL CHECK (btrim(title) <> ''),
    description TEXT        NOT NULL CHECK (btrim(description) <> ''),
    -- Closed rather than deleted: applications point at it, and a closed offer still has to say
    -- what somebody applied for months later.
    closed_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX blind_date_offer_open_idx ON public.blind_date_offer (created_at DESC)
    WHERE closed_at IS NULL;

-- Roman or Sternchen. A real binary in this community's vocabulary, so it is an enum rather than
-- prose: the team scans a queue of these, and two spellings of the same answer would not sort.
CREATE TYPE public.blind_date_writing_style AS ENUM ('prose', 'asterisk');

-- Roughly how much somebody writes per post. Three rungs, because the question being asked is
-- "will these two frustrate each other", and a word count answers that no better than a word does.
CREATE TYPE public.blind_date_post_length AS ENUM ('short', 'medium', 'long');

-- Every value declared here, in the migration that creates the type: a value added to an enum
-- later cannot be *used* until its transaction commits, which is the trap `user_token` documents.
--
-- 'matched' is where a pairing takes it. 'declined' is the team's answer, 'withdrawn' the member's
-- own, and 'expired' what a round that moved on leaves behind. **None of them delete the row**:
-- who applied and how often is what the spreadsheet carried implicitly, and the team asked to keep
-- it.
CREATE TYPE public.blind_date_application_status AS ENUM (
    'pending', 'matched', 'declined', 'withdrawn', 'expired'
    );

CREATE TABLE public.blind_date_application
(
    id             UUID PRIMARY KEY                        DEFAULT uuidv7(),
    user_id        UUID                           NOT NULL REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    status         public.blind_date_application_status NOT NULL DEFAULT 'pending',

    -- What they want to write. The offer where they took one up, and the title either way — an
    -- offer that is later renamed must not silently rewrite what somebody applied for.
    offer_id       UUID                           REFERENCES public.blind_date_offer (id) ON UPDATE CASCADE ON DELETE SET NULL,
    plot_title     TEXT                           NOT NULL CHECK (btrim(plot_title) <> ''),

    -- The preferences. Two are enums because the team scans them; two are prose because real
    -- answers to them do not fit boxes, and a human reads these before deciding anything.
    writing_style  public.blind_date_writing_style NOT NULL,
    post_length    public.blind_date_post_length  NOT NULL,
    role_gender    TEXT                           NOT NULL CHECK (btrim(role_gender) <> ''),
    pairing        TEXT                           NOT NULL CHECK (btrim(pairing) <> ''),
    -- Anything else they want the team to know. Optional, unlike the rest.
    note           TEXT,

    created_at     TIMESTAMPTZ                    NOT NULL DEFAULT now(),
    -- Who answered it and when, for every status but 'pending'. Nullable together.
    decided_at     TIMESTAMPTZ,
    decided_by     UUID                           REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    -- Why it was declined, where it was. Read by the team, not shown to the applicant.
    decision_note  TEXT,

    CONSTRAINT blind_date_application_decision_is_complete CHECK (
        (status = 'pending' AND decided_at IS NULL)
            OR (status <> 'pending' AND decided_at IS NOT NULL)
        )
);

-- One open application per member. A second one is not a second wish, it is the same wish typed
-- again, and the queue is read by hand.
CREATE UNIQUE INDEX blind_date_application_one_pending_per_member_idx
    ON public.blind_date_application (user_id)
    WHERE status = 'pending';

-- The queue, oldest first: whoever has waited longest is who the team should be looking at.
CREATE INDEX blind_date_application_pending_idx
    ON public.blind_date_application (created_at)
    WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The pairing
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.blind_date_pair
(
    id               UUID PRIMARY KEY     DEFAULT uuidv7(),
    -- The group the two write in. RESTRICT rather than CASCADE: deleting a group must not quietly
    -- take the record of the pairing with it, and ending a Blind-Date without revealing is a
    -- deliberate act that removes both.
    writing_group_id UUID        NOT NULL UNIQUE REFERENCES public.writing_group (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    matched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    matched_by       UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    -- Null while the two are still anonymous to each other. Set once both have agreed to it, and
    -- the same moment `writing_group.authors_are_pseudonymous` goes false.
    revealed_at      TIMESTAMPTZ
);

-- Who is in it, and which application put them there.
--
-- Its own table rather than two columns on the pair, for one reason: „maximal ein aktives
-- Blind-Date pro Mitglied" is a real invariant, and a partial unique index cannot span two columns
-- of the same row. With a row per partner it is one index, and two moderators matching the same
-- member at the same moment lose the race in the database rather than in a check that raced.
CREATE TABLE public.blind_date_partner
(
    pair_id        UUID    NOT NULL REFERENCES public.blind_date_pair (id) ON UPDATE CASCADE ON DELETE CASCADE,
    user_id        UUID    NOT NULL REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    application_id UUID    REFERENCES public.blind_date_application (id) ON UPDATE CASCADE ON DELETE SET NULL,
    -- The pair's `revealed_at IS NULL` carried here, because the index below needs it on this row.
    -- Written in the same transaction as the reveal; `blind_date_partner_active_matches_pair`
    -- cannot be a CHECK across tables, so the service owns it and its test says so.
    is_active      BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY (pair_id, user_id)
);

-- The invariant this table exists for.
CREATE UNIQUE INDEX blind_date_partner_one_active_per_member_idx
    ON public.blind_date_partner (user_id)
    WHERE is_active;

CREATE INDEX blind_date_partner_by_user_idx ON public.blind_date_partner (user_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Who may not take part
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Deliberately **not** a flag on `watchlist_entry`. That list says of itself, on two tabs, that it
-- is "kein Vorfall und keine Konsequenz" — and an exclusion is exactly a consequence. Putting one
-- there would make that sentence untrue and cost the watchlist the only thing it means.
--
-- Same shape as the watchlist, and it sits beside it in the same area: a team that knows one knows
-- this one.
CREATE TABLE public.blind_date_exclusion
(
    user_id    UUID PRIMARY KEY REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- Required, unlike the watchlist's note: this one stops somebody taking part, so it has to say
    -- why. The old system carried the same thing in an "Anmerkungen" column.
    reason     TEXT        NOT NULL CHECK (btrim(reason) <> ''),
    added_by   UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- migrate:down

DROP TABLE public.blind_date_exclusion;
DROP TABLE public.blind_date_partner;
DROP TABLE public.blind_date_pair;
DROP TABLE public.blind_date_application;
DROP TYPE public.blind_date_application_status;
DROP TYPE public.blind_date_post_length;
DROP TYPE public.blind_date_writing_style;
DROP TABLE public.blind_date_offer;

DROP INDEX public.writing_group_pseudonymous_idx;

ALTER TABLE public.writing_group
    DROP COLUMN authors_are_pseudonymous;
