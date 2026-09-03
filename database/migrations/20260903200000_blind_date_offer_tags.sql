-- migrate:up

-- Two things a card shows before anybody reads a word of the plot: what kind of pairing it is, and
-- what it feels like.
--
-- **The pairing is an enum**, because it is a closed question with five answers and the whole point
-- of showing it is that somebody can scan a page of offers for the one that suits them. Free text
-- would give „F/M", „f x m" and „weiblich × männlich" for one answer, and a chip that reads
-- differently on every card is not something anybody scans.
--
-- Every value declared here, in the migration that creates the type: a value added later cannot be
-- *used* until its transaction commits.
--
-- `any` rather than `egal`, so the token stays in the language the rest of the schema is written in
-- — the interface says „Egal".
CREATE TYPE public.blind_date_pairing AS ENUM ('fm', 'ff', 'mm', 'dd', 'any');

-- Nullable: the offers that already exist were written before this question was asked, and a
-- default would answer it for them. A card shows the chip where there is one.
ALTER TABLE public.blind_date_offer
    ADD COLUMN pairing public.blind_date_pairing;

-- **The genres are free text**, unlike the pairing, and deliberately: „Dark Fantasy", „Slice of
-- Life" and whatever the next round needs are not a list anybody can finish in advance, and a fixed
-- vocabulary would be edited more often than the offers themselves.
--
-- An array on the offer rather than a table of its own, for the reason the roles are: a tag has no
-- life outside the offer that carries it, and nothing points at one.
ALTER TABLE public.blind_date_offer
    ADD COLUMN genres TEXT[] NOT NULL DEFAULT '{}';

-- No empty entry, the same backstop the roles carry: a chip nobody can read is not a chip.
ALTER TABLE public.blind_date_offer
    ADD CONSTRAINT blind_date_offer_genres_are_named CHECK ('' <> ALL (genres));

-- migrate:down

ALTER TABLE public.blind_date_offer
    DROP CONSTRAINT blind_date_offer_genres_are_named;

ALTER TABLE public.blind_date_offer
    DROP COLUMN genres;

ALTER TABLE public.blind_date_offer
    DROP COLUMN pairing;

DROP TYPE public.blind_date_pairing;
