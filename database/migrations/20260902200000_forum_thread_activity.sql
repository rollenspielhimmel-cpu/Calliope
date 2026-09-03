-- migrate:up

-- `20260902180000_forum.sql` gave `forum_thread` the shared `set_last_activity_at` trigger and
-- said in the same breath that "renaming or moving a thread is not activity in it". The trigger
-- does the opposite: it fires `BEFORE UPDATE` on any distinct change, so changing a title, a
-- visibility or — now that moderation can — a sub-forum stamps the thread as freshly active and
-- lifts it to the top of the list it lands in. Worse, it fires on a write to the column itself,
-- which makes `last_activity_at` unsettable: even `SET last_activity_at = <a date>` is overwritten
-- with `now()` before it lands.
--
-- Nothing needs it. A thread is born with `DEFAULT now()`, and every post moves it through
-- `set_last_activity_at_for_forum_thread`, which writes the column explicitly from the `forum_post`
-- trigger. So the fix is to take it away rather than to teach it which columns to ignore.
--
-- Deliberately not done for `writing_thread` next door: a thread there is renamed inside the group
-- that is reading it, nobody moves one between groups, and changing that column's meaning would
-- reorder every group's thread list on a deployment. This is a forum decision.
DROP TRIGGER set_last_activity_at ON public.forum_thread;

-- migrate:down

CREATE TRIGGER set_last_activity_at
    BEFORE UPDATE
    ON public.forum_thread
    FOR EACH ROW
EXECUTE FUNCTION public.set_last_activity_at();
