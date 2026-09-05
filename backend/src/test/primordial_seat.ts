import { db } from "@/src/database/client.ts";
import { ROOT_ADMIN_USERNAME } from "@/src/service/root_admin_service.ts";

/**
 * Borrowing the one primordial-administrator seat, for tests that need a session holding it.
 *
 * **There is exactly one**, enforced by `user_one_primordial_admin_idx`, and the suite runs its
 * files in parallel. A file that frees the seat and takes it for its own fixture is therefore
 * taking it from whoever else is mid-test — which is how three green files became five red ones the
 * moment a third wanted it.
 *
 * `blind_date_access_test.ts` avoids this by only ever reading who holds it, and says so: taking it
 * there „would make the *other* file fail instead". That works when you need an id. It does not
 * work when you need to be signed in as the holder, because a session needs an account whose
 * password the test knows.
 *
 * So this waits instead. The take is one transaction — free the current holder, claim it — and the
 * unique index decides who wins when two files reach for it at the same moment; the loser sees the
 * constraint fail and tries again. That makes the seat a real lock rather than a convention, and
 * the next file that wants it has something to reach for.
 *
 * **Everything a test does to `is_primordial_admin` belongs here**, `withVacantPrimordialSeat` at
 * the bottom included, which reaches for the seat in order to leave it empty. A file that changes
 * the flag on its own is not a participant in the lock, it is the reason the lock fails.
 */

/**
 * Wie lange auf den Platz gewartet wird, bevor aufgegeben wird.
 *
 * **Das muss mit der Zahl der Tests wachsen, die ihn wollen** — und das ist der Grund, warum hier
 * eine Minute steht und nicht fünf Sekunden. Fünf Dateien leihen ihn sich inzwischen, zusammen
 * rund vierzig Tests, jeder hält ihn für etwa eine Sekunde. Wer als Letzter drankommt, wartet
 * dreißig Sekunden auf einen Platz, der die ganze Zeit ordentlich weitergereicht wurde.
 *
 * Die alte Grenze von fünf Sekunden hat genau das für ein Hängen gehalten und die halbe Datei rot
 * gefärbt. Lieber lange warten und durchkommen als früh aufgeben und lügen; ein wirklich
 * verwaister Platz fällt dann eben nach einer Minute auf, mit einem Satz, der es sagt.
 */
const ATTEMPTS = 1200;
const PAUSE_MILLISECONDS = 50;

/**
 * Ab wie vielen Versuchen ein leerer Platz als verwaist gilt und wieder besetzt wird.
 *
 * **Ein leerer Platz ist nicht immer kaputt.** `withVacantPrimordialSeat` räumt ihn mit Absicht für
 * die Dauer eines Rumpfes, und wer in dem Moment wartet, soll warten — deshalb repariert das hier
 * nicht sofort.
 *
 * Kaputt ist er, wenn niemand ihn wieder besetzt, und das passiert nach einem abgebrochenen Lauf:
 * Ein Abbruch mitten im Test überspringt jedes `finally`, der Platz bleibt leer, und **jeder
 * spätere Lauf hängt eine Minute und wird rot**, ohne dass am Code etwas falsch wäre. Genau das ist
 * passiert, und die Suche danach kostete mehr Zeit als der Fehler wert war. Zehn Sekunden
 * ununterbrochener Leere sind länger, als ein echter Rumpf je braucht, und kurz genug, dass der
 * nächste Lauf sich selbst hilft, statt zu lügen.
 */
const VACANT_UNTIL_ORPHANED = 200;

/**
 * Takes the seat from `from`, and only from `from`.
 *
 * **The `from` is what makes this a lock.** It used to free whoever held the seat, which reads as
 * the same thing and is not: two files that both saw `Admin` holding it would both then take it,
 * the second silently unseating the first, and the first would go on believing it held the seat
 * until an assertion three lines later said 403. Naming who we are taking it from turns the two
 * statements into a compare-and-swap — if somebody got there first, the release matches no row and
 * we leave empty-handed.
 */
async function claim(from: string, to: string): Promise<boolean> {
  try {
    return await db.transaction().execute(async (transaction) => {
      // Freeing first and claiming second: between the two statements nobody holds it, which the
      // partial unique index allows. The other order would have two holders for an instant and
      // fail every time.
      const released = await transaction
        .updateTable("user")
        .set({ isPrimordialAdmin: false })
        .where("username", "=", from)
        .where("isPrimordialAdmin", "=", true)
        .returning("id")
        .executeTakeFirst();

      if (released === undefined) {
        return false;
      }

      const taken = await transaction
        .updateTable("user")
        .set({ isPrimordialAdmin: true })
        .where("username", "=", to)
        .returning("id")
        .executeTakeFirst();

      // **Der Empfänger muss die Zeile auch bekommen haben.** Fehlt das Konto gerade — und
      // `root_admin_service_test.ts` benennt `Admin` für die Dauer eines Tests genau so weg —,
      // dann hat die zweite Anweisung nichts getroffen, die erste sehr wohl: der Platz wäre danach
      // leer, für den Rest des Laufs und für jeden folgenden. Lieber zurückrollen, dann versucht
      // der Aufrufer es gleich noch einmal.
      if (taken === undefined) {
        throw new Error("nobody to hand the primordial seat to");
      }

      return true;
    });
  } catch {
    // Somebody else claimed it between our read and our write, or the receiving account was not
    // there. Nothing is wrong; wait and retry.
    return false;
  }
}

/** Wer den Platz gerade hält — oder niemand. */
async function holder(): Promise<string | undefined> {
  const row = await db
    .selectFrom("user")
    .select("username")
    .where("isPrimordialAdmin", "=", true)
    .executeTakeFirst();

  return row?.username;
}

/** Setzt einen verwaisten Platz auf das hochgefahrene Konto zurück, falls es das gerade gibt. */
async function repairOrphanedSeat(): Promise<void> {
  await db
    .updateTable("user")
    .set({ isPrimordialAdmin: true })
    .where("username", "=", ROOT_ADMIN_USERNAME)
    .execute()
    .catch(() => {});
}

/**
 * Wartet, bis der Platz frei ist, und greift dann mit `take` zu; gibt auf, wenn das zu lange nicht
 * gelingt.
 *
 * „Frei" heißt: das hochgefahrene Konto hält ihn. Jeder andere Halter ist die Vorrichtung einer
 * anderen Datei, und ihm den Platz wegzunehmen ist genau der Fehler, für den es diese Datei gibt.
 */
async function waitForSeat(
  take: () => Promise<boolean>,
  purpose: string,
): Promise<void> {
  let vacant = 0;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // deno-lint-ignore no-await-in-loop -- sequential is the point: this waits for a lock
    const who = await holder();

    if (who === undefined) {
      vacant++;
    } else {
      vacant = 0;

      // deno-lint-ignore no-await-in-loop -- ein Versuch nach dem anderen, das ist die Warteschleife
      if (who === ROOT_ADMIN_USERNAME && await take()) {
        return;
      }
    }

    if (vacant >= VACANT_UNTIL_ORPHANED) {
      vacant = 0;
      // deno-lint-ignore no-await-in-loop -- eine Reparatur nach der anderen
      await repairOrphanedSeat();
    }

    // deno-lint-ignore no-await-in-loop -- the pause between attempts
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MILLISECONDS));
  }

  throw new Error(
    `the primordial seat did not come free within ${
      (ATTEMPTS * PAUSE_MILLISECONDS) / 1000
    } seconds (${purpose})`,
  );
}

/**
 * Waits until the seat is held by the bootstrapped account — meaning no other file is using it —
 * and then moves it to `username`. Pair every call with `returnPrimordialSeat`.
 */
export function borrowPrimordialSeat(username: string): Promise<void> {
  return waitForSeat(
    () => claim(ROOT_ADMIN_USERNAME, username),
    `borrowing it for ${username}`,
  );
}

/**
 * Gives the seat back to the bootstrapped account — but **only if `username` still holds it**.
 *
 * The condition is the whole point, and it was missing. Without it this frees whoever holds the
 * seat, including another file that has just taken it: file A finishes and hands back while file B
 * is mid-claim, B's row is cleared, and B then fails asserting the very thing it borrowed the seat
 * for. It showed up the day a third file wanted the seat, as one red test in one run out of four —
 * which is exactly how long such a thing survives when the check is left out.
 *
 * Versucht es wieder, weil `Admin` gerade weggenannt sein kann: Dann ginge der Platz nirgendwohin,
 * und ihn trotzdem loszulassen hieße, ihn zu verwaisen. Nach der vollen Wartezeit gibt das hier
 * stillschweigend auf — ein Fehler an dieser Stelle würde den Test überdecken, der ihn ausgelöst
 * hat.
 *
 * Must run even when the test failed, or every later file waits a minute and then fails too —
 * so it belongs in an `afterEach`, not at the end of a test body.
 */
export async function returnPrimordialSeat(username: string): Promise<void> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // deno-lint-ignore no-await-in-loop -- ein Versuch nach dem anderen
    const who = await holder();

    // Wir halten ihn nicht mehr: entweder nie gehabt oder längst zurückgegeben. Beides in Ordnung.
    if (who !== username) {
      return;
    }

    // deno-lint-ignore no-await-in-loop -- dasselbe
    if (await claim(username, ROOT_ADMIN_USERNAME)) {
      return;
    }

    // deno-lint-ignore no-await-in-loop -- die Pause zwischen den Versuchen
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MILLISECONDS));
  }
}

/**
 * Führt `body` aus, während **niemand** den Platz hält.
 *
 * Für die Tests des Hochfahrens: Die prüfen, was geschieht, wenn es noch keinen Ur-Admin gibt, und
 * müssen den vorhandenen dafür aus dem Weg räumen. Das ist derselbe Zugriff auf denselben Platz wie
 * ein Ausleihen, nur mit niemandem als Ziel — und **deshalb muss es durch dieselbe Sperre.** Ohne
 * sie hat diese Datei den Platz mitten aus der Vorrichtung einer anderen herausgezogen, ihn beim
 * Zurückgeben gegen den Eindeutigkeits-Index laufen lassen und das Konto unter seinem Ersatznamen
 * stehen gelassen; die Rechnung kam als zwanzig rote Tests in fünf Dateien.
 *
 * Das Wegräumen und das Zurückholen bleiben beim Aufrufer, weil dabei auch der Name des Kontos
 * getauscht wird und diese Datei von Namen nichts wissen muss.
 */
export async function withVacantPrimordialSeat<T>(
  vacate: () => Promise<void>,
  restore: () => Promise<void>,
  body: () => Promise<T>,
): Promise<T> {
  await waitForSeat(async () => {
    await vacate();
    return true;
  }, "emptying it for the bootstrap tests");

  try {
    return await body();
  } finally {
    await restore();
  }
}
