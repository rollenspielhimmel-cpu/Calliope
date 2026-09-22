-- migrate:up

-- **Ein Faden für Test-Rundmails, je Person und Absender.**
--
-- Eine Test-Rundmail zeigt der Person, die den Knopf drückt, wie die Rundmail ankommen wird — und
-- nur ihr. Sie gehört deshalb **nicht** in den echten Faden zwischen dieser Person und dem
-- Absender: Der steht im Postfach der Administration, alle Admins lesen seinen Verlauf, und eine
-- Nachricht dort würde eine offene Frage derselben Person still schließen. Also ein eigener Faden,
-- gekennzeichnet, damit er sich anders benimmt:
--
-- - nicht im Postfach der Administration (`addressed_to_administration` bleibt aus, und die
--   Bedingung unten stellt sicher, dass beides nie zusammenkommt);
-- - niemand lässt sich einladen — sonst läse jemand anderes eine Test-Rundmail;
-- - verlassen darf man ihn, anders als einen echten Rundmail-Faden: Er ist ein Werkzeug, kein
--   Gespräch, und soll sich nicht ansammeln.
--
-- `administration_partner_id` trägt hier die testende Person — dieselbe Rolle wie im echten Faden,
-- das Gegenüber des Absenders.
ALTER TABLE public.chat_group
    ADD COLUMN is_test_broadcast boolean NOT NULL DEFAULT false;

ALTER TABLE public.chat_group
    ADD CONSTRAINT chat_group_test_is_not_for_the_administration
        CHECK (NOT (is_test_broadcast AND addressed_to_administration));

-- Einer je Person und Absender, damit wiederholtes Testen denselben Faden füllt statt einen Stapel
-- anzulegen. Dieselbe Form wie `chat_group_one_per_partner_and_sender_idx`, und aus demselben Grund
-- ohne `NULLS NOT DISTINCT`: Ein gelöschtes Konto soll hier nichts festhalten.
CREATE UNIQUE INDEX chat_group_one_test_per_partner_and_sender_idx
    ON public.chat_group (administration_partner_id, created_by)
    WHERE is_test_broadcast AND administration_partner_id IS NOT NULL;

-- migrate:down

DROP INDEX public.chat_group_one_test_per_partner_and_sender_idx;

ALTER TABLE public.chat_group
    DROP CONSTRAINT chat_group_test_is_not_for_the_administration;

-- Test-Fäden werden damit zu gewöhnlichen Gesprächen. Sie zu löschen wäre ehrlicher, aber ein
-- Rückweg, der Zeilen löscht, ist keiner, den man gern aus Versehen fährt.
ALTER TABLE public.chat_group
    DROP COLUMN is_test_broadcast;
