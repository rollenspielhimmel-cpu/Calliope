-- migrate:up

-- **Wer unter welchem Absender vorbereiten darf.**
--
-- Bisher durfte jeder, der vorbereiten darf, jeden freigeschalteten Absender wählen. Ein künftiger
-- Eventmanager soll aber nur als „Infoflamingo" schreiben, nicht als Admin und nicht als
-- Weihnachtsmann. Deshalb bekommt ein Absender seine Nutzer: eine Rolle oder eine einzelne Person.
--
-- **Eine Person bekommt ihn auch ohne Rolle.** Wer persönlich einen Absender hat, darf damit
-- vorbereiten und einreichen — das rechnet `user_service.ts` in die Berechtigungen der Sitzung
-- ein. Eine persönliche Freigabe hängt am Konto, nicht an der Rolle: Ändert sich die Rolle, bleibt
-- sie stehen.
--
-- **Administrationen stehen hier nicht.** Sie dürfen jeden freigeschalteten Absender, ohne Zeile,
-- aus demselben Grund wie in `platform_role_permission`.
--
-- **Freigegeben wird wie immer durch eine Administration.** Diese Tabelle sagt nur, wer etwas
-- unter welchem Namen vorbereiten darf.

CREATE TABLE public.sender_grant
(
    id             UUID PRIMARY KEY     DEFAULT uuidv7(),

    -- Der Absender. **Null heißt „Admin"**, das Konto der Plattform — so, wie `send_as_user_id`
    -- auf der Veröffentlichung es meint. Nicht die Kennung des Ur-Admin-Kontos, weil „Admin" ein
    -- Absender ist und kein bestimmtes Konto: Die Freigabe soll bleiben, was sie ist, auch wenn das
    -- Konto dahinter einmal ein anderes wäre.
    --
    -- Auf `broadcast_sender` und nicht auf `user`: Wird ein Absender zurückgenommen, gehen seine
    -- Freigaben mit, statt als Rechte auf einen Namen stehen zu bleiben, den es nicht mehr gibt.
    sender_user_id UUID REFERENCES public.broadcast_sender (user_id) ON UPDATE CASCADE ON DELETE CASCADE,

    -- Genau eines von beiden: eine Rolle oder eine Person.
    role           public.platform_role,
    user_id        UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE CASCADE,

    granted_by     UUID REFERENCES public."user" (id) ON UPDATE CASCADE ON DELETE SET NULL,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT sender_grant_role_or_person CHECK (num_nonnulls(role, user_id) = 1),
    CONSTRAINT sender_grant_not_for_administrators CHECK (role IS DISTINCT FROM 'administrator')
);

-- Jede Freigabe einmal. `NULLS NOT DISTINCT`, weil „Admin" als Null steht und zweimal „Admin für
-- die Moderation" sonst als zwei verschiedene Zeilen durchginge.
CREATE UNIQUE INDEX sender_grant_role_idx
    ON public.sender_grant (sender_user_id, role) NULLS NOT DISTINCT
    WHERE role IS NOT NULL;

CREATE UNIQUE INDEX sender_grant_person_idx
    ON public.sender_grant (sender_user_id, user_id) NULLS NOT DISTINCT
    WHERE user_id IS NOT NULL;

-- Was die Sitzung bei jeder Anfrage fragt: Hat diese Person irgendeinen Absender?
CREATE INDEX sender_grant_user_idx ON public.sender_grant (user_id)
    WHERE user_id IS NOT NULL;

-- **Die Moderation behält, was sie bisher durfte**: „Admin" und jeden heute freigeschalteten
-- Absender. Was ab jetzt freigeschaltet wird, gilt zunächst nur für Administrationen.
INSERT INTO public.sender_grant (sender_user_id, role)
VALUES (NULL, 'moderator');

INSERT INTO public.sender_grant (sender_user_id, role)
SELECT user_id, 'moderator'
FROM public.broadcast_sender;

-- migrate:down

DROP TABLE public.sender_grant;
