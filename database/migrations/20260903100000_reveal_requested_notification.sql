-- migrate:up

-- When one side of a Blind-Date says yes, the other has to be told. Until now they only found out
-- by happening to open the group again — the decision sat there waiting for somebody who had no
-- reason to look.
--
-- Its own migration and nothing else in it: a new enum value cannot be *used* in the transaction
-- that adds it, and the CHECK in the next migration names it. The split `20260902240000` documents.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'blind_date_reveal_requested';

-- migrate:down

-- Postgres cannot remove an enum value. See `20260902240000` for the whole argument.
SELECT 1;
