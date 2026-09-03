-- migrate:up

-- Each partner's own consent to being revealed.
--
-- **Two separate answers, not one switch.** The reveal is the moment the whole ritual is aimed at,
-- and it only happens when both have said yes — so each says so for themselves, and either can
-- take it back while the other has not answered. A single flag on the pair would let whoever
-- pressed first decide for both.
--
-- Null means "has not said yes", which is also what taking it back returns to. Nothing records
-- that somebody withdrew: the question is only ever "do you want to, now", and keeping a history
-- of hesitation would make a private change of mind into something the other could ask about.
ALTER TABLE public.blind_date_partner
    ADD COLUMN wants_reveal_at TIMESTAMPTZ;

-- migrate:down

ALTER TABLE public.blind_date_partner
    DROP COLUMN wants_reveal_at;
