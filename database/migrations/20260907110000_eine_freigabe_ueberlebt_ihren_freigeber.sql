-- migrate:up

-- **Ein Konto, das je eine Rundmail freigegeben hat, ließ sich nicht mehr löschen.**
--
-- `approved_by` ist `ON DELETE SET NULL` — die Freigabe soll ihren Freigeber überleben, so wie
-- `written_by` seinen Verfasser. Die Bedingung verlangte aber beide Spalten oder keine:
--
--     (approved_by IS NULL) = (approved_at IS NULL)
--
-- Beim Löschen setzt PostgreSQL `approved_by` auf leer, `approved_at` bleibt stehen — und das
-- Löschen läuft in die eigene Bedingung. Nicht theoretisch: an der Datenbank nachgestellt, das
-- `DELETE` scheitert mit genau dieser Meldung. Getroffen hätte es jede Kontolöschung eines
-- Administrators, der einmal etwas freigegeben hat.
--
-- **Die Gleichheit ist die falsche Form, nicht die Idee.** Gemeint war: „freigegeben von niemandem"
-- soll es nicht geben. Gleichheit ist aber symmetrisch und verbietet damit auch den Zustand, den
-- das Löschen erzeugt — eine Freigabe, deren Name weg ist. Die Folgerung sagt dasselbe in der
-- richtigen Richtung: Wo ein Freigeber steht, muss auch ein Zeitpunkt stehen.
--
-- Dieselbe Form wie überall sonst im Schema: `blind_date_pair_ended_by_needs_an_ending`,
-- `writing_post_editor_needs_time`, `writing_group_next_step_completer_needs_time` und
-- `publication_edit_has_a_time` sind alle so gebaut. Diese eine war die Ausnahme.
--
-- Was die Warteschlange betrifft, ändert sich nichts: Sie fragt nach `status`, und
-- `publication_released_was_approved` prüft `approved_at`, nicht den Namen.
ALTER TABLE public.publication
    DROP CONSTRAINT publication_approval_is_whole;

ALTER TABLE public.publication
    ADD CONSTRAINT publication_approval_has_a_time CHECK (
        approved_by IS NULL OR approved_at IS NOT NULL
        );

-- migrate:down

ALTER TABLE public.publication
    DROP CONSTRAINT publication_approval_has_a_time;

ALTER TABLE public.publication
    ADD CONSTRAINT publication_approval_is_whole CHECK (
        (approved_by IS NULL) = (approved_at IS NULL)
        );
