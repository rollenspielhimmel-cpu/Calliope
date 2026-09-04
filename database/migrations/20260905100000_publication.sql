-- migrate:up

-- **Rundmails und offizielle Forum-Threads sind zwei Ausgänge derselben Sache.**
--
-- Beide erscheinen nach außen unter einer anderen Identität als der Person, die sie geschrieben
-- hat, und genau daraus folgt die Freigabe: Wer im Namen eines anderen sendet, kann Schaden
-- anrichten, der ihm nicht zugeschrieben wird. Deshalb liegt beides auf einem Tisch — eine
-- Warteschlange, eine Zeitsteuerung, eine rote Zahl.

-- ── Wer gesendet werden darf ────────────────────────────────────────────────────────────────
--
-- Die Konten, aus deren Sicht eine Rundmail verschickt werden kann. Der Ur-Admin schaltet frei;
-- alle anderen wählen nur aus, was hier steht.
--
-- **Konten, keine erfundenen Identitäten.** Ein „Weihnachtsmann" ist ein Konto wie jedes andere,
-- und `Admin` bleibt dauerhaft dasselbe Konto — es wird nicht umbenannt und nicht weitergegeben.
-- Eine Zwischenebene zwischen Konto und Absender wäre eine Tabelle, die nichts entscheidet.
--
-- `ON DELETE CASCADE`: Ist das Konto weg, ist auch die Erlaubnis weg. Was damit bereits gesendet
-- wurde, bleibt — dafür steht `send_as_user_id` auf der Veröffentlichung selbst.
CREATE TABLE public.broadcast_sender
(
    user_id    UUID PRIMARY KEY REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- Wo das Konto in der Auswahlliste steht. `Admin` bekommt die 0 und damit den ersten Platz.
    sort_order INTEGER     NOT NULL DEFAULT 100,
    enabled_by UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX broadcast_sender_order_idx ON public.broadcast_sender (sort_order, user_id);

-- ── Der Zustand einer Veröffentlichung ──────────────────────────────────────────────────────
--
-- `draft`             wird geschrieben, niemand wartet darauf
-- `awaiting_approval` eingereicht, liegt in der Warteschlange
-- `approved`          freigegeben, aber noch nicht draußen — bei gesetztem Termin auch tagelang
-- `released`          raus: Mail verschickt, Thread sichtbar
-- `discarded`         verworfen, bleibt als Spur stehen
--
-- **`approved` und `released` sind zwei Zustände, nicht einer.** Freigabe heißt nicht senden.
CREATE TYPE public.publication_status AS ENUM (
    'draft', 'awaiting_approval', 'approved', 'released', 'discarded'
    );

CREATE TYPE public.publication_kind AS ENUM ('broadcast', 'forum_thread');

CREATE TABLE public.publication
(
    id               UUID PRIMARY KEY                  DEFAULT uuidv7(),
    kind             public.publication_kind  NOT NULL,
    status           public.publication_status NOT NULL DEFAULT 'draft',

    -- Aus wessen Sicht es erscheint. Kein Fremdschlüssel auf `broadcast_sender`, sondern auf das
    -- Konto: Eine Erlaubnis, die später zurückgenommen wird, darf nicht rückwirkend ändern, wer
    -- als Absender einer bereits verschickten Rundmail dastand.
    send_as_user_id  UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,

    -- Null heißt „sobald freigegeben". Ein Zeitpunkt heißt „frühestens dann, und nur freigegeben".
    -- In UTC wie alles hier; die Oberfläche rechnet nach Europe/Berlin, weil „morgen um 20 Uhr"
    -- das ist, was jemand meint, der es eintippt.
    scheduled_for    TIMESTAMPTZ,

    -- **Wer geschrieben hat, auch wenn außen jemand anderes draufsteht.** Das ist die Spur, die
    -- „nach außen der Weihnachtsmann, intern nachvollziehbar" möglich macht. Kein eigenes
    -- Protokoll: Dieses Haus hält so etwas in einer Spalte neben der Sache fest, wie `strike`
    -- ihren `issued_by`.
    written_by       UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    written_at       TIMESTAMPTZ              NOT NULL DEFAULT now(),

    -- Jede Bearbeitung setzt beide zurück. Sonst lässt man Harmloses absegnen und tauscht danach
    -- den Text — oder verschiebt nur den Termin, was dasselbe ist.
    approved_by      UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    approved_at      TIMESTAMPTZ,

    released_at      TIMESTAMPTZ,

    -- Beide oder keiner: „freigegeben von niemandem" wäre ein Zustand, den die Abfrage nach der
    -- Warteschlange falsch beantworten würde.
    CONSTRAINT publication_approval_is_whole CHECK (
        (approved_by IS NULL) = (approved_at IS NULL)
        ),

    -- Freigegeben heißt: es gibt eine Freigabe. Und was draußen ist, war freigegeben — außer es
    -- kam vom Ur-Admin, der mit dem Schreiben freigibt; auch dort wird `approved_*` gesetzt, damit
    -- diese Regel ohne Ausnahme gilt und die Spalte immer sagt, wer es verantwortet.
    CONSTRAINT publication_released_was_approved CHECK (
        status NOT IN ('approved', 'released') OR approved_at IS NOT NULL
        ),

    -- `released_at` ist die Tatsache, `status` die Behauptung. Sie dürfen sich nicht widersprechen.
    CONSTRAINT publication_released_has_a_time CHECK (
        (status = 'released') = (released_at IS NOT NULL)
        )
);

-- Die Warteschlange, und die rote Zahl darüber: die ältesten zuerst, damit nichts unten liegen
-- bleibt — dieselbe Ordnung, die die Missbrauchsmeldungen haben.
CREATE INDEX publication_awaiting_idx ON public.publication (written_at)
    WHERE status = 'awaiting_approval';

-- Was der Taktgeber jede Minute sucht: freigegeben, Termin erreicht, noch nicht raus.
CREATE INDEX publication_due_idx ON public.publication (scheduled_for)
    WHERE status = 'approved';

-- ── Die Rundmail selbst ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.broadcast
(
    id                 UUID PRIMARY KEY      DEFAULT uuidv7(),
    -- Eine Rundmail *ist* eine Veröffentlichung; verschwindet die, verschwindet sie mit.
    publication_id     UUID        NOT NULL UNIQUE REFERENCES public.publication (id) ON UPDATE CASCADE ON DELETE CASCADE,

    subject            TEXT        NOT NULL,
    body               TEXT        NOT NULL,

    -- Derselbe Empfängerbegriff, den `broadcast_service.ts` schon kennt: Rollen als Liste, plus
    -- ob unbestätigte Adressen mitgemeint sind.
    audience_groups    TEXT[]      NOT NULL,
    include_unverified BOOLEAN     NOT NULL DEFAULT FALSE,

    -- **Nur bei „an alle" überhaupt anbietbar**, und dann voreingestellt an. Die Prüfung, ob der
    -- Empfängerkreis alle umfasst, gehört in die Anwendung: sie kennt die Rollen, die Datenbank
    -- kennt nur ein Textfeld.
    publish_in_archive BOOLEAN     NOT NULL DEFAULT TRUE,
    -- Der Beitrag im Rundmail-Thread, sobald er entstanden ist. `ON DELETE SET NULL`, weil der
    -- Beitrag laut Regel gelöscht werden darf und die Rundmail das überleben muss.
    archive_post_id    UUID REFERENCES public.forum_post (id) ON UPDATE CASCADE ON DELETE SET NULL,

    -- Beim Versand festgehalten, nicht später gezählt: Wer die Liste hinterher neu abfragt, zählt
    -- die Mitglieder von heute und nicht die, die sie bekommen haben.
    recipient_count    INTEGER,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT broadcast_subject_not_blank CHECK (btrim(subject) <> ''),
    CONSTRAINT broadcast_body_not_blank CHECK (btrim(body) <> ''),
    CONSTRAINT broadcast_has_an_audience CHECK (cardinality(audience_groups) > 0)
);

-- ── Vorgefertigte ───────────────────────────────────────────────────────────────────────────
--
-- Keine Veröffentlichung und deshalb keine Freigabe: Eine Vorlage verschickt nichts. Erst wenn
-- daraus eine Rundmail wird, greift die Warteschlange wie überall.
--
-- Geteilt, nicht privat: Sie sind ein Werkzeug des Teams, und eine Vorlage, die nur einer sieht,
-- wird von den anderen noch einmal geschrieben.
CREATE TABLE public.broadcast_template
(
    id         UUID PRIMARY KEY      DEFAULT uuidv7(),
    name       TEXT        NOT NULL,
    subject    TEXT        NOT NULL,
    body       TEXT        NOT NULL,
    created_by UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT broadcast_template_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX broadcast_template_name_idx ON public.broadcast_template (lower(name));

-- ── Offizielle Forum-Threads ────────────────────────────────────────────────────────────────
--
-- Ein Thread mit Veröffentlichung ist ein offizieller: Er erscheint unter dem Konto, das dort
-- steht, und wird zum vereinbarten Zeitpunkt sichtbar. Null ist der Normalfall.
--
-- Nachträglich setzbar, weil der Haken beim Eröffnen vergessen werden kann — dafür ist nichts
-- weiter nötig, als die Spalte später zu füllen.
ALTER TABLE public.forum_thread
    ADD COLUMN publication_id UUID REFERENCES public.publication (id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX forum_thread_publication_idx ON public.forum_thread (publication_id)
    WHERE publication_id IS NOT NULL;

-- migrate:down

ALTER TABLE public.forum_thread
    DROP COLUMN publication_id;

DROP TABLE public.broadcast_template;

DROP TABLE public.broadcast;

DROP TABLE public.publication;

DROP TYPE public.publication_kind;

DROP TYPE public.publication_status;

DROP TABLE public.broadcast_sender;
