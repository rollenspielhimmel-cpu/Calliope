-- migrate:up

-- A ban on an address rather than an account. Deliberately its own table rather than a column
-- on `user`, the way an account ban is: an IP ban has no account to sit on — it exists precisely
-- because an address outlives whichever account was using it.
--
-- Not linked to a user ban on purpose: addresses are shared (a household, a phone network), so
-- banning one because of an account would lock out people who did nothing. Banning an address
-- stays a separate, deliberate decision taken after reading who has used it.
CREATE TABLE public.banned_ip
(
    -- TEXT, not INET, to match user_session.ip_address: both sides of the comparison come from
    -- `clientAddress`, so they have to agree exactly, and INET would make a malformed
    -- X-Forwarded-For a 500 on every request rather than an address that simply never matches.
    ip_address TEXT PRIMARY KEY,
    banned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Nullable for the same reason user.banned_by is: the operator's own account may be deleted
    -- later, and losing who did it must not lift the ban.
    banned_by  UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    reason     TEXT        NOT NULL
);

-- Partial: `banned_by` is null on all but a handful of rows.
CREATE INDEX banned_ip_banned_by_idx ON public.banned_ip (banned_by) WHERE banned_by IS NOT NULL;

-- migrate:down

DROP INDEX public.banned_ip_banned_by_idx;

DROP TABLE public.banned_ip;
