-- migrate:up

-- **Eine Rundmail meldet sich wie eine neue PN, weil sie eine ist.**
--
-- Der vorige Stand ließ sie still ankommen. Das ging auf ein Missverständnis zurück: „Niemand
-- bekommt eine Meldung, dass etwas im Forum gelandet ist" hieß nur das — nicht, dass die Rundmail
-- selbst lautlos sein soll. Wer nicht zufällig ins Postfach sieht, erführe sonst nie, dass eine
-- Ankündigung da ist, und dafür gibt es sie.
--
-- **Und eine gewöhnliche neue PN meldet sich sehr wohl.** Nicht die Folgenachricht in einem
-- laufenden Chat — die ist still —, aber die Einladung, mit der ein Gespräch beginnt. Eine Rundmail
-- legt das Mitglied direkt als `joined` an und übersprang damit genau die Meldung, die sonst am
-- Anfang jedes Gesprächs steht.
--
-- **Der Wert `broadcast_received` steht noch da**, aus dem ersten Anlauf: PostgreSQL kennt kein
-- DROP VALUE, also blieb er als unbenutzter Eintrag stehen. Jetzt bekommt er eine Bedeutung, und
-- zwar eine andere als damals — er zeigt nicht mehr auf die Rundmail, sondern auf **das Gespräch**.
-- Das ist der Unterschied zwischen dem ersten Anlauf und diesem: Damals war die Meldung der Ort, an
-- dem man die Rundmail las. Jetzt ist sie nur der Fingerzeig auf das Postfach, wie bei jeder PN.
--
-- Ein eigener Wert und nicht `invited_to_chat_group`, obwohl der Mechanismus derselbe ist: Es gibt
-- keine Einladung, die jemand annehmen könnte, und eine Zeile, die „hat dich eingeladen" bedeutet,
-- wäre für den nächsten Leser eine falsche Fährte. Gleiches Verhalten, ehrlicher Name.
ALTER TABLE public.notification
    DROP CONSTRAINT notification_subject_matches_type;

ALTER TABLE public.notification
    ADD CONSTRAINT notification_subject_matches_type CHECK (
        CASE type
            WHEN 'broadcast_received'::public.notification_type THEN ((chat_group_id IS NOT NULL) AND (writing_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'blind_date_matched'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'blind_date_reveal_requested'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'blind_date_ended'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'invited_to_writing_group'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'invitation_accepted'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'visibility_changed_in_writing_group'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'role_changed_in_writing_group'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'new_writing_thread'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NOT NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'new_writing_post'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NOT NULL) AND (writing_post_id IS NOT NULL) AND (writing_page_id IS NULL))
            WHEN 'new_writing_page'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NOT NULL))
            WHEN 'invited_to_chat_group'::public.notification_type THEN ((chat_group_id IS NOT NULL) AND (writing_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            ELSE false
        END
    );

-- migrate:down

DELETE FROM public.notification WHERE type = 'broadcast_received';

ALTER TABLE public.notification
    DROP CONSTRAINT notification_subject_matches_type;

ALTER TABLE public.notification
    ADD CONSTRAINT notification_subject_matches_type CHECK (
        CASE type
            WHEN 'blind_date_matched'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'blind_date_reveal_requested'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'blind_date_ended'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'invited_to_writing_group'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'invitation_accepted'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'visibility_changed_in_writing_group'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'role_changed_in_writing_group'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'new_writing_thread'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NOT NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            WHEN 'new_writing_post'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NOT NULL) AND (writing_post_id IS NOT NULL) AND (writing_page_id IS NULL))
            WHEN 'new_writing_page'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NOT NULL))
            WHEN 'invited_to_chat_group'::public.notification_type THEN ((chat_group_id IS NOT NULL) AND (writing_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
            ELSE false
        END
    );
