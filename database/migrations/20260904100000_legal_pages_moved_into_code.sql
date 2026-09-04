-- migrate:up

-- **The legal notice and the privacy policy stop being editable pages.**
--
-- `20260903180000_legal_pages.sql` seeded them as custom pages so the team could write them in the
-- moderation area. They are views now — `ImprintView` and `PrivacyPolicyView`, taken from upstream
-- — because the operator's name, address and hoster belong in the deployment's configuration rather
-- than in a row: a second instance running this code must not publish this one's operator, and a
-- page that is copied rather than configured eventually is.
--
-- What the platform *does* with data is still written out in the view itself, at length, because
-- that is a property of the software and travels with it.
--
-- **Deleting them rather than leaving them** is the point of this migration. Two documents claiming
-- to be the same legal notice is worse than either alone: one still carried `[Vor- und Nachname]`
-- and `[Datum eintragen]`, and a reader who reached the old address would have found placeholders
-- where the law wants an answer. Nothing links to them any more, which is exactly how a stale page
-- survives unnoticed.
--
-- The custom-page mechanism itself stays, and so does everything else written with it — the
-- Blind-Date rules among them.
DELETE
FROM public.custom_page
WHERE slug IN ('impressum', 'datenschutz');

-- migrate:down

-- Deliberately empty of content: restoring the placeholder text would put an unfinished legal
-- notice back on a public address, and the rollback of a deployed page is a decision rather than a
-- reflex. `20260903180000_legal_pages.sql` still holds what was there, for anybody who wants it.
SELECT 1;
