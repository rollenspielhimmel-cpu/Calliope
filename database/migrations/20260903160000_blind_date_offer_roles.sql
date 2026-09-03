-- migrate:up

-- Two things an offered plot has been missing.
--
-- **The roles it has.** Until now an applicant typed what they wanted into a free-text field, which
-- made two applications for the same plot impossible to line up: „weiblich", „w", „die Wirtin" and
-- „Wirtin (aber flexibel)" are four answers to one question. The team knows the plot's characters,
-- so it names them, and applying becomes a choice rather than a description.
--
-- Free text stays for a *proactive* application — somebody naming a plot that is not on offer has
-- no list to choose from, and inventing one for them would be guessing at a story the team has not
-- written.
--
-- Stored as an array on the offer rather than a table of its own: a role has no life outside the
-- offer that names it, nothing references one, and an application keeps the text it chose so a
-- later edit to the list cannot rewrite what somebody applied for.
ALTER TABLE public.blind_date_offer
    ADD COLUMN roles TEXT[] NOT NULL DEFAULT '{}';

-- No empty entry: a choice nobody can read is not a choice. Written with `ALL` rather than an
-- `unnest` subquery, which Postgres refuses in a CHECK — and this is a backstop either way, since
-- the request schema trims each role and rejects a blank one before it ever reaches here.
ALTER TABLE public.blind_date_offer
    ADD CONSTRAINT blind_date_offer_roles_are_named CHECK ('' <> ALL (roles));

-- **Until when one may apply.** Asked for in an earlier specification and never built — the offer
-- could only be closed by hand, which meant somebody had to remember.
--
-- Nullable, because an offer without a deadline is a real case: „bis wir genug Bewerbungen haben"
-- is how most rounds actually run. Nothing closes the offer automatically; this is what the page
-- shows and what the application check reads, so a round that overruns is visible rather than
-- silently still open.
ALTER TABLE public.blind_date_offer
    ADD COLUMN closes_at TIMESTAMPTZ;

-- migrate:down

ALTER TABLE public.blind_date_offer
    DROP COLUMN closes_at;

ALTER TABLE public.blind_date_offer
    DROP CONSTRAINT blind_date_offer_roles_are_named;

ALTER TABLE public.blind_date_offer
    DROP COLUMN roles;
