-- migrate:up

-- The two Blind-Date texts, as ordinary custom pages.
--
-- **Deliberately not a third way of editing text.** The administration already has „Eigene Seiten"
-- and it already stores exactly this: a slug, a title, a body and who last touched it. Giving
-- Blind-Date its own editor would have been a second form doing the same job, and a second place
-- to look when somebody asks where the wording lives.
--
-- Seeded here rather than left to be created by hand, because the interface links to both by slug:
-- a page that does not exist is a link into nothing, and the whole reason the read route was built
-- was that such links existed.
--
-- The wording is the current draft. The administration edits it from here on and this migration is
-- not the source of truth afterwards — which is why the insert does nothing where a page with the
-- slug is already there.
INSERT INTO public.custom_page (slug, title, body, is_public)
VALUES ('blind-date',
        'Blind-Date',
        'Zwei Menschen schreiben miteinander, ohne zu wissen, wer der andere ist. Erst wenn ihr es beide wollt, gebt ihr euch zu erkennen.

Die Anonymität ist der ganze Sinn: Sie sorgt dafür, dass man sich auf Menschen einlässt, mit denen man sonst vielleicht nie geschrieben hätte. Innerhalb der Gruppe heißt ihr „Blind-Date-Partner 1" und „Blind-Date-Partner 2" — auch in Benachrichtigungen.

Bewerben kannst du dich rechts über das Formular: entweder auf eine der ausgeschriebenen Handlungen, oder mit einer beliebigen offiziellen RSH-Handlung, die du selbst nennst.',
        true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.custom_page (slug, title, body, is_public)
VALUES ('blind-date-regelwerk',
        'Blind-Date — Regelwerk',
        '1§ TEILNAHMEBEDINGUNGEN

1.1 Die Teilnahme am Blind-Date ist nur dann möglich, wenn du innerhalb der letzten dreißig Tage mindestens 1000 Online-Minuten aufweisen kannst. In den ersten drei Monaten nach Einführung dieses Features gilt diese Bedingung noch nicht — jede und jeder darf sich in dieser Zeit bewerben.

1.2 Du kannst dich auf eine der aktuell angebotenen Handlungen bewerben, oder proaktiv eine eigene offizielle RSH-Handlung als Blind-Date vorschlagen.

2§ PARTNERZUTEILUNG

2.1 Wenn du dich für das Blind-Date anmeldest, schmeißt du alle Vorurteile über Bord, die du manch anderen User:innen gegenüber vielleicht hast. Wir möchten verhindern, dass zugeteilte Partner:innen direkt abgelehnt werden, daher werden die Blind-Date-Schreiber:innen mit einem Pseudonym angezeigt.

2.2 Ein direkter Chat zwischen den beiden Beteiligten ist während der Anonymität technisch gesperrt. Solltet ihr eure Identität dennoch gegenseitig preisgeben wollen, geschieht das ausschließlich über die gemeinsame Enthüllung (siehe 2.3) — niemals einseitig.

2.3 Eine Enthüllung der eigenen Identität ist erst möglich, wenn 50 gemeinsame Beiträge im eigentlichen Rollenspiel-Thread zusammengekommen sind, und nur wenn beide Beteiligten zustimmen. Niemand soll gespoilert werden, der:die es nicht möchte.

2.4 Wird im gemeinsamen Austausch-Thread ein echter Benutzername erkannt, wird das automatisch der Moderation gemeldet. Bis eine menschliche Entscheidung getroffen wurde, bleibt das Blind-Date unverändert bestehen. Bestätigt sich der Verdacht, wird das Blind-Date beendet, die betroffene Person von künftigen Blind-Dates ausgeschlossen und per E-Mail informiert.

3§ WEITERE BLIND-DATES

3.1 Es ist immer nur ein aktives Blind-Date gleichzeitig pro Mitglied erlaubt. Nach einer Enthüllung oder Beendigung darf ein neues Blind-Date angefragt werden.

4§ ENTHÜLLUNG UND BEENDIGUNG

4.1 Ein Blind-Date kann auf zwei Arten enden: durch Enthüllung (beide stimmen zu, die Anonymität fällt, dieselbe Gruppe besteht unter echten Namen weiter) oder durch Beendigung ohne Enthüllung (z.B. bei Inaktivität oder auf eigenen Wunsch — die gewohnte 4-Monats-Regel für inaktive Gruppen gilt auch hier).

4.2 Bitte gebt dem Abenteuer nach der Anmeldung auch wirklich eine Chance und werft nicht direkt nach wenigen Tagen das Handtuch — bringt etwas Geduld, Flexibilität und Durchhaltevermögen mit.

4.3 Nach jeder Beendigung erhaltet ihr ein kurzes, freiwilliges Formular, in dem ihr das Blind-Date bewerten könnt. Wir sind dankbar für euer Feedback, um das Format bei Bedarf zu verbessern.',
        true)
ON CONFLICT (slug) DO NOTHING;

-- migrate:down

-- Only the seeded rows, and only where nobody has edited them since — a page the administration
-- rewrote is theirs, and rolling a migration back is no reason to take their wording away.
DELETE
FROM public.custom_page
WHERE slug IN ('blind-date', 'blind-date-regelwerk')
  AND updated_at = created_at;
