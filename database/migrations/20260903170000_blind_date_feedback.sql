-- migrate:up

-- **Who ended it.**
--
-- `ended_reason` says why, and until now that was enough because only one thing ever ended a pair:
-- the name guard, acting on nobody's behalf. Once a member may end their own Blind-Date, the two
-- people in it stop being interchangeable — one of them left, the other was left — and a moderation
-- table that counted both as an abandonment would put the same mark on the person who did nothing.
--
-- Null where the platform ended it rather than a person, which is what the guard does.
--
-- `ON DELETE SET NULL`, so a member deleting their account cannot take the pair's history with
-- them; the pair keeps saying it ended, and stops saying by whom.
ALTER TABLE public.blind_date_pair
    ADD COLUMN ended_by UUID REFERENCES public."user" (id) ON DELETE SET NULL;

-- Only an ending has somebody behind it. A revealed pair with an `ended_by` would be a pair that
-- ended two ways at once, which `blind_date_pair_ending_is_one_thing` already rules out on the
-- other two columns.
ALTER TABLE public.blind_date_pair
    ADD CONSTRAINT blind_date_pair_ended_by_needs_an_ending CHECK (
        ended_by IS NULL OR ended_at IS NOT NULL
        );

-- **The three questions.**
--
-- Every value declared here, in the migration that creates the type: a value added to an enum later
-- cannot be *used* until its transaction commits.
--
-- Asked about the format and never about the other person. A rating of somebody one wrote with,
-- held by the team and invisible to them, is a private review — and the answer to „that person
-- behaved badly" is the report queue, which exists, and not a box on a form nobody promised to act
-- on. The form says so itself.
CREATE TYPE public.blind_date_verdict AS ENUM ('yes', 'partly', 'no');

CREATE TYPE public.blind_date_again AS ENUM ('yes', 'maybe', 'no');

-- Voluntary, and one per person per Blind-Date.
--
-- Both people may fill it in, and each answers only for themselves — hence the key on the pair and
-- the member together rather than on the pair alone.
--
-- **A declined form is a row too**, with both answers null. Without that the page would have no way
-- of knowing it had already asked, and would go on asking after every ending for ever — which is
-- the nagging the design system's research is about. Saying „nein danke" is an answer to the
-- question „may we ask", and it is worth counting: a form nine people in ten decline is telling the
-- team something about the form.
--
-- Kept when the account goes: `user_id` cascades, so a deleted member's answers go with them. The
-- alternative — orphaned rows saying „somebody found it did not work" — is data nobody consented
-- to leave behind.
CREATE TABLE public.blind_date_feedback
(
    id         UUID PRIMARY KEY          DEFAULT uuidv7(),
    pair_id    UUID        NOT NULL REFERENCES public.blind_date_pair (id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
    -- „Hat das Blind-Date für dich funktioniert?"
    worked     public.blind_date_verdict,
    -- „Möchtest du wieder an einem Blind-Date teilnehmen?" — the one answer that says something
    -- about the ritual itself rather than about one round of it.
    again      public.blind_date_again,
    -- „Was hat gut funktioniert, was hat gefehlt?" Optional, because the two above are the ones
    -- that can be counted and this is the one that takes effort.
    note       TEXT,
    created_at TIMESTAMPTZ NOT NULL      DEFAULT now(),
    CONSTRAINT blind_date_feedback_once_per_member UNIQUE (pair_id, user_id),
    -- Answered means both; declined means neither. A half-filled row would be a fourth state the
    -- reading code would have to invent a meaning for.
    --
    -- And a decline carries no note: a free-text remark with the two answers left blank is an
    -- answer in disguise, and the form does not offer that combination in the first place.
    CONSTRAINT blind_date_feedback_answered_or_declined CHECK (
        (worked IS NULL) = (again IS NULL)
            AND (worked IS NOT NULL OR note IS NULL)
        )
);

-- The team reads this pair by pair when looking at a Blind-Date, and as a whole when asking whether
-- the format works at all. The first needs the index; the second is a full scan either way.
CREATE INDEX blind_date_feedback_pair_idx ON public.blind_date_feedback (pair_id);

-- migrate:down

DROP TABLE public.blind_date_feedback;

DROP TYPE public.blind_date_again;

DROP TYPE public.blind_date_verdict;

ALTER TABLE public.blind_date_pair
    DROP CONSTRAINT blind_date_pair_ended_by_needs_an_ending;

ALTER TABLE public.blind_date_pair
    DROP COLUMN ended_by;
