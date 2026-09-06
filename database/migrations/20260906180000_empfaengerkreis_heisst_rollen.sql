-- migrate:up

-- **„Gruppe" ist hier schon vergeben.**
--
-- Eine Gruppe ist auf dieser Plattform eine Schreibgruppe — der Ort, an dem Leute zusammen
-- schreiben. `audience_groups` meint aber etwas ganz anderes: die Rollen, nach denen ein
-- Empfängerkreis gebildet wird, Administration, Moderation, Mitglieder ohne Rolle.
--
-- Das ist keine Kosmetik. Wer „Rundmail an Gruppen" liest, fragt sich, ob eine Schreibgruppe
-- angeschrieben werden kann — und muss zweimal lesen, um zu merken, dass nein. Genau so ist es
-- passiert, und es wird dem Nächsten wieder passieren.
--
-- Nur der Name ändert sich. Die Werte sind dieselben, die Spalte bleibt `TEXT[]`, und weil ein
-- `RENAME COLUMN` weder Daten anfasst noch Zeit braucht, ist das der ganze Vorgang.
ALTER TABLE public.broadcast
    RENAME COLUMN audience_groups TO audience_roles;

-- migrate:down

ALTER TABLE public.broadcast
    RENAME COLUMN audience_roles TO audience_groups;
