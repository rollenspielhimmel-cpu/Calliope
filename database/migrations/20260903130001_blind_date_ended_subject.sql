-- migrate:up

-- The branch for the type added in the previous migration. Third time this constraint has caught
-- a new type with no branch, which is exactly what its `ELSE false` is for.
ALTER TABLE public.notification
    DROP CONSTRAINT notification_subject_matches_type;

ALTER TABLE public.notification
    ADD CONSTRAINT notification_subject_matches_type CHECK (
        CASE type
            WHEN 'blind_date_matched' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'blind_date_reveal_requested' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'blind_date_ended' THEN
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
            WHEN 'blind_date_matched' THEN
                writing_group_id IS NOT NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                        AND writing_page_id IS NULL
            WHEN 'blind_date_reveal_requested' THEN
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
