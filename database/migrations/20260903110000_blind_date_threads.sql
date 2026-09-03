-- migrate:up

-- A Blind-Date now starts with four threads rather than one: a profile for each side, a place for
-- everything outside the story, and the story itself.
--
-- Two of them are referenced by name elsewhere — the RPG thread is the one the fifty-post
-- threshold counts, and the exchange thread is the one watched for somebody giving their own name
-- away. **Referenced by id and not by title**, because a title is the members' to change: they can
-- rename any thread in their group, and a rule that matched on „Gemeinsamer Austausch" would stop
-- applying the moment somebody tidied it up.
--
-- Nullable, because a pair made before this migration has one thread and neither of these. Nothing
-- in production has: the feature is not launched. The code reads null as "an older pair" rather
-- than assuming, so a development database that has one keeps working.
ALTER TABLE public.blind_date_pair
    ADD COLUMN rpg_thread_id      UUID REFERENCES public.writing_thread (id) ON UPDATE CASCADE ON DELETE SET NULL,
    ADD COLUMN exchange_thread_id UUID REFERENCES public.writing_thread (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- migrate:down

ALTER TABLE public.blind_date_pair
    DROP COLUMN exchange_thread_id,
    DROP COLUMN rpg_thread_id;
