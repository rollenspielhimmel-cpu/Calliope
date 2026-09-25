-- migrate:up

-- ── Löschen heißt: für die Lesenden weg, für die Moderation da ──────────────────────────────
--
-- **Der Fall, für den das Protokoll da ist:** Jemand schreibt etwas, zieht es zurück und
-- behauptet später, es nie getan zu haben. Ohne Aufzeichnung steht Aussage gegen Aussage.
--
-- Dasselbe Muster wie beim Protokoll der offiziellen Threads (`official_revision`), und aus
-- demselben Grund stehen die Namen hier als **Text** und nicht als Verweis: Ein Protokoll hält
-- fest, was war. Es soll sich nicht mitändern, und es muss ein gelöschtes Konto überleben.
CREATE TYPE public.status_deletion_kind AS ENUM ('status_update', 'comment');

CREATE TABLE public.status_update_deletion
(
    id                  UUID PRIMARY KEY     DEFAULT uuidv7(),
    kind                public.status_deletion_kind NOT NULL,

    -- Ohne Fremdschlüssel: Die Meldung ist im Moment des Eintrags schon weg, und der Kommentar
    -- kann es später werden. Die Kennungen stehen trotzdem da, damit sich zusammenlesen lässt,
    -- was zu einem Strang gehörte.
    status_update_id    UUID                        NOT NULL,
    comment_id          UUID,

    body                TEXT                        NOT NULL,

    written_by          UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    written_by_username TEXT                        NOT NULL,
    written_at          TIMESTAMPTZ                 NOT NULL,

    deleted_by          UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    deleted_by_username TEXT                        NOT NULL,
    deleted_at          TIMESTAMPTZ                 NOT NULL DEFAULT now(),

    -- **Wer gelöscht hat, ändert, was dort steht.** „Kommentar gelöscht." heißt: Jemand hat sein
    -- eigenes Wort zurückgenommen. „Kommentar durch Rollenspielhimmel gelöscht." heißt: Die
    -- Plattform hat eingegriffen. Wer das verwechselt, hält Moderation für Reue — oder umgekehrt.
    by_moderation       BOOLEAN                     NOT NULL,
    reason              TEXT,

    -- Ein Kommentar hat eine Kennung, eine Meldung nicht — sie *ist* die Meldung.
    CONSTRAINT status_update_deletion_kind_matches_subject CHECK (
        CASE kind
            WHEN 'comment'::public.status_deletion_kind THEN comment_id IS NOT NULL
            ELSE comment_id IS NULL
            END
        ),

    -- Einen Grund gibt an, wer fremdes Wort entfernt. Das eigene begründet niemand.
    CONSTRAINT status_update_deletion_reason_only_from_moderation CHECK (
        reason IS NULL OR by_moderation
        )
);

COMMENT ON TABLE public.status_update_deletion IS
    'Was in den Statusmeldungen gelöscht wurde: Wortlaut, von wem er war, wer gelöscht hat. Nur die Moderation liest es.';

-- Das Protokoll wird neueste zuerst gelesen, und nur so.
CREATE INDEX status_update_deletion_deleted_at_idx
    ON public.status_update_deletion (deleted_at DESC);


-- ── Ein Kommentar verschwindet nicht, er wird leer ──────────────────────────────────────────
--
-- **Weich gelöscht, anders als eine Meldung.** An seiner Stelle steht „Kommentar gelöscht.", und
-- Antworten, die ihn zitieren, behalten ihren Anker — ein Zitat ohne Bezug wäre plötzlich sinnlos.
-- Eine ganze Meldung darf dagegen hart weg: Ihre Kommentare gehen ohnehin mit, und der Wortlaut
-- von allem liegt im Protokoll.
ALTER TABLE public.status_update_comment
    ADD COLUMN deleted_at            TIMESTAMPTZ,
    ADD COLUMN deleted_by_moderation BOOLEAN NOT NULL DEFAULT false,

    -- Von der Moderation gelöscht setzt gelöscht voraus.
    ADD CONSTRAINT status_update_comment_deleted_is_whole CHECK (
        deleted_at IS NOT NULL OR NOT deleted_by_moderation
        );

COMMENT ON COLUMN public.status_update_comment.deleted_at IS
    'Gesetzt heißt: Der Text ist weg, die Zeile bleibt. Zitate darauf behalten ihren Anker.';

-- migrate:down

ALTER TABLE public.status_update_comment
    DROP CONSTRAINT status_update_comment_deleted_is_whole,
    DROP COLUMN deleted_by_moderation,
    DROP COLUMN deleted_at;

DROP TABLE public.status_update_deletion;

DROP TYPE public.status_deletion_kind;
