-- migrate:up

-- **Nicht jeder, der vorbereiten darf, sieht die ganze Warteschlange.**
--
-- Ein Eventmanager oder jemand wie Rogue mit einem persönlichen Absender sieht nur, was unter
-- einem seiner Absender läuft — und das Eigene. Die Moderation sieht alles, auch was die
-- Administration vorbereitet; dafür bekommt sie eine Berechtigung, die der Ur-Admin pro Rolle
-- vergibt. Administrationen sehen immer alles.
--
-- Der Wert kommt hier dazu, die Zeile für die Moderation in der nächsten Migration: Postgres lässt
-- einen neuen Enum-Wert in der Transaktion, die ihn anlegt, nicht benutzen.
ALTER TYPE public.platform_permission ADD VALUE 'see_whole_queue';

-- **Einträge, die selbst die Moderation nicht sieht** — etwa die Ankündigung, dass jemand das Team
-- verlässt. Setzen kann den Haken nur eine Administration.
--
-- **Er versteckt die Vorbereitung, nicht die Rundmail.** Geht sie an alle, bekommt auch die
-- Moderation sie beim Versand; verborgen bleibt nur der Eintrag in Warteschlange und „Gesendete",
-- samt wer ihn geschrieben und freigegeben hat.
ALTER TABLE public.publication
    ADD COLUMN administration_only BOOLEAN NOT NULL DEFAULT FALSE;

-- migrate:down

ALTER TABLE public.publication
    DROP COLUMN administration_only;

-- Ein Enum-Wert lässt sich nicht entfernen, also wird der Typ ohne ihn neu gebaut. Die Zeilen, die
-- ihn benutzen, gehen vorher — die nächste Migration legt sie an und nimmt sie beim Rückweg selbst.
DELETE FROM public.platform_role_permission WHERE permission = 'see_whole_queue';

ALTER TABLE public.platform_role_permission
    ALTER COLUMN permission TYPE TEXT;

DROP TYPE public.platform_permission;

CREATE TYPE public.platform_permission AS ENUM ('prepare_publications');

ALTER TABLE public.platform_role_permission
    ALTER COLUMN permission TYPE public.platform_permission
        USING permission::public.platform_permission;
