-- migrate:up

-- **Was eine Rolle darf, steht in einer Tabelle, nicht im Code.**
--
-- Bisher hieß jede Erlaubnis im Code „Admin" oder „Admin oder Mod". Für das Vorbereiten von
-- Rundmails und offiziellen Threads reicht das nicht: Heute dürfen es Admins und Mods, später
-- voraussichtlich ein Eventmanager — und ob der es darf, soll eine Entscheidung sein, die man
-- trifft, nicht eine Codezeile, die man ändert.
--
-- **Die Rollen selbst bleiben die feste Liste.** Eine neue Rolle ist weiterhin eine Migration, die
-- `platform_role` einen Wert hinzufügt; danach ist sie hier nur noch eine Zeile.
--
-- **Freigeben ist keine Berechtigung.** Es bleibt fest bei den Admins. Ließe es sich an Rollen
-- verteilen, wäre die Warteschlange mit einem Haken abgeschafft.

CREATE TYPE public.platform_permission AS ENUM (
    -- Rundmails und offizielle Threads schreiben, einreichen, die Warteschlange sehen.
    'prepare_publications'
    );

CREATE TABLE public.platform_role_permission
(
    role       public.platform_role       NOT NULL,
    permission public.platform_permission NOT NULL,
    granted_by UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    granted_at TIMESTAMPTZ                NOT NULL DEFAULT now(),

    PRIMARY KEY (role, permission),

    -- **Admins haben jede Berechtigung, ohne Zeile.** Eine Zeile für sie wäre eine, deren Fehlen
    -- etwas bedeuten könnte — und dann könnte man die Admins aus dem Vorbereiten aussperren und
    -- damit aus der Freigabe dessen, was sie selbst schreiben.
    CONSTRAINT platform_role_permission_not_for_administrators CHECK (role <> 'administrator')
);

-- Was bisher nirgends galt und jetzt gilt: Mods bereiten vor, geben aber nicht frei.
INSERT INTO public.platform_role_permission (role, permission)
VALUES ('moderator', 'prepare_publications');

-- migrate:down

DROP TABLE public.platform_role_permission;

DROP TYPE public.platform_permission;
