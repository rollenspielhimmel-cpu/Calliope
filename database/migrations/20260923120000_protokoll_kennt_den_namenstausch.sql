-- migrate:up transaction:false

-- ── Der Namenstausch gehört ins Protokoll ───────────────────────────────────────────────────
--
-- **Offiziell machen ist die größte Änderung an einem Thread**, und sie stand als einzige nicht im
-- Protokoll: Wer den Absender vertauscht, ändert, wer die Plattform zu sagen scheint. Auf der Beta
-- ist genau das aus Versehen passiert und ließ sich weder nachlesen noch zurücknehmen.
--
-- `made_official` hält fest, unter welchem Namen er erscheint (und, bei einem Thread, der schon im
-- Forum stand, welcher Name vorher dastand); `unmade_official` das Zurücknehmen.
ALTER TYPE public.official_revision_kind ADD VALUE IF NOT EXISTS 'made_official';
ALTER TYPE public.official_revision_kind ADD VALUE IF NOT EXISTS 'unmade_official';


-- migrate:down

-- Die beiden Werte bleiben stehen: PostgreSQL nimmt sie nicht zurück, und den Typ neu zu bauen
-- hieße, die Spalte einer Tabelle mit Protokolleinträgen umzuhängen. Ohne die Prüfung aus der
-- nächsten Migration lässt sie ohnehin niemand mehr hinein.
SELECT 1;
