-- migrate:up

-- **Rundmails an ausdrücklich genannte Mitglieder, neben den Gruppen.**
--
-- Bisher ging eine Rundmail an Gruppen — Administration, Moderation, Mitglieder ohne Rolle. Das
-- deckt „an alle" und „ans Team" ab, aber nicht den Fall, den es genauso gibt: an Mod X, User Z,
-- User B und Mod A, weil die vier zusammen etwas angeht.
--
-- **Beides zugleich, nicht entweder/oder.** Der Empfängerkreis ist die Vereinigung aus den Gruppen
-- und den Namen; wer eine Gruppe wählt und zusätzlich jemanden nennt, erreicht beide. Doppelt
-- genannt wird niemand — das entscheidet der Dienst beim Zusammenstellen, nicht diese Tabelle.
--
-- **Eine eigene Tabelle und kein zweites Textfeld.** `audience_groups` ist `TEXT[]`, weil die
-- Datenbank den Empfängerbegriff nicht kennt und die drei Gruppennamen erfunden sind. Ein Konto
-- dagegen ist eine Zeile, die es wirklich gibt: Es kann gelöscht werden, und dann soll die
-- Rundmail nicht auf eine Kennung zeigen, hinter der niemand mehr steht.
CREATE TABLE public.broadcast_recipient (
    broadcast_id uuid NOT NULL
        REFERENCES public.broadcast (id) ON UPDATE CASCADE ON DELETE CASCADE,
    user_id uuid NOT NULL
        REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE CASCADE,
    PRIMARY KEY (broadcast_id, user_id)
);

-- Für die eine Frage, die dagegen läuft: „wer steht bei dieser Rundmail namentlich drin".
CREATE INDEX broadcast_recipient_user_idx ON public.broadcast_recipient (user_id);

-- **Gelöscht statt auf leer gesetzt**, anders als bei `written_by`.
--
-- Die Spur, wer eine Rundmail verantwortet, soll ihren Verfasser überleben — deshalb steht dort
-- `ON DELETE SET NULL`. Hier ist es umgekehrt: Ein Empfänger, der sein Konto löscht, ist kein
-- Empfänger mehr, und eine Zeile ohne Konto wäre keine Auskunft, sondern ein Rest. Was tatsächlich
-- rausging, steht ohnehin in `recipient_count`, und das ist eine Zahl und kein Verweis.

-- migrate:down

DROP TABLE public.broadcast_recipient;
