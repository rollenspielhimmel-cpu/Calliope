-- migrate:up

-- **Allein in dieser Datei, und das ist kein Ordnungsfimmel.**
--
-- PostgreSQL erlaubt seit Fassung 12, einen Aufzählungswert innerhalb einer Transaktion
-- hinzuzufügen — ihn dort auch schon zu *benutzen* aber nicht. dbmate legt jede Migration in eine
-- Transaktion, und die nächste Datei nennt diesen Wert in einer Prüfbedingung. Beides zusammen wäre
-- „unsafe use of new value of enum type", und zwar erst beim Anwenden, nicht beim Schreiben.
--
-- Also zwei Dateien: hier der Wert, nebenan alles, was ihn braucht.

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'broadcast_received';

-- migrate:down

-- Ein Aufzählungswert lässt sich nicht entfernen, solange irgendeine Zeile ihn trägt, und
-- PostgreSQL kennt kein DROP VALUE. Der Rückweg liegt in der nächsten Datei, die die Zeilen
-- wegräumt; dieser Wert bleibt als unbenutzter Eintrag stehen. Das kostet nichts und ist
-- ehrlicher, als eine Aufzählung neu zu bauen und dabei jede Fremdbeziehung anzufassen.
