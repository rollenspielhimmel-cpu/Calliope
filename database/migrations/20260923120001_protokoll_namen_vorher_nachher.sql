-- migrate:up

-- Was zu den beiden neuen Arten gehört: die Namen, und wer einen Grund braucht.
ALTER TABLE public.official_revision
    ADD COLUMN name_before TEXT,
    ADD COLUMN name_after  TEXT;

-- **Ein Grund wird verlangt, wo jemand etwas ändert — nicht, wo die Freigabe selbst der Vorgang
-- ist.** Für „offiziell gemacht" gibt es keinen Grund einzutippen: Der Vorgang ist die Einreichung,
-- und wer und wann steht daneben. Alles andere bleibt begründungspflichtig.
ALTER TABLE public.official_revision
    ALTER COLUMN reason DROP NOT NULL;

ALTER TABLE public.official_revision
    DROP CONSTRAINT official_revision_has_a_reason;

ALTER TABLE public.official_revision
    ADD CONSTRAINT official_revision_has_a_reason CHECK (
        kind = 'made_official' OR (reason IS NOT NULL AND btrim(reason) <> '')
        );

ALTER TABLE public.official_revision
    DROP CONSTRAINT official_revision_says_what_changed;

ALTER TABLE public.official_revision
    ADD CONSTRAINT official_revision_says_what_changed CHECK (
        CASE kind
            WHEN 'title_changed' THEN title_before IS NOT NULL AND title_after IS NOT NULL
            WHEN 'post_edited' THEN text_before IS NOT NULL AND text_after IS NOT NULL
            WHEN 'post_deleted' THEN text_before IS NOT NULL AND text_after IS NULL
            -- Der Name, unter dem er erscheint. Vorher steht nur da, wo vorher ein anderer stand:
            -- bei einem Thread, der schon im Forum war.
            WHEN 'made_official' THEN name_after IS NOT NULL
            WHEN 'unmade_official' THEN name_before IS NOT NULL
            ELSE FALSE
            END
        );

-- migrate:down

DELETE FROM public.official_revision WHERE kind IN ('made_official', 'unmade_official');

ALTER TABLE public.official_revision
    DROP CONSTRAINT official_revision_says_what_changed,
    DROP CONSTRAINT official_revision_has_a_reason,
    DROP COLUMN name_before,
    DROP COLUMN name_after;

ALTER TABLE public.official_revision
    ALTER COLUMN reason SET NOT NULL,
    ADD CONSTRAINT official_revision_has_a_reason CHECK (btrim(reason) <> ''),
    ADD CONSTRAINT official_revision_says_what_changed CHECK (
        CASE kind
            WHEN 'title_changed' THEN title_before IS NOT NULL AND title_after IS NOT NULL
            WHEN 'post_edited' THEN text_before IS NOT NULL AND text_after IS NOT NULL
            WHEN 'post_deleted' THEN text_before IS NOT NULL AND text_after IS NULL
            ELSE FALSE
            END
        );

