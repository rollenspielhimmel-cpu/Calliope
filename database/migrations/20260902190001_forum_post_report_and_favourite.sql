-- migrate:up

-- A forum post can be reported and favourited, like the writing post it is a sibling of. Both
-- tables were built to be extended this way: `favourite`'s own comment says "a sixth kind is then
-- a column and nothing else", and `report` keeps one nullable reference per kind.

ALTER TABLE public.report
    -- ON DELETE SET NULL like every other target: deleting the reported post must not delete the
    -- report of it, which is the whole reason `target_type` and the excerpt are stored.
    ADD COLUMN reported_forum_post_id UUID REFERENCES public.forum_post (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Rebuilt rather than amended: a CHECK cannot be altered in place, and every branch has to name
-- the new column or a report of one kind could carry a reference of another.
--
-- `ELSE false` still matters — a CASE with no matching branch evaluates to NULL, and a CHECK
-- passes on NULL, which would let a target type added later through unchecked.
ALTER TABLE public.report
    DROP CONSTRAINT report_target_matches_type;

ALTER TABLE public.report
    ADD CONSTRAINT report_target_matches_type CHECK (
        CASE target_type
            WHEN 'writing_group' THEN num_nonnulls(reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0
            WHEN 'writing_thread' THEN num_nonnulls(reported_writing_group_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0
            WHEN 'writing_post' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0
            WHEN 'writing_page' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0
            WHEN 'story_idea' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0
            WHEN 'chat_group' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0
            WHEN 'chat_message' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_user_id, reported_forum_post_id) = 0
            WHEN 'user' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_forum_post_id) = 0
            WHEN 'forum_post' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            ELSE false
            END
        );

-- The "one open report per member per thing per category" index has to know about the new column
-- too, or two reports of the same forum post would not collide.
DROP INDEX public.report_one_open_per_reporter_and_category_idx;

CREATE UNIQUE INDEX report_one_open_per_reporter_and_category_idx
    ON public.report (reporter_id, category, reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id,
                      reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id,
                      reported_forum_post_id)
    NULLS NOT DISTINCT
    WHERE closed_at IS NULL
        AND reporter_id IS NOT NULL
        AND num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id,
                         reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 1;

CREATE INDEX report_reported_forum_post_idx ON public.report (reported_forum_post_id)
    WHERE reported_forum_post_id IS NOT NULL;

-- The sixth kind of favourite, which is a column and nothing else — as that table's own comment
-- promised. CASCADE here, unlike the report: a favourite of something deleted means nothing.
ALTER TABLE public.favourite
    ADD COLUMN forum_post_id UUID REFERENCES public.forum_post (id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.favourite
    DROP CONSTRAINT favourite_names_exactly_one_thing;

ALTER TABLE public.favourite
    ADD CONSTRAINT favourite_names_exactly_one_thing CHECK (
        num_nonnulls(writing_group_id, writing_thread_id, writing_post_id, writing_page_id, story_idea_id,
                     chat_group_id, forum_post_id) = 1
        );

DROP INDEX public.favourite_one_per_member_idx;

CREATE UNIQUE INDEX favourite_one_per_member_idx
    ON public.favourite (user_id, writing_group_id, writing_thread_id, writing_post_id, writing_page_id,
                         story_idea_id, chat_group_id, forum_post_id)
    NULLS NOT DISTINCT;

CREATE INDEX favourite_forum_post_idx ON public.favourite (forum_post_id)
    WHERE forum_post_id IS NOT NULL;

-- migrate:down

DROP INDEX public.favourite_forum_post_idx;

DROP INDEX public.favourite_one_per_member_idx;

CREATE UNIQUE INDEX favourite_one_per_member_idx
    ON public.favourite (user_id, writing_group_id, writing_thread_id, writing_post_id, writing_page_id,
                         story_idea_id, chat_group_id)
    NULLS NOT DISTINCT;

ALTER TABLE public.favourite
    DROP CONSTRAINT favourite_names_exactly_one_thing;

ALTER TABLE public.favourite
    ADD CONSTRAINT favourite_names_exactly_one_thing CHECK (
        num_nonnulls(writing_group_id, writing_thread_id, writing_post_id, writing_page_id, story_idea_id,
                     chat_group_id) = 1
        );

ALTER TABLE public.favourite
    DROP COLUMN forum_post_id;

DROP INDEX public.report_reported_forum_post_idx;

DROP INDEX public.report_one_open_per_reporter_and_category_idx;

CREATE UNIQUE INDEX report_one_open_per_reporter_and_category_idx
    ON public.report (reporter_id, category, reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id,
                      reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id)
    NULLS NOT DISTINCT
    WHERE closed_at IS NULL
        AND reporter_id IS NOT NULL
        AND num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id,
                         reported_chat_group_id, reported_chat_message_id, reported_user_id) = 1;

ALTER TABLE public.report
    DROP CONSTRAINT report_target_matches_type;

ALTER TABLE public.report
    ADD CONSTRAINT report_target_matches_type CHECK (
        CASE target_type
            WHEN 'writing_group' THEN num_nonnulls(reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'writing_thread' THEN num_nonnulls(reported_writing_group_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'writing_post' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'writing_page' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'story_idea' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'chat_group' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'chat_message' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_user_id) = 0
            WHEN 'user' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id) = 0
            ELSE false
            END
        );

ALTER TABLE public.report
    DROP COLUMN reported_forum_post_id;
