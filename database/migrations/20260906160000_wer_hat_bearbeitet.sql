-- migrate:up

-- **Wer bearbeitet hat, neben dem, der verfasst hat — nicht statt seiner.**
--
-- Bearbeiten wird in der Warteschlange möglich, und damit stellt sich die Frage, wer danach für
-- den Text einsteht. Der naheliegende Weg wäre gewesen, `written_by` auf die bearbeitende Person
-- übergehen zu lassen. Das war der falsche: Es **löscht** die Auskunft, um die es bei der ganzen
-- Freigabekonstruktion geht.
--
-- Der Fall, an dem das hängt: Jemand reicht etwas Grenzwertiges ein, eine Administration entschärft
-- es. Mit einer wandernden Spalte stünde hinterher nur noch die Administration da, und dass
-- überhaupt jemand etwas hatte entschärfen müssen, wäre nicht mehr zu sehen. Beide Namen sind es
-- wert.
--
-- Dazu kommt: Eine Spalte, die mal den Verfasser und mal den letzten Bearbeiter bedeutet, je
-- nachdem wie weit eine Rundmail ist, wird in einem halben Jahr falsch gelesen — von jemandem, der
-- die Diskussion von heute nicht kennt.
--
-- **Nur die letzte Bearbeitung, keine Geschichte.** Wer eine vollständige Kette will, braucht eine
-- eigene Tabelle; die Frage, die hier beantwortet werden muss, ist „steht der Text noch so da, wie
-- er eingereicht wurde, und wenn nicht, wer hat ihn zuletzt angefasst".
ALTER TABLE public.publication
    ADD COLUMN edited_by uuid
        REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    ADD COLUMN edited_at timestamp with time zone;

-- Wie bei der Freigabe: beides oder keins. Eine Zeit ohne Namen wäre eine Bearbeitung von
-- niemandem, ein Name ohne Zeit eine ohne Zeitpunkt — beides sagt weniger als nichts.
--
-- Der Name darf allein wegfallen, wenn das Konto gelöscht wird: `ON DELETE SET NULL` oben lässt die
-- Zeit stehen, und „am 3. bearbeitet, von einem gelöschten Konto" ist eine wahre Auskunft. Deshalb
-- prüft die Bedingung in dieser Richtung nur, dass keine Zeit fehlt.
ALTER TABLE public.publication
    ADD CONSTRAINT publication_edit_has_a_time
        CHECK (edited_by IS NULL OR edited_at IS NOT NULL);

-- migrate:down

ALTER TABLE public.publication
    DROP CONSTRAINT publication_edit_has_a_time;

ALTER TABLE public.publication
    DROP COLUMN edited_by,
    DROP COLUMN edited_at;
