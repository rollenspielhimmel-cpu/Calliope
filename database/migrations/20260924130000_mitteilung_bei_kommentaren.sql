-- migrate:up transaction:false

-- ── Wer kommentiert, wird gehört ────────────────────────────────────────────────────────────
--
-- Bisher erfuhr niemand, dass unter seiner Statusmeldung geschrieben wurde. Wer nicht zufällig
-- wieder hinsah, verpasste jede Antwort — und wer selbst unter einer fremden Meldung mitschrieb,
-- erst recht.
--
-- Eigene Migration nur für den Wert: Ein neuer Wert in einem Aufzählungstyp lässt sich erst
-- benutzen, wenn seine Transaktion festgeschrieben ist. Die Prüfung, die ihn benutzt, steht
-- deshalb in der nächsten.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'status_update_commented';


-- migrate:down

-- Der Wert bleibt stehen: PostgreSQL nimmt ihn nicht zurück, und den Typ neu zu bauen hieße, die
-- Spalte einer Tabelle mit Mitteilungen umzuhängen. Ohne die Prüfung aus der nächsten Migration
-- lässt ihn ohnehin niemand mehr hinein.
SELECT 1;
