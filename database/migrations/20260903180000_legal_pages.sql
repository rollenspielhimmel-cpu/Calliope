-- migrate:up

-- Impressum and Datenschutzerklärung, as ordinary custom pages.
--
-- The same reasoning as the Blind-Date texts beside them: „Eigene Seiten" already stores a slug, a
-- title, a body and who last touched it, and the footer links to these two by slug — a link into
-- nothing is worse than no link. Seeded so the links resolve from the first start.
--
-- **Both are drafts with the operator's own details missing**, marked as `[…]` so that what is
-- unfilled is unmistakable rather than plausible. A placeholder that reads like a real address is
-- how a page ships half-written. The administration fills them in and edits from there; this
-- migration is not the source of truth afterwards, which is why the insert yields to an existing
-- page.
--
-- The Datenschutzerklärung describes **what this software actually does** — the retention periods,
-- the one third party, the fields on the account — read out of the code rather than copied from a
-- template. What it cannot know is who runs the instance and on whose hardware, so those are the
-- gaps. It is a draft to have checked, not legal advice.

INSERT INTO public.custom_page (slug, title, body, is_public)
VALUES ('impressum',
        'Impressum',
        'Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)

[Vor- und Nachname]
[Straße und Hausnummer]
[PLZ und Ort]
[Land, falls nicht Deutschland]

Kontakt

E-Mail: [E-Mail-Adresse]
[Telefonnummer, falls vorhanden]

Verantwortlich für den Inhalt nach § 18 Abs. 2 Medienstaatsvertrag (MStV)

[Vor- und Nachname]
[Anschrift, falls abweichend von oben]

Hinweis zur Betriebsform

Rollenspielhimmel ist ein privates, nicht gewerbliches Angebot. Es werden keine Entgelte
erhoben und es wird keine Werbung geschaltet.

Verbraucherstreitbeilegung

Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
Verbraucherschlichtungsstelle teilzunehmen.

Haftung für Inhalte von Mitgliedern

Die Beiträge in Gruppen, im Forum und in Profilen stammen von den Mitgliedern selbst. Wir machen
sie uns nicht zu eigen. Wenn dir ein Inhalt auffällt, der gegen Rechte oder Regeln verstößt, melde
ihn über die Meldefunktion oder schreib an die oben genannte Adresse — wir sehen uns das an.

────────────────────────────────────────────────────────────────────────

Noch auszufüllen: alle mit eckigen Klammern markierten Stellen. Diese Seite ist ein Entwurf und
ersetzt keine Rechtsberatung.',
        true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.custom_page (slug, title, body, is_public)
VALUES ('datenschutz',
        'Datenschutzerklärung',
        'Diese Erklärung beschreibt, welche Daten Rollenspielhimmel verarbeitet, warum, und wie lange.

1. Verantwortlich

[Vor- und Nachname]
[Straße und Hausnummer]
[PLZ und Ort]
E-Mail: [E-Mail-Adresse]

Eine Datenschutzbeauftragte oder einen Datenschutzbeauftragten gibt es nicht; dazu sind wir nicht
verpflichtet.

2. Wo die Daten liegen

Die Plattform läuft auf einem Server von [Hosting-Anbieter, z. B. Hetzner Online GmbH,
Industriestr. 25, 91710 Gunzenhausen] in [Standort, z. B. Nürnberg, Deutschland]. Mit dem Anbieter
besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.
[Falls noch nicht abgeschlossen: nachholen, bevor die Plattform öffentlich wird.]

3. Wenn du ein Konto anlegst

Gespeichert werden: Benutzername, E-Mail-Adresse und dein Passwort — letzteres nur als
kryptografischer Hash, aus dem es sich nicht zurückrechnen lässt. Dazu der Zeitpunkt der
Registrierung und, sobald du sie bestätigst, der Zeitpunkt der Bestätigung.

Freiwillig sind alle Profilangaben: Über mich, bevorzugte Schreibweise, Beitragslänge,
Schreibhäufigkeit, Erwartungen an Mitschreibende, NO-GOs und Lieblingsgenres. Du kannst sie
jederzeit ändern oder leer lassen.

Zweck: die Bereitstellung des Kontos. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO — ohne diese
Daten gibt es kein Konto.

4. Passwortprüfung über einen Dritten

Wenn du ein Passwort setzt, prüfen wir, ob es in bekannten Datenlecks vorkommt. Dafür wird der
Dienst „Have I Been Pwned" (haveibeenpwned.com) angefragt.

Dein Passwort verlässt den Server dabei nicht. Es wird gehasht, und nur die ersten fünf Zeichen
dieses Hashs werden übermittelt; der Abgleich findet bei uns statt. Der Dienst kann daraus nicht
erkennen, um welches Passwort es geht, und erfährt nicht, wer du bist.

Zweck: Schutz deines Kontos. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.

5. Wenn du angemeldet bist

Zu jeder Sitzung speichern wir deine IP-Adresse, die Kennung deines Browsers (User-Agent) und
wann die Sitzung begann. Eine Sitzung läuft nach 24 Stunden ohne Verlängerung ab und wird dann
gelöscht.

Außerdem halten wir fest, in welchen 15-Minuten-Fenstern du online warst. Daraus ergibt sich, wie
aktiv jemand ist — das brauchen wir unter anderem für die Teilnahmebedingung beim Blind-Date.
Diese Einträge werden nach 32 Tagen automatisch gelöscht.

Zweck: Betrieb, Sicherheit und Missbrauchserkennung. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.

6. Was du schreibst

Beiträge in Gruppen und im Forum, Nachrichten in Chats, Storyideen, Statusmeldungen, Kommentare
und hochgeladene Bilder speichern wir, solange die Plattform besteht oder bis du sie löschst.
Wer sie sehen kann, hängt von der jeweiligen Sichtbarkeit ab — bei Gruppen entscheidet ihr das
selbst.

Zweck: der Sinn der Plattform. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.

7. Moderation

Wenn du etwas meldest, speichern wir die Meldung mit deinem Namen, dem gemeldeten Inhalt und
deiner Begründung. Ergreift das Team Maßnahmen — Verwarnung, Sperre, Ausschluss vom Blind-Date —
wird auch das mit Grund und Zeitpunkt festgehalten.

Für die Moderation können IP-Adressen von Konten eingesehen und verglichen werden, um Mehrfach-
konten und Umgehungen von Sperren zu erkennen.

Zweck: ein Umgang miteinander, der für alle tragbar ist. Rechtsgrundlage: Art. 6 Abs. 1 lit. f
DSGVO.

8. E-Mails

Wir schreiben dir bei der Registrierung, beim Zurücksetzen des Passworts, bei Änderung der
E-Mail-Adresse und bei Ankündigungen des Teams.

[Solange die Plattform ohne echten Mail-Anbieter läuft, werden diese Nachrichten nicht zugestellt,
sondern in einem Postfach auf dem eigenen Server gesammelt, auf das nur das Team zugreifen kann.
Diesen Absatz ersetzen, sobald ein Mail-Anbieter eingerichtet ist — dann gehört hier hin, welcher
das ist und wo er sitzt.]

9. Blind-Date

Beim Blind-Date schreiben zwei Menschen zunächst anonym miteinander. Innerhalb der Gruppe siehst
du nicht, wer die andere Person ist, sondern nur „Blind-Date-Partner 1" oder „2". Auch
Benachrichtigungen nennen keine Namen.

Wer mit wem schreibt, ist auf dem Server gespeichert und für die Moderation einsehbar — sie muss
handeln können, wenn etwas schiefgeht. Öffentlich wird es erst, wenn ihr euch beide dafür
entscheidet.

Nach dem Ende fragen wir freiwillig nach einer kurzen Rückmeldung. Die Antworten sieht nur das
Team, nie die andere Person.

10. Cookies

Wir setzen ein einziges Cookie: die Sitzungskennung, die dich angemeldet hält. Es ist technisch
notwendig, läuft nach 24 Stunden ab und wird nicht für Werbung oder Statistik verwendet. Es gibt
kein Tracking, keine Analysedienste und keine eingebundenen Inhalte Dritter.

11. Sicherungskopien

Vom Datenbestand werden täglich Sicherungen erstellt und 14 Tage aufbewahrt. Löschst du dein
Konto, kann es bis zu 14 Tage dauern, bis auch die Sicherungen es nicht mehr enthalten.

12. Deine Rechte

Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17),
Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch
(Art. 21 DSGVO).

Schreib dafür an [E-Mail-Adresse]. Wir melden uns.

Außerdem kannst du dich bei einer Aufsichtsbehörde beschweren. Zuständig ist die Behörde deines
Wohnorts oder die des Verantwortlichen:
[Zuständige Landesdatenschutzbehörde eintragen — richtet sich nach dem Wohnsitz des
Verantwortlichen aus Abschnitt 1.]

13. Änderungen

Ändert sich, wie die Plattform mit Daten umgeht, ändern wir diese Seite. Bei wesentlichen
Änderungen sagen wir vorher Bescheid.

Stand: [Datum eintragen]

────────────────────────────────────────────────────────────────────────

Noch auszufüllen: alle mit eckigen Klammern markierten Stellen. Diese Seite ist ein Entwurf, der
beschreibt, was die Software tatsächlich tut — geprüft werden sollte er trotzdem von jemandem, der
sich mit Datenschutzrecht auskennt.',
        true)
ON CONFLICT (slug) DO NOTHING;

-- migrate:down

-- Only what nobody has edited: `updated_at` moves off `created_at` on the first save, and a page
-- somebody has written on is theirs rather than this migration's to remove.
DELETE
FROM public.custom_page
WHERE slug IN ('impressum', 'datenschutz')
  AND updated_at = created_at;
