-- migrate:up

-- A Blind-Date can now end without being revealed.
--
-- The first thing that ends one this way is the name guard: somebody writes their own name in the
-- exchange thread, the anonymity is gone, and there is nothing left to protect by carrying on.
--
-- **Ending is not deleting.** The group, its four threads and everything both of them wrote stay
-- exactly as they are, and stay pseudonymous — the pair is over, not the writing. An automatic
-- string match must not destroy anybody's prose, least of all the prose of the person who did
-- nothing. Whether the group is later deleted is a decision the two of them make like any other
-- group's, through the route that already exists for it.
ALTER TABLE public.blind_date_pair
    ADD COLUMN ended_at TIMESTAMPTZ,
    -- Why, in a token the interface turns into a sentence. Prose here would be a second place the
    -- wording lives, and this is read by the team as well as shown to the two.
    ADD COLUMN ended_reason TEXT;

-- The two ways a pair stops being current are mutually exclusive: revealing is an ending nobody
-- needs a reason for, and ending without revealing always has one.
ALTER TABLE public.blind_date_pair
    ADD CONSTRAINT blind_date_pair_ending_is_one_thing CHECK (
        (revealed_at IS NULL OR ended_at IS NULL)
            AND (ended_at IS NULL) = (ended_reason IS NULL)
        );

-- migrate:down

ALTER TABLE public.blind_date_pair
    DROP CONSTRAINT blind_date_pair_ending_is_one_thing;

ALTER TABLE public.blind_date_pair
    DROP COLUMN ended_reason,
    DROP COLUMN ended_at;
