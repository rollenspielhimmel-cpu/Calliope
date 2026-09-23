# Jeder Schreibvorgang in einer Transaktion

**Warum:** Eine Rundmail galt bei uns als versendet, ohne zugestellt zu sein — zwei Schreibvorgänge,
einer ging durch, der andere nicht. Upstream hat dieselbe Klasse von Fehler abgestellt
(`058fd7c`, „All writes in a transaction"), und zwar so, dass sie nicht wiederkommen kann: Das
`db`-Handle verliert `insertInto`, `updateTable` und `deleteFrom` **im Typ**. Wer schreiben will,
braucht eine Transaktion, und der Compiler sagt es — nicht eine Konvention, an die man sich
erinnern muss.

Ein schreibender Dienst nimmt die Transaktion von seinem Aufrufer entgegen. Wer sie öffnet, ist der
Einstiegspunkt: eine Route, `cron.ts`, eine Hintergrundaufgabe, der Seed, ein Test.

## Der Umfang, gemessen am 22.09.2026

- Seine Änderung: **116 Dateien**, +2293/−1637. Davon haben **41 wir verändert** — dort ist es
  Handarbeit; die übrigen ~75 lassen sich weitgehend übernehmen.
- Unser eigener Code, den seine Änderung nicht kennt: **113 neue Dienste und Routen**, davon
  **13 Dienste, die schreiben, ohne je eine Transaktion zu öffnen**.
- Schreibende Dateien im Backend insgesamt: **54** ohne Tests, dazu **99** Test- und Hilfsdateien.

Grob das Doppelte seiner Änderung, also Richtung 200 Dateien. Mechanische Arbeit mit einem sehr
guten Begleiter: Der Compiler zählt jede Stelle auf, die Testsuite fängt Fehler.

## Die Reihenfolge — der Schlussstein kommt zuletzt

**Nach jedem Schritt ist alles grün.** Die Typ-Änderung am `db`-Handle steht am Ende, nicht am
Anfang: Sonst ist der Baum kaputt, bis alles fertig ist.

0. **Werkzeug holen.** Den Test-Helfer `write()` aus `test/support.ts` übernehmen, den
   `Transaction`-Typ bereitstellen. Sonst ändert sich nichts.
1. **Unsere kleinen Dienste**, einer nach dem anderen: Wortfilter, gesperrte E-Mail-Domänen,
   Absender, Watchlist, Plattformrollen, Rechte. Fünf bis sieben kurze Schritte.
2. **Unsere großen Brocken:** Blind-Date, Statusmeldungen, IP-Moderation, Aktivität.
3. **Die geteilten Dateien**, mit seinem Diff als Vorlage: Forum, Gruppen, Konten und Sitzungen.
4. **Unsere Veröffentlichungen:** Rundmails, Postfach, offizielle Threads. Zuletzt, weil hier die
   meisten mehrstufigen Vorgänge sitzen — und weil genau hier unser Fehler saß.
5. **Die drei Sonderfälle**, bewusst geprüft (siehe unten).
6. **Tests und Helfer nachziehen:** 99 Dateien, rein mechanisch.
7. **Der Schlussstein:** dem `db`-Handle die Schreibmethoden im Typ wegnehmen. Der Compiler listet
   auf, was übrig ist. Danach ganze Suite, frische Datenbank, Gegenproben.

## Die drei Stellen, an denen es wehtun kann

- **Ereignisse gehören nach das Festschreiben.** `publishChatEvent` und alles, was einen Strom
  bedient, darf nicht aus einer offenen Transaktion heraus melden: Sonst sieht jemand eine
  Nachricht, die noch zurückgerollt werden kann.
- **Fremde Dienste gehören nicht hinein.** E-Mail-Versand und die Passwort-Prüfung gegen die Liste
  geleakter Passwörter dürfen nicht in einer offenen Transaktion hängen — eine Anfrage hielte sonst
  Sperren, während sie auf jemand anderen wartet.
- **`LOCK TABLE public.inbox_folder`** in `admin_inbox_folder_service.ts` verträgt sich mit dem
  Umbau, will aber nachgemessen sein: Die Sperre gilt bis zum Ende der Transaktion, und die wird
  danach vom Aufrufer geöffnet.

- **Das Zurücklesen muss dieselbe Transaktion benutzen.** Ein Dienst, der schreibt und die Zeile
  danach über eine Lesehilfe an `db` neu liest, findet sie nicht: Die Transaktion ist noch nicht
  festgeschrieben, und die zweite Verbindung sieht nichts. Das ergab bei den Statusmeldungen prompt
  einen 500er. Die Lesehilfen nehmen deshalb den Ausführenden entgegen — ohne Transaktion bleibt
  alles wie bisher.

## Woran wir merken, dass nichts kaputtging

Es ist ein Umbau **ohne Verhaltensänderung und ohne Migration**. Der Prüfstein ist die bestehende
Suite, nicht eine Reihe neuer Zusagen. Wo doch etwas Neues behauptet wird — „das Ereignis geht erst
nach dem Festschreiben raus" —, gehört ein Test mit Gegenprobe dazu.

## Wann

In einem Durchgang, an dem niemand die Beta testen muss: Der Umbau braucht keine Abnahme, er
braucht Ruhe. Deployt wird am Ende in einem Stück, nicht zwischendurch.

**Und früh.** Es ist der eine Umbau, der mit jeder Woche teurer wird, weil er alles anfasst, was wir
neu schreiben. Maxi ist unterrichtet, dass wir ihn bei uns nachziehen — damit nicht beide
gleichzeitig durch dieselben Dateien räumen.
