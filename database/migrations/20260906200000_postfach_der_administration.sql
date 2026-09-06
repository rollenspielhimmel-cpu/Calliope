-- migrate:up

-- **An wen ein Gespräch gerichtet ist, ist eine Tatsache über das Gespräch.**
--
-- Die Antworten auf Rundmails liegen bisher je Rundmail vor: Wer wissen will, ob etwas
-- zurückgekommen ist, muss Rundmail für Rundmail nachsehen. Das Postfach der Administration ist
-- der eine Ort dafür — und später auch für Nachrichten, die jemand einfach so an die
-- Administration schreibt.
--
-- **Warum eine Spalte und keine Ableitung.** Naheliegend wäre gewesen: Ein Gespräch gehört ins
-- Postfach, wenn der Ur-Admin darin sitzt. Das stimmt aber schon heute nicht — bei einer Rundmail
-- sitzt die Plattformseite mit Absicht *nicht* im Gespräch, damit niemand versehentlich
-- hineinschreibt oder es verlässt. Und selbst wenn: Eine Ableitung über die Mitgliedschaft hiesse,
-- dass ein Gespräch das Postfach in dem Moment verlässt, in dem jemand austritt. Das ist genau die
-- Art Fehler, die ein halbes Jahr niemand bemerkt.
--
-- Entschieden wird es einmal, beim Entstehen des Gesprächs, und danach steht es fest.
ALTER TABLE public.chat_group
    ADD COLUMN addressed_to_administration boolean NOT NULL DEFAULT false;

-- Jede Rundmail-Zustellung ist eine Nachricht der Plattform an ein Mitglied, und eine Antwort
-- darauf geht an die Administration. Rückwirkend gesetzt, damit das Postfach nicht leer beginnt
-- und die Antworten, die es schon gibt, nicht unsichtbar werden.
UPDATE public.chat_group
SET addressed_to_administration = true
WHERE broadcast_id IS NOT NULL;

-- Teilweise, weil die Frage immer „welche gehören ins Postfach" lautet und nie „welche nicht":
-- Die allermeisten Gespräche der Plattform sind private Chats zwischen Mitgliedern, und die stehen
-- so gar nicht erst im Index.
CREATE INDEX chat_group_administration_idx
    ON public.chat_group (addressed_to_administration, last_activity_at DESC)
    WHERE addressed_to_administration;

-- migrate:down

DROP INDEX public.chat_group_administration_idx;

ALTER TABLE public.chat_group
    DROP COLUMN addressed_to_administration;
