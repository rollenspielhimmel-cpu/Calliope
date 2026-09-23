# Jeder Schreibvorgang in einer Transaktion

**Erledigt am 23.09.2026.** Was dabei herauskam, steht unten unter „Wie es gelaufen ist".

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

## Wie es gelaufen ist

Acht Schritte, jeder für sich grün, jeder für sich gepusht. Der Schlussstein sitzt in
`src/database/client.ts`: `db` wird als `WriteFreeDatabase` exportiert, und der Typ kennt
`insertInto`, `updateTable`, `deleteFrom`, `replaceInto` und `mergeInto` nicht mehr. Nach
dem Umbau: 974 Tests grün, `validate:check` sauber, Seed auf eine frische Datenbank durchgelaufen.

**Was mehr Arbeit war als gedacht.** Das Zurücklesen — fünfmal, in fünf verschiedenen Diensten,
immer derselbe 500er. Es steht oben als vierter Sonderfall, gehört aber ganz nach vorn: Wer einen
Dienst umstellt, sucht als Erstes die Lesehilfen, die er danach aufruft. Dafür gibt es jetzt
`Executor` in `client.ts` — das gemeinsame Handle **oder** eine offene Transaktion, mit dem
Grund an Ort und Stelle.

**Was weniger Arbeit war als gedacht.** Die Aufrufer. Ein kurzes Skript hat die Schreibstellen
gezählt und umgeschrieben; der Compiler hat den Rest aufgezählt. Von 86 offenen Schreibstellen im
Produktivcode auf null in neun Commits.

**Was sich nebenbei verbessert hat.**

- `approve()` schreibt in der Transaktion des Aufrufers, `releaseIfDue()` läuft **danach**. Die
  Rundmail geht damit nie aus einer offenen Transaktion heraus — genau der Fehler, der den Umbau
  ausgelöst hat, ist jetzt strukturell ausgeschlossen.
- Der Seed räumt und schreibt in **einer** Transaktion. Bricht er in der Mitte, steht die
  Entwicklungsdatenbank nicht mehr leer da.
- Zwei Testdateien hatten eine eigene Hilfe namens `write`. Sie heißen jetzt `writePost` und
  `writeAsMember` und sagen damit auch besser, was sie tun.

**Was offen blieb.** Nichts am Umbau selbst. Was noch aussteht, steht in der Liste an Chiara am Ende
des Durchgangs — es gehört zum Abhängigkeits-Paket, nicht hierher.
