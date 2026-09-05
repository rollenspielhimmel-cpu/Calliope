-- migrate:up

-- **Rundmails kannten genau einen Weg: E-Mail.**
--
-- Gemeint war etwas anderes. Eine Rundmail ist eine Mitteilung *innerhalb* der Community, und ob
-- sie zusätzlich per E-Mail hinausgeht, ist eine zweite Frage — eine Ankündigung an alle will man
-- oft auch per Mail, gerade für Leute, die selten hereinschauen; eine Notiz an die Administration
-- eher nicht. Also zwei Fragen, zwei Spalten.
--
-- **Zwei Wahrheitswerte statt einer Aufzählung mit drei Werten**, weil es zwei getrennte Wege sind
-- und keine Kopplung. Eine Aufzählung müsste für jeden künftigen Weg jede Kombination neu
-- benennen; zwei Haken bleiben zwei Haken, auch wenn ein dritter dazukommt.
ALTER TABLE public.broadcast
    -- Die Vorgabewerte beschreiben, was mit den *vorhandenen* Zeilen tatsächlich geschah: Sie gingen
    -- per Mail hinaus und landeten in keinem Postfach. Neue Zeilen setzen beides ausdrücklich, das
    -- Formular fragt ja danach — die Vorgabe ist hier nur das Netz darunter.
    ADD COLUMN deliver_to_inbox boolean NOT NULL DEFAULT false,
    ADD COLUMN deliver_by_email boolean NOT NULL DEFAULT true;

-- **Und damit wird aus der Reichweite eine zweite Zahl.**
--
-- `recipient_count` konnte eine sein, solange es einen Weg gab. Jetzt reichen die Wege verschieden
-- weit: Wer seine Adresse nie bestätigt hat, liest sein Postfach, bekommt aber keine Mail. Eine
-- einzelne Zahl müsste sich für eine der beiden Wahrheiten entscheiden und die andere verschweigen.
ALTER TABLE public.broadcast
    ADD COLUMN email_recipient_count integer;

-- Die vorhandenen Zeilen gingen ausschließlich per Mail hinaus. Ihre Zahl ist also die
-- E-Mail-Zahl und war nie eine Postfach-Zahl — sie stehen zu lassen, wo sie stehen, würde für
-- jede alte Rundmail ein Postfach behaupten, das es damals nicht gab.
UPDATE public.broadcast
SET email_recipient_count = recipient_count,
    recipient_count       = NULL
WHERE recipient_count IS NOT NULL;

-- Irgendwo ankommen muss sie. „Nur ins Archiv" ist erlaubt und sinnvoll — ein Hinweis, der im
-- Forum stehen soll, ohne jemanden anzustupsen. „Nirgendwohin" ist keine Entscheidung, sondern ein
-- vergessener Haken, und der soll beim Einreichen auffallen statt beim Nachzählen der Empfänger.
ALTER TABLE public.broadcast
    ADD CONSTRAINT broadcast_arrives_somewhere
        CHECK (deliver_to_inbox OR deliver_by_email OR publish_in_archive);

-- **Das Postfach.**
--
-- Die Benachrichtigungstabelle trägt keinen Text: Sie zeigt auf einen Gegenstand — eine Gruppe,
-- einen Beitrag, eine Seite —, und die Worte entstehen daraus. Eine Rundmail hat aber ihren eigenen
-- Betreff und Text, also zeigt sie auf die Rundmail. Damit bleibt die Tabelle bei ihrem Prinzip,
-- und der Text steht weiterhin an genau einer Stelle.
ALTER TABLE public.notification
    ADD COLUMN broadcast_id uuid
        REFERENCES public.broadcast (id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX notification_broadcast_idx
    ON public.notification (broadcast_id)
    WHERE broadcast_id IS NOT NULL;

-- **Die Bedingung endet auf ELSE false**, und deshalb muss sie hier mit. Ein neuer Typ ohne diese
-- Änderung lässt nicht etwa die Prüfung durch — er lässt *jedes* Einfügen scheitern, und zwar erst
-- beim ersten echten Versand.
--
-- Der vorhandene Teil bleibt Wort für Wort stehen und wird nur eingerahmt: Der neue Fall davor,
-- und für alle anderen die eine zusätzliche Forderung, dass sie auf keine Rundmail zeigen. Das ist
-- länger als eine Neufassung und beim Nachlesen deutlich kürzer.
ALTER TABLE public.notification
    DROP CONSTRAINT notification_subject_matches_type;

ALTER TABLE public.notification
    ADD CONSTRAINT notification_subject_matches_type CHECK (
        CASE type
            WHEN 'broadcast_received'::public.notification_type THEN
                broadcast_id IS NOT NULL
                    AND writing_group_id IS NULL AND chat_group_id IS NULL
                    AND writing_thread_id IS NULL AND writing_post_id IS NULL
                    AND writing_page_id IS NULL
            ELSE broadcast_id IS NULL AND (
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
            )
        END
    );

-- **Der Archiv-Ordner, an einer Kennzeichnung erkannt statt an seinem Titel.**
--
-- Titel werden umbenannt, doppelt vergeben und irgendwann übersetzt; ein Ordner, den der Code über
-- „heißt Ankündigungen" findet, verliert sich beim ersten Umbenennen, und die Rundmail landet
-- danach stillschweigend nirgends. Die Kennzeichnung überlebt das und lässt außerdem zu, später
-- einen anderen Ordner dafür zu bestimmen, ohne Code anzufassen.
--
-- Genau einer, mit demselben Mittel wie beim Ur-Admin: ein teilweiser Eindeutigkeits-Index. Zwei
-- Archive wären keine Einstellung mehr, sondern eine Verlosung.
ALTER TABLE public.writing_folder
    ADD COLUMN is_broadcast_archive boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX writing_folder_one_broadcast_archive_idx
    ON public.writing_folder (is_broadcast_archive)
    WHERE is_broadcast_archive;

-- Der Ordner selbst, im Forum (also ohne Schreibgruppe) und auf oberster Ebene.
--
-- `write`, nicht `read`: Antworten zu können ist das Einzige, was das Archiv kann und das Postfach
-- nicht — sonst wäre es eine zweite Kopie desselben Textes und damit genau die Doppelung, die hier
-- niemand will.
--
-- `created_by` bleibt leer. Der Ordner stammt nicht von einem Menschen, und ihn dem Ur-Admin
-- zuzuschreiben wäre eine Behauptung über jemanden, der ihn nie angelegt hat.
INSERT INTO public.writing_folder
    (writing_group_id, parent_folder_id, depth, title, description, member_permission, is_broadcast_archive)
VALUES
    (NULL, NULL, 1, 'Ankündigungen',
     'Rundmails der Administration, zum Nachlesen und zum Darunterschreiben.',
     'write', true);

-- migrate:down

DELETE FROM public.notification WHERE type = 'broadcast_received';

DELETE FROM public.writing_folder WHERE is_broadcast_archive;

DROP INDEX public.writing_folder_one_broadcast_archive_idx;

ALTER TABLE public.writing_folder
    DROP COLUMN is_broadcast_archive;

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

DROP INDEX public.notification_broadcast_idx;

ALTER TABLE public.notification
    DROP COLUMN broadcast_id;

ALTER TABLE public.broadcast
    DROP CONSTRAINT broadcast_arrives_somewhere;

UPDATE public.broadcast
SET recipient_count = email_recipient_count
WHERE recipient_count IS NULL
  AND email_recipient_count IS NOT NULL;

ALTER TABLE public.broadcast
    DROP COLUMN email_recipient_count,
    DROP COLUMN deliver_to_inbox,
    DROP COLUMN deliver_by_email;
