-- migrate:up

-- How much time a member has actually spent here, in fifteen-minute windows.
--
-- The metric this exists for is „1000 Online-Minuten der letzten 30 Tage", the Blind-Date entry
-- condition. It could not be derived from what was already stored: `user_session` carries one
-- `updated_at` per session and is touched at most every fifteen minutes, so it says when somebody
-- was last here and nothing about how long, ever.
--
-- **A window means "did something", not "had a tab open".** One row appears the first time a
-- request of theirs lands inside it, and nothing tops it up afterwards — so leaving a browser
-- open earns nothing, which is the behaviour a rule about participation should reward.
--
-- **It is deliberately coarse.** Fifteen minutes is the same granularity the session refresh
-- already works at, it bounds the table at 2 880 rows per member per thirty days, and it is too
-- blunt to reconstruct somebody's day from. The finer this got, the more it would become a record
-- of when a person is at their computer — which is not what anybody agreed to when they joined.
CREATE TABLE public.activity_window
(
    user_id      UUID        NOT NULL REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- The start of the window, truncated to a quarter of an hour. The pair is the key: a second
    -- request in the same window is the same fact, and `ON CONFLICT DO NOTHING` makes writing it
    -- again free rather than an error.
    window_start TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, window_start)
);

-- The one question asked of this table: how many windows for this member since a cutoff. The
-- primary key already serves it, so no second index — the table is written far more than read.

-- migrate:down

DROP TABLE public.activity_window;
