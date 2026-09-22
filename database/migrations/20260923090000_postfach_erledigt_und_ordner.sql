-- migrate:up

-- ── Erledigt ────────────────────────────────────────────────────────────────────────────────
--
-- „Offen" fällt weiter aus dem Verlauf heraus: Steht die letzte Nachricht vom Mitglied, hat noch
-- niemand geantwortet. Neu ist, ein Gespräch ohne Antwort erledigt zu nennen — etwa bei einem
-- „Danke".
--
-- **Erledigt bis zu einer Nachricht, nicht erledigt schlechthin.** Gespeichert wird, bis zu welcher
-- Nachricht des Mitglieds es erledigt ist. Schreibt es danach wieder, liegt seine neueste Nachricht
-- dahinter, und das Gespräch ist von selbst wieder offen — ohne dass jemand einen Merker
-- zurücksetzen muss, und ohne dass einer, den man zu setzen vergisst, die Liste lügen lässt.
--
-- Ohne Fremdschlüssel auf die Nachricht: Verglichen wird die Kennung (uuidv7, also zeitlich
-- geordnet), und das geht auch dann noch, wenn die Nachricht selbst weg ist.
ALTER TABLE public.chat_group
    ADD COLUMN inbox_done_through UUID,
    ADD COLUMN inbox_done_by      UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    ADD COLUMN inbox_done_at      TIMESTAMPTZ,
    -- Wer es war, darf später fehlen (Konto gelöscht); bis wohin und wann nicht.
    ADD CONSTRAINT chat_group_inbox_done_is_whole CHECK (
        (inbox_done_through IS NULL) = (inbox_done_at IS NULL)
        AND (inbox_done_through IS NULL OR addressed_to_administration)
        );

-- ── Ordner ──────────────────────────────────────────────────────────────────────────────────
--
-- Zum Aufbewahren, unabhängig von offen oder erledigt: „Wichtig", „Bewerbungen", „Beschwerden".
-- Flach, eine Reihenfolge für alle Admins. Hinein kommen ganze Gespräche oder einzelne Nachrichten.
CREATE TABLE public.inbox_folder
(
    id         UUID PRIMARY KEY     DEFAULT uuidv7(),
    title      TEXT        NOT NULL,
    position   INTEGER     NOT NULL,
    created_by UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT inbox_folder_has_a_title CHECK (btrim(title) <> ''),
    -- Aufgeschoben: Beim Verschieben tauschen zwei Ordner ihre Plätze in einer Transaktion.
    CONSTRAINT inbox_folder_position_unique UNIQUE (position) DEFERRABLE INITIALLY DEFERRED
);

-- Zweimal „Wichtig" wäre zwei Orte für dasselbe, und man sucht im falschen.
CREATE UNIQUE INDEX inbox_folder_title_unique ON public.inbox_folder (lower(btrim(title)));

-- Einsortiert: ein Gespräch oder eine Nachricht, genau eins von beiden. Löschen des Ordners nimmt
-- nur die Einsortierung weg; Gespräch und Nachricht bleiben, wo sie sind.
CREATE TABLE public.inbox_folder_item
(
    id              UUID PRIMARY KEY     DEFAULT uuidv7(),
    inbox_folder_id UUID        NOT NULL REFERENCES public.inbox_folder (id) ON UPDATE CASCADE ON DELETE CASCADE,
    chat_group_id   UUID REFERENCES public.chat_group (id) ON UPDATE CASCADE ON DELETE CASCADE,
    chat_message_id UUID REFERENCES public.chat_message (id) ON UPDATE CASCADE ON DELETE CASCADE,
    added_by        UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT inbox_folder_item_is_one_thing CHECK (num_nonnulls(chat_group_id, chat_message_id) = 1),
    CONSTRAINT inbox_folder_item_conversation_once UNIQUE (inbox_folder_id, chat_group_id),
    CONSTRAINT inbox_folder_item_message_once UNIQUE (inbox_folder_id, chat_message_id)
);

CREATE INDEX inbox_folder_item_folder_idx ON public.inbox_folder_item (inbox_folder_id, added_at);

-- migrate:down

DROP TABLE public.inbox_folder_item;

DROP TABLE public.inbox_folder;

ALTER TABLE public.chat_group
    DROP CONSTRAINT chat_group_inbox_done_is_whole,
    DROP COLUMN inbox_done_at,
    DROP COLUMN inbox_done_by,
    DROP COLUMN inbox_done_through;
