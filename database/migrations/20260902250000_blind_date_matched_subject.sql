-- migrate:up

-- `notification_subject_matches_type` ends in `ELSE false`, so the type added in the previous
-- migration is rejected until it has a branch here. That is the constraint working exactly as its
-- own comment says it should — "a new type with no branch here forces the decision" — and this is
-- the decision.
--
-- A Blind-Date match names its group and nothing else. The group's title is the plot, which is
-- what the sentence needs; there is no thread to point at yet, no post, and no chat.
--
-- Rebuilt rather than amended: a CHECK cannot be altered in place.
ALTER TABLE public.notification
    DROP CONSTRAINT notification_subject_matches_type;

ALTER TABLE public.notification
    ADD CONSTRAINT notification_subject_matches_type CHECK (
        CASE type
            WHEN 'blind_date_matched' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'invited_to_writing_group' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'invitation_accepted' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'visibility_changed_in_writing_group' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'role_changed_in_writing_group' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'new_writing_thread' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NOT NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'new_writing_post' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NOT NULL AND writing_post_id IS NOT NULL
                        AND writing_page_id IS NULL
            -- A chat needs no per-message notification: the chat list counts unread from
            -- last_read_at, and a row per message would say the same thing twice, loudly.
            WHEN 'new_writing_page' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                    AND writing_page_id IS NOT NULL
            WHEN 'invited_to_chat_group' THEN
                chat_group_id IS NOT NULL AND writing_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            ELSE false
            END
        );

-- migrate:down

ALTER TABLE public.notification
    DROP CONSTRAINT notification_subject_matches_type;

ALTER TABLE public.notification
    ADD CONSTRAINT notification_subject_matches_type CHECK (
        CASE type
            WHEN 'invited_to_writing_group' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'invitation_accepted' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'visibility_changed_in_writing_group' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'role_changed_in_writing_group' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'new_writing_thread' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NOT NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'new_writing_post' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NOT NULL AND writing_post_id IS NOT NULL
                        AND writing_page_id IS NULL
            WHEN 'new_writing_page' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                    AND writing_page_id IS NOT NULL
            WHEN 'invited_to_chat_group' THEN
                chat_group_id IS NOT NULL AND writing_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            ELSE false
            END
        );
