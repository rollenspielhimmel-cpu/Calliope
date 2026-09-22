-- migrate:up

-- **Eine versendete Rundmail lässt sich zurückziehen — vom Ur-Admin, und nur der Inhalt geht.**
--
-- Was bleibt, ist, wer wann zurückgezogen hat. Der Wortlaut bleibt nirgends, auch nicht intern und
-- auch nicht der Betreff: Zurückgezogen wird meist, weil der Text weg *muss* — an die Falschen
-- gegangen, etwas Persönliches darin. Ihn intern aufzuheben, widerspräche genau dem.
--
-- **Der Zustand bleibt `released`.** Sie *wurde* versendet, und die Mails sind draußen; ein Zustand
-- „zurückgezogen" stattdessen behauptete, sie sei nie rausgegangen. Das Zurückziehen ist ein
-- Nachtrag daneben.
--
-- **Die Folgerungsform, nicht die Gleichheit.** `retracted_by` wird beim Löschen des Kontos leer,
-- `retracted_at` bleibt. Gleichheit verböte genau das, und das Konto wäre unlöschbar — dieselbe
-- Falle wie einst `publication_approval_is_whole`.
ALTER TABLE public.publication
    ADD COLUMN retracted_by uuid
        REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    ADD COLUMN retracted_at timestamptz;

ALTER TABLE public.publication
    ADD CONSTRAINT publication_retraction_has_a_time
        CHECK (retracted_by IS NULL OR retracted_at IS NOT NULL);

-- Zurückziehen lässt sich nur, was draußen ist. Was noch wartet, wird verworfen, nicht zurückgezogen.
ALTER TABLE public.publication
    ADD CONSTRAINT publication_retracted_was_released
        CHECK (retracted_at IS NULL OR status = 'released');

-- Ein Fremdschlüssel, der beim Löschen etwas tut, braucht seinen eigenen Index — sonst sucht jedes
-- Löschen eines Kontos die ganze Tabelle ab. Teilweise, siehe `database/AGENTS.md`.
CREATE INDEX publication_retracted_by_idx
    ON public.publication (retracted_by)
    WHERE retracted_by IS NOT NULL;

-- migrate:down

DROP INDEX public.publication_retracted_by_idx;

ALTER TABLE public.publication
    DROP CONSTRAINT publication_retracted_was_released,
    DROP CONSTRAINT publication_retraction_has_a_time;

-- Wer wann zurückgezogen hat, geht mit. Der Inhalt kommt dadurch nicht wieder — der war schon beim
-- Zurückziehen weg und steht nur noch in einer Sicherung von davor.
ALTER TABLE public.publication
    DROP COLUMN retracted_at,
    DROP COLUMN retracted_by;
