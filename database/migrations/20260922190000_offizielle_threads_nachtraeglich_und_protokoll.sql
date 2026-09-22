-- migrate:up

-- ── Nachträglich offiziell ───────────────────────────────────────────────────────────────────
--
-- Eine Veröffentlichung für einen Thread, der schon im Forum steht. Sie tauscht nur den Namen am
-- Eröffnungsbeitrag, bis zur Freigabe bleibt der eigene stehen — anders als eine, mit der ein
-- offizieller Thread geschrieben wird und bis zum Erscheinen unsichtbar ist. Die beiden sehen in
-- der Warteschlange gleich aus und verhalten sich beim Freigeben verschieden; deshalb steht es hier
-- und wird nicht aus Zeitstempeln geraten.
ALTER TABLE public.publication
    ADD COLUMN for_existing_thread BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Das Protokoll ───────────────────────────────────────────────────────────────────────────
--
-- **Eine freigegebene Aussage ändert sich nicht unbemerkt.** Jede Änderung an einem offiziellen
-- Thread nach seinem Erscheinen — Überschrift, Text, Löschen des Beitrags — steht hier: wer, wann,
-- warum, und was vorher und nachher dastand. Ändern dürfen das nur Administrationen, lesen auch.
--
-- Thread und Beitrag mit `ON DELETE SET NULL`: Das Protokoll eines gelöschten Beitrags ist genau
-- das, was nach dem Löschen noch zählt. Deshalb steht der Thread daneben, und der gelöschte Text
-- in der Zeile selbst.
CREATE TYPE public.official_revision_kind AS ENUM ('title_changed', 'post_edited', 'post_deleted');

CREATE TABLE public.official_revision
(
    id                UUID PRIMARY KEY            DEFAULT uuidv7(),
    kind              public.official_revision_kind NOT NULL,
    writing_thread_id UUID REFERENCES public.writing_thread (id) ON UPDATE CASCADE ON DELETE SET NULL,
    writing_post_id   UUID REFERENCES public.writing_post (id) ON UPDATE CASCADE ON DELETE SET NULL,
    edited_by         UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    edited_at         TIMESTAMPTZ NOT NULL        DEFAULT now(),
    reason            TEXT        NOT NULL,

    title_before      TEXT,
    title_after       TEXT,
    text_before       TEXT,
    text_after        TEXT,
    document_before   JSONB,
    document_after    JSONB,

    CONSTRAINT official_revision_has_a_reason CHECK (btrim(reason) <> ''),

    -- Was eine Art festhält, steht auch da. Die Kennungen dürfen später null werden (siehe oben);
    -- der Inhalt nie.
    CONSTRAINT official_revision_says_what_changed CHECK (
        CASE kind
            WHEN 'title_changed' THEN title_before IS NOT NULL AND title_after IS NOT NULL
            WHEN 'post_edited' THEN text_before IS NOT NULL AND text_after IS NOT NULL
            WHEN 'post_deleted' THEN text_before IS NOT NULL AND text_after IS NULL
            ELSE FALSE
            END
        )
);

-- Die Ansicht liest das Protokoll eines Threads, die neuesten zuerst.
CREATE INDEX official_revision_thread_idx ON public.official_revision (writing_thread_id, edited_at);

-- migrate:down

DROP TABLE public.official_revision;

DROP TYPE public.official_revision_kind;

ALTER TABLE public.publication
    DROP COLUMN for_existing_thread;
