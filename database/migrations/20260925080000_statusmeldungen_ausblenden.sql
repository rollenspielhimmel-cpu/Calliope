-- migrate:up

-- ── Wen ich in den Statusmeldungen nicht sehen will ─────────────────────────────────────────
--
-- **Zwei Schalter, nicht einer.** Statusmeldungen und Kommentare lassen sich einzeln abstellen:
-- Es gibt Leute, deren Meldungen einem zu viel sind, deren Antworten unter fremden Meldungen aber
-- völlig in Ordnung — und umgekehrt.
--
-- **Nicht dasselbe wie Blockieren, und bewusst nicht daran gekoppelt.** `user_block` regelt
-- *Kontakt*: Einladungen und Gespräche, symmetrisch, in beide Richtungen. Das hier regelt *Sicht*,
-- einseitig und leise.
--
-- Wer jemanden blockiert, bekommt ihn deshalb **nicht** automatisch ausgeblendet. Der Grund kommt
-- aus der Community: Wenn zwei sich zerstritten haben, ist es gerade die blockierte Seite, über
-- die man lesen will, was sie über andere schreibt. Würde das automatisch verschwinden, sähen es
-- alle außer der einen Person, die es angeht.
--
-- **Die Moderation blendet niemanden aus.** Für sie muss alles sichtbar sein: Im Löschprotokoll
-- steht nur, was gelöscht wurde, nicht was jemand geschrieben hat und stehen ließ. Durchgesetzt
-- wird das in der Route, nicht hier — die Tabelle kennt keine Rollen.
CREATE TABLE public.status_update_hidden_member
(
    user_id        UUID        NOT NULL REFERENCES public."user" (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    hidden_user_id UUID        NOT NULL REFERENCES public."user" (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    hide_updates   BOOLEAN     NOT NULL DEFAULT false,
    hide_comments  BOOLEAN     NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, hidden_user_id),

    -- Sich selbst auszublenden ergibt nichts, und es wäre ein Weg, die eigene Meldung aus der
    -- eigenen Liste verschwinden zu lassen, ohne sie zu löschen.
    CONSTRAINT status_update_hidden_member_not_self CHECK (user_id <> hidden_user_id),

    -- **Eine Zeile, die nichts verbirgt, gibt es nicht.** Beide Schalter aus heißt: Der Eintrag
    -- verschwindet. Sonst gäbe es zwei Arten, „ich sehe alles von dir" zu speichern — keine Zeile
    -- und eine leere —, und jede Abfrage müsste beide kennen.
    CONSTRAINT status_update_hidden_member_hides_something
        CHECK (hide_updates OR hide_comments)
);

COMMENT ON TABLE public.status_update_hidden_member IS
    'Wen jemand in den Statusmeldungen nicht sehen will. Je Richtung eine Zeile, zwei Schalter. Keine Zeile heißt: alles sichtbar.';

-- Gefragt wird immer „was blende *ich* aus" — der Primärschlüssel deckt das ab. Diesen Weg hier
-- braucht das Aufräumen: Verschwindet ein Konto, müssen seine Einträge in beide Richtungen weg,
-- und der Fremdschlüssel findet die eine Richtung sonst nur über einen vollen Durchlauf.
CREATE INDEX status_update_hidden_member_hidden_user_id_idx
    ON public.status_update_hidden_member (hidden_user_id);

-- migrate:down

DROP TABLE public.status_update_hidden_member;
