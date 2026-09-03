-- migrate:up

-- § 2.4 of the Blind-Date rules, said better.
--
-- **Nothing behind it changes.** The guard still reports to the moderation and still waits for a
-- person; what changes is that the rule now says what happens in *both* directions, including the
-- one that had been left out — a suspicion that turns out to be nothing, which is the likely case
-- when a username happens to be an ordinary German word.
--
-- The old wording opened with „bleibt das Blind-Date unverändert bestehen", which reads as a
-- reassurance about a thing that has already gone wrong rather than as a description of what
-- happens.
--
-- A migration of its own rather than an edit to the one that seeded the page: that page is out
-- there, and an insert that yields to an existing row cannot change one. A targeted `replace`
-- rather than a whole new body, so that anything else the administration has since written on this
-- page survives — and where somebody has already rewritten this paragraph, the old text is not
-- found and nothing happens.
--
-- 20260903150000 seeds the new wording directly, so on a fresh database this finds nothing to do.

UPDATE public.custom_page
SET body = replace(
        body,
        '2.4 Wird im gemeinsamen Austausch-Thread ein echter Benutzername erkannt, wird das automatisch der Moderation gemeldet. Bis eine menschliche Entscheidung getroffen wurde, bleibt das Blind-Date unverändert bestehen. Bestätigt sich der Verdacht, wird das Blind-Date beendet, die betroffene Person von künftigen Blind-Dates ausgeschlossen und per E-Mail informiert.',
        '2.4 Versucht eine oder versuchen beide beteiligte Personen, sich im Austausch-Thread zu erkennen zu geben, wird das automatisch an die Moderation gemeldet. Bestätigt sich der Verdacht, wird das Blind-Date beendet, die betroffene Person von künftigen Blind-Dates ausgeschlossen und per E-Mail informiert. Stellt sich der Verdacht als unbegründet heraus (z.B. weil ein Wort zufällig wie ein Nutzername klingt), läuft das Blind-Date unverändert weiter.'
           )
WHERE slug = 'blind-date-regelwerk'
  AND body LIKE '%Bis eine menschliche Entscheidung getroffen wurde%';

-- migrate:down

UPDATE public.custom_page
SET body = replace(
        body,
        '2.4 Versucht eine oder versuchen beide beteiligte Personen, sich im Austausch-Thread zu erkennen zu geben, wird das automatisch an die Moderation gemeldet. Bestätigt sich der Verdacht, wird das Blind-Date beendet, die betroffene Person von künftigen Blind-Dates ausgeschlossen und per E-Mail informiert. Stellt sich der Verdacht als unbegründet heraus (z.B. weil ein Wort zufällig wie ein Nutzername klingt), läuft das Blind-Date unverändert weiter.',
        '2.4 Wird im gemeinsamen Austausch-Thread ein echter Benutzername erkannt, wird das automatisch der Moderation gemeldet. Bis eine menschliche Entscheidung getroffen wurde, bleibt das Blind-Date unverändert bestehen. Bestätigt sich der Verdacht, wird das Blind-Date beendet, die betroffene Person von künftigen Blind-Dates ausgeschlossen und per E-Mail informiert.'
           )
WHERE slug = 'blind-date-regelwerk'
  AND body LIKE '%Stellt sich der Verdacht als unbegründet heraus%';
