-- migrate:up

-- **§2.2 des Blind-Date-Regelwerks, nachgezogen statt im Ausgangsstand überschrieben.**
--
-- Der Satz stand ursprünglich im Ausgangsstand und wurde dort geändert, als die Chat-Sperre
-- zurückgebaut wurde: Außerhalb des Blind-Dates sind die beiden gewöhnliche Mitglieder. Das war
-- der bequeme Weg und der falsche — die Beta hatte den Ausgangsstand längst angewandt, und dbmate
-- führt eine bekannte Fassung nie erneut aus. Für das Deploy-Skript sah die geänderte Datei
-- deshalb aus wie eine Datenbank, die nicht mehr zum Stand passt, und es verlangte einen Neubau:
-- jede Zeile gelöscht, jedes Konto, 21 Schreibgruppen und 185 Beiträge.
--
-- Also andersherum. Der Ausgangsstand trägt wieder den Satz, den er ausgeliefert hat, und diese
-- Migration ändert ihn — bei einer frischen Datenbank eine Sekunde nach dem Anlegen, auf der Beta
-- jetzt. Beide landen beim selben Text, und keine angewandte Fassung wurde angefasst.
--
-- `replace` auf dem Absatz statt einer neuen Gesamtfassung der Seite: Das Regelwerk ist lang, und
-- eine zweite vollständige Abschrift hier wäre eine zweite Stelle, die bei der nächsten Änderung
-- vergessen wird. Trifft `replace` nichts, bleibt der Text wie er ist — der Fall, dass jemand den
-- Absatz vorher von Hand angepasst hat, endet damit ohne Schaden statt mit einem Fehlschlag.

UPDATE public.custom_page
SET body       = replace(
        body,
        '2.2 Ein direkter Chat zwischen den beiden Beteiligten ist während der Anonymität technisch gesperrt. Solltet ihr eure Identität dennoch gegenseitig preisgeben wollen, geschieht das ausschließlich über die gemeinsame Enthüllung (siehe 2.3) — niemals einseitig.',
        '2.2 Innerhalb des Blind-Dates schreibt ihr ausschließlich über eure Pseudonyme; einen privaten Chat zwischen „Blind-Date-Partner 1“ und „Blind-Date-Partner 2“ gibt es nicht. Außerhalb seid ihr gewöhnliche Mitglieder und könnt einander schreiben wie allen anderen auch — ihr wisst dabei nur nicht, wer die andere Person im Blind-Date ist. Eure Identität gebt ihr einander ausschließlich über die gemeinsame Enthüllung preis (siehe 2.3), niemals einseitig.'
                 ),
    updated_at = now()
WHERE slug = 'blind-date-regelwerk';

-- migrate:down

UPDATE public.custom_page
SET body       = replace(
        body,
        '2.2 Innerhalb des Blind-Dates schreibt ihr ausschließlich über eure Pseudonyme; einen privaten Chat zwischen „Blind-Date-Partner 1“ und „Blind-Date-Partner 2“ gibt es nicht. Außerhalb seid ihr gewöhnliche Mitglieder und könnt einander schreiben wie allen anderen auch — ihr wisst dabei nur nicht, wer die andere Person im Blind-Date ist. Eure Identität gebt ihr einander ausschließlich über die gemeinsame Enthüllung preis (siehe 2.3), niemals einseitig.',
        '2.2 Ein direkter Chat zwischen den beiden Beteiligten ist während der Anonymität technisch gesperrt. Solltet ihr eure Identität dennoch gegenseitig preisgeben wollen, geschieht das ausschließlich über die gemeinsame Enthüllung (siehe 2.3) — niemals einseitig.'
                 ),
    updated_at = now()
WHERE slug = 'blind-date-regelwerk';
