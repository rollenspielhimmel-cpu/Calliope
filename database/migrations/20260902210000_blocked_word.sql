-- migrate:up

-- Words the community does not print. A table rather than a list in the code, for the reason
-- `blocked_email_domain` gives: the operators already know what belongs on it, and a deploy per
-- word is the wrong cost.
--
-- **Nothing here ever changes what a member wrote.** The word is masked when text is read, never
-- when it is stored. Two things follow from that, and both are the point of doing it this way:
-- taking a word off this list makes every older text readable again, exactly as it was written;
-- and adding one masks everything already written without a single row being rewritten.
--
-- Administrator rather than moderator territory, like the domains beside it: this decides what the
-- whole community may print, not what happens to one account.
CREATE TABLE public.blocked_word
(
    -- Stored lower-cased; the match itself is case-insensitive either way. The primary key is
    -- what stops the same word being added twice under two spellings of the same letters.
    word     TEXT PRIMARY KEY CHECK (word = lower(word) AND btrim(word) = word AND length(word) >= 2),
    -- Nullable for the reason it is everywhere else: the account that added it may be deleted
    -- later, and losing who did it must not lift the masking.
    added_by UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Optional, like the domain list's: a slur needs no explanation, and the note is for the
    -- entries that do — a name being used to harass somebody, say.
    note     TEXT
);

-- Deliberately seeded with nothing. What belongs on it is this community's decision, and a list
-- shipped from here would be a guess at their language made by somebody who is not in it.

-- migrate:down

DROP TABLE public.blocked_word;
