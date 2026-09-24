-- migrate:up

-- ── Die Mitteilung selbst ───────────────────────────────────────────────────────────────────
ALTER TABLE public.notification
    ADD COLUMN status_update_id UUID REFERENCES public.status_update (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    -- **Wie viele Kommentare seit dem letzten Hinsehen.**
    --
    -- Zusammengefasst wird beim *Schreiben*, nicht beim Lesen: Eine Zeile je Empfänger und
    -- Meldung, deren Zähler hochgeht, statt zwanzig Zeilen, die die Liste beim Anzeigen
    -- zusammenfasst. Der Grund ist das Blättern — die Liste kommt seitenweise, und eine Gruppe,
    -- die über eine Seitengrenze fällt, ließe sich beim Lesen nicht mehr richtig zusammenlegen.
    -- So stimmt außerdem die Zahl am Glockensymbol von selbst: Sie zählt Zeilen, und eine Zeile
    -- ist jetzt eine Mitteilung.
    --
    -- Für alle anderen Arten ist er 1 und bedeutet nichts.
    ADD COLUMN new_comment_count INTEGER NOT NULL DEFAULT 1
        CONSTRAINT notification_new_comment_count_is_positive CHECK (new_comment_count >= 1);

COMMENT ON COLUMN public.notification.new_comment_count IS
    'Wie viele Kommentare seit dem letzten Lesen dazugekommen sind. Nur bei status_update_commented von Bedeutung.';

-- Der Weg, auf dem die Zusammenfassung stattfindet: Trifft ein Kommentar auf eine Zeile, die es
-- schon gibt, geht ihr Zähler hoch, statt dass eine zweite entsteht.
CREATE UNIQUE INDEX notification_one_per_status_update_idx
    ON public.notification (recipient_id, status_update_id)
    WHERE type = 'status_update_commented';

ALTER TABLE public.notification
    DROP CONSTRAINT notification_subject_matches_type;

ALTER TABLE public.notification
    ADD CONSTRAINT notification_subject_matches_type CHECK (
        CASE type
            WHEN 'status_update_commented'::public.notification_type THEN
                status_update_id IS NOT NULL
                    AND writing_group_id IS NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                    AND writing_page_id IS NULL
            ELSE status_update_id IS NULL AND (
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
            )
        END
        );


-- ── Der Schalter mit drei Stellungen ────────────────────────────────────────────────────────
--
-- **Nichts eingetragen heißt: die Regel gilt.** Mitteilungen bekommt, wer die Meldung geschrieben
-- hat, und jede und jeder, die darunter kommentiert haben. Das deckt den gewöhnlichen Fall ab,
-- ohne dass irgendwer etwas einstellen muss.
--
-- Die Tabelle ist für die beiden Ausnahmen davon, und sie zeigen in beide Richtungen:
--
-- * **Ruhe.** „Ich kommentiere, wir schreiben kurz hin und her, dann folgen 76 weitere
--   Kommentare, die mich nicht interessieren" — dann für *diese* eine Meldung nichts mehr, ohne
--   alle Mitteilungen abzuschalten.
-- * **Mitlesen.** Wer nichts geschrieben hat, aber unbedingt wissen will, was noch dazukommt.
--
-- Ein Ja/Nein statt bloßer Anwesenheit: Anwesenheit allein könnte nur eines von beidem.
CREATE TABLE public.status_update_subscription
(
    user_id          UUID        NOT NULL REFERENCES public."user" (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    status_update_id UUID        NOT NULL REFERENCES public.status_update (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    subscribed       BOOLEAN     NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, status_update_id)
);

COMMENT ON TABLE public.status_update_subscription IS
    'Ausdrücklich an oder aus für eine einzelne Statusmeldung. Keine Zeile heißt: die Regel gilt.';

-- Für den Weg, den das Verschicken geht: Wer will zu dieser Meldung etwas hören, wer nicht.
CREATE INDEX status_update_subscription_status_update_id_idx
    ON public.status_update_subscription (status_update_id);

-- migrate:down

DROP TABLE public.status_update_subscription;

DROP INDEX public.notification_one_per_status_update_idx;

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

ALTER TABLE public.notification
    DROP COLUMN new_comment_count,
    DROP COLUMN status_update_id;
