-- migrate:up

-- ── Das Zitat wird ein Bezug ────────────────────────────────────────────────────────────────
--
-- Bisher war ein Zitat reiner Text: „Zitieren" schrieb `@name: „die ersten 60 Zeichen …"` in das
-- Eingabefeld, und das ging so als Kommentar weg. Das hat drei Folgen, und alle drei sind der
-- Grund für diese Spalte.
--
-- **Der Rest war nie gespeichert.** Ein „… weiterlesen" im Zitat hätte nichts zu zeigen gehabt:
-- Was über die 60 Zeichen hinausging, stand nur im ursprünglichen Kommentar, zu dem keine
-- Verbindung bestand.
--
-- **Der Name ließ sich nicht verlinken**, ohne `@irgendwas:` aus dem Fließtext zu fischen. Das
-- trifft jeden, der selbst ein `@` tippt.
--
-- **Und er wäre eingefroren.** Umbenennen gibt es bei uns heute noch nicht — aber käme es, stünde
-- der alte Name als Buchstaben in Hunderten von Kommentaren, und nachträglich ließe er sich nur
-- durch Suchen-und-Ersetzen über alle hinweg ändern. Mit dem Bezug kommt der Name beim Anzeigen
-- frisch aus dem Konto.
--
-- (Zum Vergleich: Im Protokoll der offiziellen Threads stehen Namen **absichtlich** als Text. Das
-- ist eine Aufzeichnung davon, was war, und soll sich gerade nicht mitändern. Ein Zitat zeigt auf
-- etwas, das noch da ist — deshalb andersherum.)

-- Für den zusammengesetzten Fremdschlüssel darunter: Ohne diese Eindeutigkeit kann er nicht auf
-- das Paar zeigen. Die Kennung ist ohnehin schon eindeutig; das hier sagt es nur auch dem Paar.
ALTER TABLE public.status_update_comment
    ADD CONSTRAINT status_update_comment_id_status_update_id_key UNIQUE (id, status_update_id);

ALTER TABLE public.status_update_comment
    ADD COLUMN quoted_comment_id UUID,
    -- **Zusammengesetzt, damit ein Zitat die Meldung nicht verlassen kann.** Ein Bezug allein auf
    -- die Kennung ließe zu, dass ein Kommentar einen aus einer ganz anderen Statusmeldung zitiert
    -- — die Oberfläche böte das nie an, aber die Datenbank soll es auch nicht erlauben.
    ADD CONSTRAINT status_update_comment_quotes_same_update
        FOREIGN KEY (quoted_comment_id, status_update_id)
            REFERENCES public.status_update_comment (id, status_update_id)
            ON UPDATE CASCADE,
    -- Kein `ON DELETE`: Gelöscht wird ein Kommentar heute nirgends, und solange das so ist, ist
    -- „geht nicht, solange jemand daraus zitiert" die ehrlichere Antwort als ein Zitat, das
    -- stillschweigend verschwindet. Kommt das Löschen, wird hier entschieden, was mit dem Zitat
    -- geschieht — und dann steht die Frage an der richtigen Stelle.
    ADD CONSTRAINT status_update_comment_does_not_quote_itself
        CHECK (quoted_comment_id IS DISTINCT FROM id);

COMMENT ON COLUMN public.status_update_comment.quoted_comment_id IS
    'Der zitierte Kommentar, oder null. Das Zitat wird beim Anzeigen aus ihm gebaut, damit Name und Text aktuell bleiben.';

-- Für die Anzeige wird von der Kennung aus gelesen (der Fremdschlüssel deckt das ab). Diesen Weg
-- hier braucht das Löschen später, das fragen muss: Zitiert noch jemand diesen Kommentar?
CREATE INDEX status_update_comment_quoted_comment_id_idx
    ON public.status_update_comment (quoted_comment_id)
    WHERE quoted_comment_id IS NOT NULL;

-- migrate:down

DROP INDEX public.status_update_comment_quoted_comment_id_idx;

ALTER TABLE public.status_update_comment
    DROP CONSTRAINT status_update_comment_does_not_quote_itself,
    DROP CONSTRAINT status_update_comment_quotes_same_update,
    DROP COLUMN quoted_comment_id;

ALTER TABLE public.status_update_comment
    DROP CONSTRAINT status_update_comment_id_status_update_id_key;
