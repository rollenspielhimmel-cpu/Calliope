-- migrate:up

-- **Ins Archiv kommt nur eine Rundmail an alle Mitglieder.**
--
-- So war es entschieden, und so stand es nirgends. Geprüft wurde nur, dass eine Rundmail an Namen
-- nicht ins Archiv geht; eine an die Moderation allein durfte hinein. Das Archiv ist aber der Ort,
-- an dem neue Mitglieder nachlesen, was je *angekündigt* wurde — eine Notiz an die Administration
-- steht dort für alle lesbar. Auf der Beta ist genau das einmal passiert.
--
-- „An alle" heißt: alle drei Rollen und kein Name. Namen neben allen Rollen fügen niemanden hinzu,
-- und die Oberfläche lässt sie dann gar nicht erst zu; die Regel verlangt es trotzdem, damit sie
-- ohne die Oberfläche dasselbe sagt.
--
-- **Ein Auslöser und keine `CHECK`**, aus demselben Grund wie bei `broadcast_has_an_audience`: Die
-- Namen stehen in `broadcast_recipient`. Zurückgestellt, weil die Namen nach der Rundmail
-- geschrieben werden. Er hört auf den Haken und auf die Rollen; kein Auslöser auf
-- `broadcast_recipient`, damit das Löschen eines Kontos nie an einer Rundmail hängen bleibt.
CREATE FUNCTION public.broadcast_archive_only_to_everyone() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    -- Neu gelesen statt `NEW` zu glauben: Beim Festschreiben zählt der Stand von jetzt.
    IF EXISTS (
        SELECT 1
        FROM public.broadcast AS b
        WHERE b.id = NEW.id
          AND b.publish_in_archive
          AND NOT (
              b.audience_roles @> ARRAY ['administrator', 'moderator', 'member']::text[]
              AND NOT EXISTS (SELECT 1 FROM public.broadcast_recipient AS r WHERE r.broadcast_id = b.id)
          )
    ) THEN
        RAISE EXCEPTION 'broadcast % goes to the archive without going to everyone', NEW.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'broadcast_archive_only_to_everyone';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER broadcast_archive_only_to_everyone
    AFTER INSERT OR UPDATE OF publish_in_archive, audience_roles
    ON public.broadcast
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
EXECUTE FUNCTION public.broadcast_archive_only_to_everyone();

-- **Was schon falsch im Archiv liegt, kommt heraus.**
--
-- Auf der Beta eine einzige Rundmail, nur an die Administration, vor dem Deploy benannt und
-- bestätigt. Der Beitrag geht, und der Haken wird zurückgenommen — sonst stünde da, sie sei im
-- Archiv, und es gäbe keinen Beitrag.
--
-- **Das verschiebt Daten und ist nicht umkehrbar**: Der Rückweg unten stellt den Beitrag nicht
-- wieder her. Deshalb vorher eine frische Sicherung, siehe `database/AGENTS.md`.
--
-- Ging eine solche Rundmail *nur* ins Archiv, ließe sich der Haken nicht zurücknehmen, ohne
-- `broadcast_arrives_somewhere` zu verletzen. Dann bricht die Migration hier ab, mit einem Satz,
-- statt irgendetwas zu erfinden. Auf der Beta gibt es keine: nachgesehen vor dem Deploy.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.broadcast AS b
        WHERE b.publish_in_archive
          AND NOT b.deliver_to_inbox
          AND NOT b.deliver_by_email
          AND NOT (
              b.audience_roles @> ARRAY ['administrator', 'moderator', 'member']::text[]
              AND NOT EXISTS (SELECT 1 FROM public.broadcast_recipient AS r WHERE r.broadcast_id = b.id)
          )
    ) THEN
        RAISE EXCEPTION 'a broadcast that is not to everyone went only to the archive; decide by hand what becomes of it';
    END IF;
END;
$$;

WITH misplaced AS (
    SELECT b.id, b.archive_post_id
    FROM public.broadcast AS b
    WHERE b.publish_in_archive
      AND NOT (
          b.audience_roles @> ARRAY ['administrator', 'moderator', 'member']::text[]
          AND NOT EXISTS (SELECT 1 FROM public.broadcast_recipient AS r WHERE r.broadcast_id = b.id)
      )
),
removed AS (
    DELETE FROM public.writing_post AS p
    USING misplaced AS m
    WHERE p.id = m.archive_post_id
)
UPDATE public.broadcast AS b
SET publish_in_archive = false,
    archive_post_id    = NULL
FROM misplaced AS m
WHERE b.id = m.id;

-- migrate:down

-- Nimmt die Regel zurück, nicht die Bereinigung: Der gelöschte Beitrag kommt nur aus der Sicherung
-- wieder.
DROP TRIGGER broadcast_archive_only_to_everyone ON public.broadcast;

DROP FUNCTION public.broadcast_archive_only_to_everyone();
