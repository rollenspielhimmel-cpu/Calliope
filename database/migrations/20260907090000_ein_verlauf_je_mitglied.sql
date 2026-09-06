-- migrate:up

-- **Ein Verlauf je Mitglied und Absender, statt einer je Rundmail.**
--
-- Bisher legte jede Rundmail für jeden Empfänger ein eigenes Gespräch an. Zehn Ankündigungen waren
-- zehn Fäden mit je einer Nachricht, und wer antwortete, antwortete in einem davon. Für das
-- Mitglied war das kein Gespräch, sondern ein Stapel; für die Administration war „was hat diese
-- Person geschrieben" über zehn Orte verteilt.
--
-- Jetzt sammelt sich alles in einem Faden: Ankündigungen, Antworten darauf und später Nachrichten,
-- die jemand von sich aus an die Administration richtet.
--
-- **Je Mitglied *und* Absender, nicht nur je Mitglied.** Eine Rundmail kann unter einer Kunstfigur
-- laufen — „Weihnachtsmann" schreibt am 24. und schweigt sonst. Liefe sie in denselben Faden wie
-- die Nachrichten von „Admin", wechselte für das Mitglied mitten im Verlauf der Gesprächspartner.
-- Und die Regel, die das verhindert — der Absender wird vom Gespräch abgelesen und nicht je
-- Nachricht gewählt —, wäre nicht mehr haltbar: „Unter welchem Namen spreche ich" würde zu einer
-- Entscheidung, die man vergreifen kann.

-- **Die Rundmail hängt jetzt an der Nachricht, nicht am Gespräch.**
--
-- `ON DELETE CASCADE` wie zuvor: Wird eine Rundmail gelöscht, verschwindet ihre Ankündigung. In der
-- laufenden Anwendung passiert das nie — eine Rundmail wird verworfen, nicht gelöscht —, aber die
-- Testläufe räumen ihre Rundmails so ab, und dann sollen die Ankündigungen mitgehen.
ALTER TABLE public.chat_message
    ADD COLUMN broadcast_id uuid
        REFERENCES public.broadcast (id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX chat_message_broadcast_idx
    ON public.chat_message (broadcast_id)
    WHERE broadcast_id IS NOT NULL;

-- **Der Betreff wandert mit.**
--
-- Er war der Titel des Gesprächs, und ein Faden kann nicht zehn Titel tragen. Als eigene Spalte und
-- nicht in den Text geklebt: Die Ansicht soll ihn als Überschrift zeigen können, und ein Betreff,
-- der im Fließtext steht, ist später nicht mehr von ihm zu trennen. Leer bei allem außer den
-- Ankündigungen.
ALTER TABLE public.chat_message
    ADD COLUMN subject text;

-- **Wem das Gespräch gegenübersteht.**
--
-- Die Mitgliedschaft steht in `user_in_chat_group`, und über zwei Tabellen hinweg lässt sich
-- „genau eines je Mitglied und Absender" nicht als Regel festschreiben — nur hoffen. Hier steht es
-- am Gespräch, und der Eindeutigkeits-Index unten macht daraus eine Zusage der Datenbank.
--
-- `ON DELETE SET NULL`, weil das Gespräch sein Mitglied überlebt: Was geschrieben wurde, bleibt
-- lesbar, auch wenn das Konto weg ist.
ALTER TABLE public.chat_group
    ADD COLUMN administration_partner_id uuid
        REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Die Rundmail an die Nachricht: Die Ankündigung ist die erste Nachricht eines alten Gesprächs.
UPDATE public.chat_message m
SET broadcast_id = g.broadcast_id,
    subject      = g.title
FROM public.chat_group g
WHERE g.id = m.chat_group_id
  AND g.broadcast_id IS NOT NULL
  AND m.id = (SELECT min(f.id::text)::uuid
              FROM public.chat_message f
              WHERE f.chat_group_id = g.id);

-- Das Gegenüber aus der Mitgliedschaft. Ein Rundmail-Gespräch hat genau eine.
UPDATE public.chat_group g
SET administration_partner_id = uic.user_id
FROM public.user_in_chat_group uic
WHERE uic.chat_group_id = g.id
  AND g.addressed_to_administration;

-- **Das Verschmelzen.**
--
-- Je Mitglied und Absender überlebt das älteste Gespräch, alle anderen geben ihre Nachrichten ab
-- und verschwinden. Das ist eine Einbahnstraße: Der Rückweg unten stellt die Spalten wieder her,
-- aber nicht die Trennung. Abgesprochen, weil es sich um Testdaten handelt.
CREATE TEMPORARY TABLE merge_target ON COMMIT DROP AS
SELECT g.id                                                    AS old_id,
       min(g.id::text) OVER (PARTITION BY g.administration_partner_id,
           coalesce(g.created_by::text, ''))::uuid             AS keep_id
FROM public.chat_group g
WHERE g.addressed_to_administration
  AND g.administration_partner_id IS NOT NULL;

UPDATE public.chat_message m
SET chat_group_id = t.keep_id
FROM merge_target t
WHERE t.old_id = m.chat_group_id
  AND t.old_id <> t.keep_id;

-- Die Glocke zeigt auf ein Gespräch; sie soll auf das überlebende zeigen statt ins Leere.
UPDATE public.notification n
SET chat_group_id = t.keep_id
FROM merge_target t
WHERE t.old_id = n.chat_group_id
  AND t.old_id <> t.keep_id;

DELETE FROM public.chat_group g
    USING merge_target t
WHERE t.old_id = g.id
  AND t.old_id <> t.keep_id;

-- Der Titel ist nicht mehr der Betreff, sondern der Name, unter dem geschrieben wird. Bleibt
-- stehen, wenn die Kunstfigur später umbenannt wird — das ist selten und beim nächsten Blick zu
-- sehen, während ein Titel, der sich still ändert, niemandem auffällt.
UPDATE public.chat_group g
SET title = coalesce(u.username, 'Administration')
FROM public."user" u
WHERE u.id = g.created_by
  AND g.addressed_to_administration;

-- **Genau eines je Mitglied und Absender.**
--
-- Gespräche ohne Gegenüber fallen heraus: Ist das Konto gelöscht, gibt es nichts mehr zu bündeln,
-- und der überlebende Faden bleibt als Beleg lesbar.
--
-- **Leere Absender zählen als verschieden, und das ist der Punkt.** Hier stand zuerst
-- `NULLS NOT DISTINCT` — der Gedanke war, dass zwei Fäden derselben gelöschten Kunstfigur
-- zusammengehören. Der Testlauf hat das binnen Minuten widerlegt: `created_by` ist
-- `ON DELETE SET NULL`, also *wird* eine Zeile beim Löschen eines Absenderkontos auf leer gesetzt —
-- und traf dabei auf den Faden einer anderen, längst gelöschten Kunstfigur mit demselben Mitglied.
-- Das Löschen eines Kontos scheiterte an einem Index, der Ordnung stiften sollte.
--
-- Ohne die Klausel entsteht dadurch nichts Doppeltes: Angelegt wird ein Faden nur zu einem
-- Absender, den es gibt.
CREATE UNIQUE INDEX chat_group_one_per_partner_and_sender_idx
    ON public.chat_group (administration_partner_id, created_by)
    WHERE addressed_to_administration AND administration_partner_id IS NOT NULL;

DROP INDEX public.chat_group_broadcast_idx;

ALTER TABLE public.chat_group
    DROP COLUMN broadcast_id;

-- migrate:down

ALTER TABLE public.chat_group
    ADD COLUMN broadcast_id uuid
        REFERENCES public.broadcast (id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX chat_group_broadcast_idx
    ON public.chat_group (broadcast_id)
    WHERE broadcast_id IS NOT NULL;

-- Was hier zurückkommt, ist die Spalte, nicht die Trennung: Ein verschmolzener Faden bleibt
-- verschmolzen und trägt die Rundmail seiner ersten Ankündigung.
UPDATE public.chat_group g
SET broadcast_id = (SELECT m.broadcast_id
                    FROM public.chat_message m
                    WHERE m.chat_group_id = g.id
                      AND m.broadcast_id IS NOT NULL
                    ORDER BY m.id
                    LIMIT 1);

DROP INDEX public.chat_group_one_per_partner_and_sender_idx;

ALTER TABLE public.chat_group
    DROP COLUMN administration_partner_id;

DROP INDEX public.chat_message_broadcast_idx;

ALTER TABLE public.chat_message
    DROP COLUMN subject;

ALTER TABLE public.chat_message
    DROP COLUMN broadcast_id;
