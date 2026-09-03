-- migrate:up

-- A suspension that ends by itself, deliberately separate from `banned_at`: a ban is final and
-- holds the name and the address for good (see the user_ban migration), while this lapses. Both
-- can in principle be set at once — a third strike escalated into a ban — and then the ban wins,
-- because the middleware checks it first.
ALTER TABLE public.user
    ADD COLUMN suspended_until   TIMESTAMPTZ,
    -- Unlike ban_reason, this one IS shown to the member it is about. A temporary suspension is
    -- meant to correct, so it has to say what to correct; a ban is not, which is why the two
    -- deliberately behave differently at sign-in.
    ADD COLUMN suspension_reason TEXT;

-- The two columns describe one fact, so they cannot disagree — the same reason the ban's three
-- carry a constraint.
ALTER TABLE public.user
    ADD CONSTRAINT user_suspension_is_complete CHECK (
        (suspended_until IS NULL AND suspension_reason IS NULL)
            OR (suspended_until IS NOT NULL AND suspension_reason IS NOT NULL)
        );

-- How heavily the incident weighed. A human decides this; nothing derives it.
CREATE TYPE public.strike_severity AS ENUM ('acceptable', 'borderline', 'severe');

-- What was actually decided. The ladder in the rules — warning, warning, 24h, 48h, 72h, then
-- possibly deletion — is a *suggestion* the service reads out of this history, never a rule the
-- database enforces: a severe incident may be answered with a suspension straight away.
--
-- 'deletion' is recorded, not performed: the platform already has an account deletion, and this
-- table says what was decided rather than doing it.
CREATE TYPE public.strike_action AS ENUM ('warning', 'suspension', 'deletion');

CREATE TABLE public.strike
(
    id              UUID PRIMARY KEY                DEFAULT uuidv7(),
    user_id         UUID                   NOT NULL REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    severity        public.strike_severity NOT NULL,
    action          public.strike_action   NOT NULL,
    reason          TEXT                   NOT NULL,
    -- Only set where action = 'suspension': when the suspension it imposed runs out.
    suspended_until TIMESTAMPTZ,
    -- Nullable for the same reason user.banned_by is: the operator's account may be deleted
    -- later, and losing who decided it must not remove the record.
    issued_by       UUID                   REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    issued_at       TIMESTAMPTZ            NOT NULL DEFAULT now()
);

-- The history is always read for one member in order, which is exactly this pair.
CREATE INDEX strike_user_id_idx ON public.strike (user_id, issued_at);

-- Keeping an eye on somebody, independent of the report queue: not an incident, just a note.
-- user_id is the primary key because a member is either watched or not — putting somebody on
-- the list twice updates the note and the time rather than adding a second row.
CREATE TABLE public.watchlist_entry
(
    user_id  UUID PRIMARY KEY REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    note     TEXT        NOT NULL,
    added_by UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- migrate:down

DROP TABLE public.watchlist_entry;

DROP INDEX public.strike_user_id_idx;

DROP TABLE public.strike;

DROP TYPE public.strike_action;

DROP TYPE public.strike_severity;

ALTER TABLE public.user
    DROP CONSTRAINT user_suspension_is_complete;

ALTER TABLE public.user
    DROP COLUMN suspension_reason,
    DROP COLUMN suspended_until;
