-- migrate:up

-- **Offizielle Threads: außen der Absender, innen der Schreiber, und unsichtbar bis zum Termin.**
--
-- Ein offizieller Thread ist ein Forum-Thread mit einer Veröffentlichung (`publication_id`, seit
-- `unser_forum_raus`). Er wird mit Titel und Eröffnungsbeitrag auf einmal geschrieben, wartet auf
-- Freigabe und Termin wie eine Rundmail und erscheint unter dem gewählten Absender.

-- ── Unsichtbar bis zur Veröffentlichung ─────────────────────────────────────────────────────
--
-- Eine eigene Spalte statt „hat eine Veröffentlichung, die nicht raus ist": Ein Thread, der
-- nachträglich offiziell wird, hat auch eine wartende Veröffentlichung — und steht dabei längst im
-- Forum. Unsichtbar ist nur, was von Anfang an als offizieller Thread geschrieben wurde, bis zu
-- seinem Erscheinen.
ALTER TABLE public.writing_thread
    ADD COLUMN awaiting_release BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Unter welchem Namen es erscheint ────────────────────────────────────────────────────────
--
-- Für Thread und Beitrag gleich gebaut: das angezeigte Konto, wer das so gesetzt hat, und wann.
-- `created_by` bleibt der Schreiber — intern nachvollziehbar, nach außen nie zu sehen.
--
-- **`shown_as_set_at` ist der Merker, nicht `shown_as_user_id`.** Wird das angezeigte Konto
-- gelöscht, wird die Kennung null (`ON DELETE SET NULL`), und ein Beitrag, der nur an ihr hinge,
-- fiele dann auf den Schreiber zurück — genau der Name, der nie erscheinen soll. So bleibt er
-- verdeckt und heißt „gelöschtes Konto". Die Bedingung steht in der Folgerungsform, damit das
-- Löschen sie nicht verletzt.
ALTER TABLE public.writing_thread
    ADD COLUMN shown_as_user_id UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    ADD COLUMN shown_as_set_by  UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    ADD COLUMN shown_as_set_at  TIMESTAMPTZ,
    ADD CONSTRAINT writing_thread_shown_as_has_a_time
        CHECK (shown_as_user_id IS NULL OR shown_as_set_at IS NOT NULL);

ALTER TABLE public.writing_post
    ADD COLUMN shown_as_user_id UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    ADD COLUMN shown_as_set_by  UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    ADD COLUMN shown_as_set_at  TIMESTAMPTZ,
    ADD CONSTRAINT writing_post_shown_as_has_a_time
        CHECK (shown_as_user_id IS NULL OR shown_as_set_at IS NOT NULL);

-- Für das Löschen eines Kontos, das irgendwo angezeigt wird: Die Fremdschlüssel suchen danach.
CREATE INDEX writing_thread_shown_as_idx ON public.writing_thread (shown_as_user_id)
    WHERE shown_as_user_id IS NOT NULL;
CREATE INDEX writing_post_shown_as_idx ON public.writing_post (shown_as_user_id)
    WHERE shown_as_user_id IS NOT NULL;

-- migrate:down

DROP INDEX public.writing_post_shown_as_idx;
DROP INDEX public.writing_thread_shown_as_idx;

ALTER TABLE public.writing_post
    DROP CONSTRAINT writing_post_shown_as_has_a_time,
    DROP COLUMN shown_as_set_at,
    DROP COLUMN shown_as_set_by,
    DROP COLUMN shown_as_user_id;

ALTER TABLE public.writing_thread
    DROP CONSTRAINT writing_thread_shown_as_has_a_time,
    DROP COLUMN shown_as_set_at,
    DROP COLUMN shown_as_set_by,
    DROP COLUMN shown_as_user_id,
    DROP COLUMN awaiting_release;
