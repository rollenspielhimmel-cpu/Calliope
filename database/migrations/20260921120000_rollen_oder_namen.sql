-- migrate:up

-- **Eine Rundmail braucht eine Rolle oder einen Namen — nicht zwingend eine Rolle.**
--
-- `broadcast_has_an_audience` stammt aus der Zeit, als eine Rundmail nur an Rollen ging:
--
--     CHECK (cardinality(audience_groups) > 0)
--
-- Seit `20260906170000_rundmail_an_einzelne` gibt es die namentlich Genannten, und die Schnittstelle
-- sagt seitdem „Rollen oder Namen". Die Bedingung wurde dabei nicht mitgezogen. Eine Rundmail nur an
-- zwei Namen lief deshalb in sie hinein und kam als 500 zurück statt als Absage; die Oberfläche
-- verlangte zufällig dieselbe Rolle und verdeckte das.
--
-- **Warum keine `CHECK` mehr.** Eine `CHECK` sieht nur ihre eigene Zeile, und die Namen stehen in
-- `broadcast_recipient`. Unterabfragen lässt PostgreSQL dort nicht zu. Die Regel aus der Datenbank
-- zu nehmen und sie nur in der Route zu prüfen, stand zur Wahl und ist verworfen: Eine Bedingung,
-- die nur im Formular steht, gilt nur für den, der das Formular benutzt.
--
-- **Zurückgestellt, weil die Reihenfolge sonst nicht stimmt.** Die Rundmail wird zuerst geschrieben,
-- die Namen danach — in derselben Transaktion, aber als zwei Anweisungen. Eine sofortige Prüfung
-- sähe die Zeile ohne Namen und schlüge an. Geprüft wird deshalb beim Festschreiben, und dann
-- gegen den Stand, der tatsächlich festgeschrieben wird.
--
-- **Nur beim Schreiben des Empfängerkreises, nicht bei jeder Änderung.** `INSERT` und
-- `UPDATE OF audience_roles` — `edit()` setzt die Spalte jedes Mal mit und ersetzt die Namen in
-- derselben Transaktion, ist also gedeckt. Ein gewöhnliches `UPDATE` löst nichts aus, und das ist
-- Absicht: Beim Versand schreibt die Freigabe `recipient_count` in dieselbe Zeile. Prüfte der
-- Auslöser dort, fiele eine Rundmail an Namen, deren Empfänger vor dem Versand alle ihr Konto
-- gelöscht haben, in jedem Takt erneut um.
--
-- **Und bewusst kein Auslöser auf `broadcast_recipient`.** `user_id` ist dort `ON DELETE CASCADE`.
-- Wer beim Löschen eines Namens prüfte, machte ein Konto unlöschbar, sobald es je einziger
-- namentlicher Empfänger einer Rundmail war — dieselbe Falle wie `publication_approval_is_whole`,
-- das eine Bedingung an zwei Dinge band, von denen eines beim Löschen geleert wird. Die Regel heißt
-- „eine Rundmail wird mit einem Empfängerkreis geschrieben", nicht „hat für immer einen".
--
-- **Kein Datenumzug.** Die neue Regel ist schwächer als die alte: Was heute dasteht, hat mindestens
-- eine Rolle und erfüllt sie ohnehin.
ALTER TABLE public.broadcast
    DROP CONSTRAINT broadcast_has_an_audience;

CREATE FUNCTION public.broadcast_has_an_audience() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    -- Die Zeile neu lesen statt `NEW` zu glauben: Beim Festschreiben zählt der Stand von jetzt,
    -- nicht der vom Auslösen. Wurde sie in derselben Transaktion noch einmal geändert oder mit
    -- ihrer Veröffentlichung gelöscht, liest das den richtigen Stand — oder keinen, und dann gibt
    -- es auch nichts zu prüfen.
    IF EXISTS (
        SELECT 1
        FROM public.broadcast AS b
        WHERE b.id = NEW.id
          AND cardinality(b.audience_roles) = 0
          AND NOT EXISTS (SELECT 1 FROM public.broadcast_recipient AS r WHERE r.broadcast_id = b.id)
    ) THEN
        -- Dieselbe Fehlerform wie die `CHECK`, die hier stand: `check_violation` unter demselben
        -- Namen. Wer auf die Meldung reagiert, muss von dem Umbau nichts wissen.
        RAISE EXCEPTION 'broadcast % has neither a role nor a named recipient', NEW.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'broadcast_has_an_audience';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER broadcast_has_an_audience
    AFTER INSERT OR UPDATE OF audience_roles
    ON public.broadcast
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
EXECUTE FUNCTION public.broadcast_has_an_audience();

-- migrate:down

-- **Dieser Rückweg kann scheitern, und das mit Absicht.** Gibt es inzwischen eine Rundmail nur an
-- Namen, verletzt sie die alte Bedingung, und `ADD CONSTRAINT` bricht ab. `NOT VALID` hätte das
-- umgangen, aber dann stünde eine Bedingung da, die ihre eigenen Zeilen nicht erfüllen — ein
-- Rückweg, der gelingt, indem er lügt. Erst entscheiden, was mit solchen Rundmails geschieht, dann
-- zurück.
--
-- Scheitert er, bleibt nichts halb stehen: Er läuft in einer Transaktion, und Auslöser und Funktion
-- sind danach noch da — an einer Wegwerf-Datenbank nachgemessen. **dbmate druckt dabei trotzdem
-- „Rolled back"**, weil die Zeile vor dem Festschreiben kommt; maßgeblich ist der Fehler darunter
-- und der Rückgabewert 2.
DROP TRIGGER broadcast_has_an_audience ON public.broadcast;

DROP FUNCTION public.broadcast_has_an_audience();

ALTER TABLE public.broadcast
    ADD CONSTRAINT broadcast_has_an_audience CHECK (cardinality(audience_roles) > 0);
