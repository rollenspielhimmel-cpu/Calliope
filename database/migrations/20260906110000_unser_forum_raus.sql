-- migrate:up

-- **Unser eigenes Forum weicht Maxis öffentlichem Forum.**
--
-- Zwei Foren, die dasselbe wollten, mit zwei Datenmodellen. Seines kommt ohne eigene Tabellen aus:
-- `writing_group_id IS NULL` macht eine Zeile zur Forumszeile, und damit erben Forumsbeiträge die
-- ganze Maschinerie der Gruppen — Meldungen, Merkzeichen, Suche, Entwürfe. Unseres hatte dafür
-- eigene Tabellen und musste jede dieser Verbindungen einzeln nachbauen.
--
-- Diese Migration räumt unsere Seite ab. Sie läuft **nach** seinen dreien, weil das Umhängen der
-- Rundmail (siehe unten) seine Tabellen schon voraussetzt.
--
-- Vorwärts statt in den Ausgangsstand hineingeschrieben: Der Beta-Server hat den Ausgangsstand und
-- `publication` bereits angewandt. Eine Migration, die den Umbau tut, kommt dort ohne Rückbau an —
-- ein bearbeiteter Ausgangsstand käme gar nicht an, weil dbmate eine bekannte Fassung nicht noch
-- einmal ausführt.

-- ── Die Rundmail zeigt jetzt auf seine Tabellen ─────────────────────────────────────────────
--
-- Ein offizieller Thread ist bei ihm ein `writing_thread` ohne Gruppe, ein Archivbeitrag ein
-- `writing_post`. Der Begriff bleibt derselbe, nur die Tabelle darunter wechselt — deshalb behält
-- `publication_kind` auch seinen Wert `forum_thread`.

ALTER TABLE public.writing_thread
    ADD COLUMN publication_id UUID REFERENCES public.publication (id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX writing_thread_publication_idx ON public.writing_thread (publication_id)
    WHERE publication_id IS NOT NULL;

-- Nichts umzukopieren: Es gibt noch keine Veröffentlichung, das Schema stand erst seit gestern.
DROP INDEX public.forum_thread_publication_idx;

ALTER TABLE public.forum_thread
    DROP COLUMN publication_id;

ALTER TABLE public.broadcast
    DROP CONSTRAINT broadcast_archive_post_id_fkey,
    ADD CONSTRAINT broadcast_archive_post_id_fkey
        FOREIGN KEY (archive_post_id) REFERENCES public.writing_post (id)
            ON UPDATE CASCADE ON DELETE SET NULL;

-- ── Meldungen und Merkzeichen brauchen die Sonderspalte nicht mehr ──────────────────────────
--
-- Sie zeigte auf `forum_post`. Ein Forumsbeitrag ist jetzt ein `writing_post`, und die Spalte
-- dafür gibt es längst — die Meldung eines Forumsbeitrags läuft ab hier über `writing_post_id`,
-- ohne dass irgendwo ein Fall dazukommt.
--
-- Die eindeutigen Indizes zählen die Zielspalten auf und müssen deshalb neu gesetzt werden.

DROP INDEX public.favourite_one_per_member_idx;
DROP INDEX public.favourite_forum_post_idx;

ALTER TABLE public.favourite
    DROP CONSTRAINT favourite_names_exactly_one_thing,
    DROP COLUMN forum_post_id,
    ADD CONSTRAINT favourite_names_exactly_one_thing CHECK (
        num_nonnulls(writing_group_id, writing_thread_id, writing_post_id, writing_page_id,
                     story_idea_id, chat_group_id) = 1
        );

CREATE UNIQUE INDEX favourite_one_per_member_idx
    ON public.favourite (user_id, writing_group_id, writing_thread_id, writing_post_id,
                         writing_page_id, story_idea_id, chat_group_id) NULLS NOT DISTINCT;

DROP INDEX public.report_one_open_per_reporter_and_category_idx;
DROP INDEX public.report_reported_forum_post_idx;

-- Der CHECK zählt für jeden Zielwert die *anderen* Spalten auf und muss deshalb ganz neu
-- geschrieben werden, nicht nur um eine Spalte gekürzt. Der Fall `forum_post` fällt dabei weg.
ALTER TABLE public.report
    DROP CONSTRAINT report_target_matches_type,
    DROP COLUMN reported_forum_post_id;

CREATE UNIQUE INDEX report_one_open_per_reporter_and_category_idx
    ON public.report (reporter_id, category, reported_writing_group_id, reported_writing_thread_id,
                      reported_writing_post_id, reported_writing_page_id, reported_story_idea_id,
                      reported_chat_group_id, reported_chat_message_id, reported_user_id)
        NULLS NOT DISTINCT
    WHERE closed_at IS NULL AND reporter_id IS NOT NULL
        AND num_nonnulls(reported_writing_group_id, reported_writing_thread_id,
                         reported_writing_post_id, reported_writing_page_id, reported_story_idea_id,
                         reported_chat_group_id, reported_chat_message_id, reported_user_id) = 1;

-- `forum_post` als Meldeziel fällt weg. PostgreSQL kann einen Enum-Wert nicht entfernen, also wird
-- der Typ neu gebaut — die Spalten sind leer, es ist nichts umzuschreiben.
ALTER TABLE public.report
    ALTER COLUMN target_type TYPE TEXT;

DROP TYPE public.report_target_type;

CREATE TYPE public.report_target_type AS ENUM (
    'writing_group', 'writing_thread', 'writing_post', 'writing_page',
    'story_idea', 'chat_group', 'chat_message', 'user'
    );

ALTER TABLE public.report
    ALTER COLUMN target_type TYPE public.report_target_type
        USING target_type::public.report_target_type;

ALTER TABLE public.report
    ADD CONSTRAINT report_target_matches_type CHECK (
        CASE target_type
            WHEN 'writing_group' THEN num_nonnulls(reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'writing_thread' THEN num_nonnulls(reported_writing_group_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'writing_post' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'writing_page' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'story_idea' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'chat_group' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_message_id, reported_user_id) = 0
            WHEN 'chat_message' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_user_id) = 0
            WHEN 'user' THEN num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id) = 0
            ELSE FALSE
            END
        );

-- ── Und die Tabellen selbst ─────────────────────────────────────────────────────────────────
--
-- Von innen nach außen: Beiträge, Threads, Unterforen, Bereiche.

DROP TRIGGER set_last_activity_at_for_forum_thread ON public.forum_post;

DROP FUNCTION public.set_last_activity_at_for_forum_thread();

DROP TABLE public.forum_post;

DROP TABLE public.forum_thread;

DROP TABLE public.sub_forum;

DROP TABLE public.forum_category;

DROP TYPE public.forum_visibility;

-- migrate:down

-- Kein Rückbau. Unser Forum bestand aus vier Tabellen, einem Aufzählungstyp, einem Trigger und
-- zwei Fremdschlüsseln in fremden Tabellen; sie hier noch einmal hinzuschreiben hieße, eine
-- zweite Fassung desselben Schemas zu pflegen, die niemand ausprobiert. Wer zurück will, nimmt
-- den Stand vor diesem Commit.
SELECT 1 WHERE FALSE;
