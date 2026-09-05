-- migrate:up

-- **Eine Rundmail ist eine Nachricht, also gehört sie ins Postfach.**
--
-- Der erste Anlauf hängte sie an die Glocke und gab ihr eine eigene Leseseite. Das war ein Ort, den
-- man ansteuern muss — und genau das tut niemand. Sie kommt jetzt als vollständige Nachricht dort
-- an, wo Mitglieder ohnehin nachsehen: im gewöhnlichen Postfach, mit Betreff und ganzem Text.
--
-- **Ein Gespräch je Empfänger, und darin sitzt nur das Mitglied.**
--
-- Das ist der ganze Trick. Ohne Zeile in `user_in_chat_group` taucht das Gespräch beim Absender
-- nirgends auf — weder beim Ur-Admin, in dessen Postfach niemand sieht, noch bei einer Kunstfigur
-- wie dem Weihnachtsmann. Die Nachricht trägt trotzdem seinen Namen, weil `chat_message.created_by`
-- auf sein Konto zeigt. Das Team liest die Antworten nicht über ein Postfach, sondern über die
-- Rundmail — dafür ist diese Spalte da.
--
-- Der Preis ist die Zahl: Hundert Mitglieder sind hundert Gespräche. Das ist der Preis dafür, dass
-- niemand die Antwort eines anderen sieht; ein gemeinsamer Chat wäre eine Rundmail, auf die alle
-- allen antworten.
ALTER TABLE public.chat_group
    ADD COLUMN broadcast_id uuid
        REFERENCES public.broadcast (id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX chat_group_broadcast_idx
    ON public.chat_group (broadcast_id)
    WHERE broadcast_id IS NOT NULL;

-- **Wer wirklich geschrieben hat, wenn `created_by` eine Maske ist.**
--
-- Nach außen trägt auch die *Antwort* der Administration den gewählten Absender — sonst stünde
-- mitten im Verlauf plötzlich ein echter Name, und die Maskerade wäre für eine Antwort dahin.
-- Intern muss trotzdem festgehalten sein, wer getippt hat.
--
-- Dieselbe Trennung, die `publication` mit `send_as_user_id` und `written_by` schon macht, hier
-- nachgebaut statt neu erfunden. Leer bei jeder gewöhnlichen Nachricht: Dort ist `created_by` keine
-- Maske, sondern die Wahrheit.
ALTER TABLE public.chat_message
    ADD COLUMN written_by uuid
        REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- **Ein Archiv-Faden, nicht einer je Rundmail.**
--
-- Der erste Anlauf legte für jede Rundmail einen eigenen Faden an. Wer als neues Mitglied
-- nachlesen will, was es je gab, findet dann eine Liste von Fäden und muss jeden einzeln öffnen —
-- statt einmal von oben nach unten zu lesen. Jede Rundmail wird jetzt ein weiterer Beitrag in
-- einem Faden, und der Faden ist das Archiv.
--
-- Erkannt an einer Kennzeichnung, aus demselben Grund wie der Ordner: Titel werden umbenannt, und
-- ein Faden, den der Code über seinen Namen findet, verliert sich beim ersten Umbenennen. Genau
-- einer, mit demselben teilweisen Eindeutigkeits-Index.
ALTER TABLE public.writing_thread
    ADD COLUMN is_broadcast_archive boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX writing_thread_one_broadcast_archive_idx
    ON public.writing_thread (is_broadcast_archive)
    WHERE is_broadcast_archive;

-- **Gelesen, nicht beschrieben.** Der vorige Stand stellte Ordner und Faden auf `write`, weil
-- Antworten damals das Einzige war, was das Archiv konnte und das Postfach nicht. Das hat sich
-- umgedreht: Geantwortet wird auf die Rundmail im Postfach, und das Archiv ist zum Nachlesen da.
-- Eine Antwort mitten in der Sammlung würde die Reihenfolge zerreißen, die sie lesbar macht.
UPDATE public.writing_folder
SET member_permission = 'read'
WHERE is_broadcast_archive;

INSERT INTO public.writing_thread
    (writing_group_id, folder_id, title, member_permission, is_broadcast_archive)
SELECT NULL, id, 'Rundmails', 'read', true
FROM public.writing_folder
WHERE is_broadcast_archive;

-- Was durch den ersten Anlauf schon entstanden ist, wird eingesammelt statt weggeworfen: Die
-- Beiträge wandern in den einen Faden, ihre Kennungen bleiben, und damit auch ihre Reihenfolge und
-- jeder Verweis aus `broadcast.archive_post_id`. Danach sind die alten Fäden leer und gehen.
UPDATE public.writing_post
SET writing_thread_id = (SELECT id FROM public.writing_thread WHERE is_broadcast_archive)
WHERE writing_thread_id IN (
    SELECT thread.id
    FROM public.writing_thread AS thread
    JOIN public.writing_folder AS folder ON folder.id = thread.folder_id
    WHERE folder.is_broadcast_archive
      AND NOT thread.is_broadcast_archive
);

DELETE FROM public.writing_thread AS thread
USING public.writing_folder AS folder
WHERE folder.id = thread.folder_id
  AND folder.is_broadcast_archive
  AND NOT thread.is_broadcast_archive;

-- **Der Rückbau des ersten Anlaufs.**
--
-- Die Zeilen zuerst: Die wiederhergestellte Bedingung endet auf `ELSE false`, und jede verbliebene
-- Rundmail-Zeile würde sie verletzen.
--
-- Und die Bedingung **vor** der Spalte, nicht danach. Eine Spalte zu löschen nimmt jede Bedingung
-- mit, die sie nennt — das `DROP CONSTRAINT` lief hier erst ins Leere, weil PostgreSQL die Arbeit
-- schon erledigt hatte.
--
-- Der Aufzählungswert `broadcast_received` bleibt stehen. PostgreSQL kennt kein DROP VALUE, und
-- eine Aufzählung neu zu bauen hieße, jede Fremdbeziehung darauf anzufassen — viel Risiko für einen
-- Eintrag, den niemand mehr schreibt.
DELETE FROM public.notification WHERE type = 'broadcast_received';

ALTER TABLE public.notification
    DROP CONSTRAINT notification_subject_matches_type;

DROP INDEX public.notification_broadcast_idx;

ALTER TABLE public.notification
    DROP COLUMN broadcast_id;

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

-- migrate:down

ALTER TABLE public.notification
    ADD COLUMN broadcast_id uuid
        REFERENCES public.broadcast (id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX notification_broadcast_idx
    ON public.notification (broadcast_id)
    WHERE broadcast_id IS NOT NULL;

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

-- Der eine Faden geht, die Beiträge darin nicht: Sie werden gelöscht, weil ihre Fäden sich nicht
-- rekonstruieren lassen — welcher Beitrag zu welcher Rundmail gehörte, steht in
-- `broadcast.archive_post_id`, und daraus einen Faden je Rundmail zurückzubauen wäre eine
-- Vermutung. Wer diese Migration zurücknimmt, hat das Archiv leer und die Rundmails vollständig;
-- neu abgelegt wird es beim nächsten Versand.
DELETE FROM public.writing_thread WHERE is_broadcast_archive;

DROP INDEX public.writing_thread_one_broadcast_archive_idx;

ALTER TABLE public.writing_thread
    DROP COLUMN is_broadcast_archive;

UPDATE public.writing_folder
SET member_permission = 'write'
WHERE is_broadcast_archive;

ALTER TABLE public.chat_message
    DROP COLUMN written_by;

DROP INDEX public.chat_group_broadcast_idx;

-- Die Gespräche selbst bleiben stehen. Sie sind echte Nachrichten in echten Postfächern, und wer
-- eine Migration zurücknimmt, will die Post der Mitglieder nicht mitlöschen.
ALTER TABLE public.chat_group
    DROP COLUMN broadcast_id;
