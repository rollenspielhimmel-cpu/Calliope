import { assertEquals, assertRejects } from "@std/assert";
import {
  cleanUp,
  client,
  connect,
  firstRow,
  insertUser,
  TEST_PREFIX,
} from "./support.ts";

/**
 * Eine Rundmail braucht eine Rolle oder einen Namen -- auf jedem Weg, nicht nur ueber die Route.
 *
 * **Warum diese Datei an der Schnittstelle vorbeigeht:** Die Route prueft dasselbe mit Zod und
 * faengt den Fall vorher ab. Ein Test ueber die Route bliebe deshalb gruen, auch wenn die Regel in der
 * Datenbank gar nicht stuende -- er belegte Zod, nicht `broadcast_has_an_audience`. Hier wird
 * direkt geschrieben, damit genau das eine geprueft ist, was die Migration zusagt.
 *
 * **Und die beiden Dinge, die der Ausloeser absichtlich nicht tut**, stehen genauso da wie das, was
 * er tut. Beides ist eine Entscheidung, und eine Entscheidung ohne Test wird beim naechsten
 * Aufraeumen "vervollstaendigt".
 */

Deno.test.beforeEach(connect);
Deno.test.afterEach(async () => {
  // Rundmails ueberleben ihren Verfasser, also gehen sie hier ueber den Betreff.
  await client.query(
    `DELETE FROM public.publication WHERE id IN
       (SELECT publication_id FROM public.broadcast WHERE subject LIKE $1)`,
    [`${TEST_PREFIX}%`],
  );
  await cleanUp();
});

/**
 * Schreibt eine Rundmail samt Namen in **einer** Transaktion, so wie `submit` es tut.
 *
 * Die Reihenfolge ist die echte -- erst die Rundmail, dann die Namen --, denn sie ist der ganze
 * Grund, warum geprueft wird, wenn festgeschrieben wird, und nicht vorher.
 */
async function writeBroadcast(
  subject: string,
  roles: string[],
  recipientIds: string[],
  archive = false,
): Promise<string> {
  await client.query("BEGIN");

  try {
    const publication = firstRow(
      (await client.query<{ id: string }>(
        `INSERT INTO public.publication (kind) VALUES ('broadcast') RETURNING id`,
      )).rows,
    );

    const broadcast = firstRow(
      (await client.query<{ id: string }>(
        `INSERT INTO public.broadcast
           (publication_id, subject, body, audience_roles, deliver_to_inbox, publish_in_archive)
         VALUES ($1, $2, 'Text', $3, true, $4)
         RETURNING id`,
        [publication.id, `${TEST_PREFIX}${subject}`, roles, archive],
      )).rows,
    );

    for (const userId of recipientIds) {
      // deno-lint-ignore no-await-in-loop -- eine Transaktion, eine Verbindung: nacheinander
      await client.query(
        `INSERT INTO public.broadcast_recipient (broadcast_id, user_id) VALUES ($1, $2)`,
        [broadcast.id, userId],
      );
    }

    await client.query("COMMIT");

    return broadcast.id;
  } catch (failure) {
    // Ist das COMMIT gescheitert, hat PostgreSQL schon zurueckgerollt; ein ROLLBACK schadet dann
    // nicht. Ist etwas davor gescheitert, braucht es genau diesen.
    await client.query("ROLLBACK");
    throw failure;
  }
}

Deno.test("a broadcast with neither a role nor a name is refused", async () => {
  const failure = await assertRejects(() =>
    writeBroadcast("niemand", [], [])
  ) as { code?: string; constraint?: string };

  // Dieselbe Fehlerform wie die `CHECK`, die vorher hier stand. Wer auf die Meldung reagiert, soll
  // von dem Umbau nichts merken.
  assertEquals(failure.code, "23514");
  assertEquals(failure.constraint, "broadcast_has_an_audience");
});

Deno.test("a broadcast with names and no role is accepted", async () => {
  // Der Fall, fuer den es die Migration gibt: Hier lief die alte `CHECK` hinein, und ueber die
  // Schnittstelle kam ein 500 zurueck.
  const first = await insertUser("audience-first");
  const second = await insertUser("audience-second");

  await writeBroadcast("nur-namen", [], [first, second]);
});

Deno.test("a broadcast with a role and no names is accepted", async () => {
  // Wie bisher -- die neue Regel ist schwaecher als die alte und darf nichts verbieten, was ging.
  await writeBroadcast("nur-rolle", ["administrator"], []);
});

Deno.test("taking every role away later is refused when no name is left", async () => {
  const broadcastId = await writeBroadcast("rolle-weg", ["moderator"], []);

  // `edit()` schreibt `audience_roles` jedes Mal mit; darauf hoert der Ausloeser.
  await assertRejects(() =>
    client.query(
      `UPDATE public.broadcast SET audience_roles = '{}' WHERE id = $1`,
      [broadcastId],
    )
  );
});

Deno.test("deleting the only named recipient's account still works", async () => {
  // **Die erste bewusste Luecke.** `broadcast_recipient.user_id` ist `ON DELETE CASCADE`. Pruefte
  // ein Ausloeser beim Loeschen eines Namens, waere ein Konto unloeschbar, sobald es je einziger
  // namentlicher Empfaenger einer Rundmail war -- dieselbe Falle wie
  // `publication_approval_is_whole`. Die Regel heisst "wird mit einem Empfaengerkreis geschrieben",
  // nicht "hat fuer immer einen".
  const only = await insertUser("audience-only");
  const broadcastId = await writeBroadcast("einziger", [], [only]);

  await client.query(`DELETE FROM public."user" WHERE id = $1`, [only]);

  const left = await client.query(
    `SELECT 1 FROM public.broadcast_recipient WHERE broadcast_id = $1`,
    [broadcastId],
  );
  assertEquals(left.rowCount, 0, "der Name ist mit dem Konto gegangen");
});

Deno.test("recording the reach of a broadcast whose names are gone still works", async () => {
  // **Die zweite bewusste Luecke.** Beim Versand schreibt die Freigabe `recipient_count` in dieselbe
  // Zeile. Hoerte der Ausloeser auf jedes `UPDATE`, fiele eine Rundmail, deren Genannte vor dem
  // Versand alle gegangen sind, in jedem Takt erneut um.
  const only = await insertUser("audience-gone");
  const broadcastId = await writeBroadcast("verwaist", [], [only]);
  await client.query(`DELETE FROM public."user" WHERE id = $1`, [only]);

  await client.query(
    `UPDATE public.broadcast SET recipient_count = 0 WHERE id = $1`,
    [broadcastId],
  );
});

/**
 * Ins Archiv kommt nur eine Rundmail an alle: alle drei Rollen und kein Name.
 *
 * Wie oben an der Route vorbei -- die prueft dasselbe mit Zod, und ein Test ueber sie bliebe gruen,
 * auch wenn `broadcast_archive_only_to_everyone` gar nicht da waere.
 */
const EVERYONE = ["administrator", "moderator", "member"];

Deno.test("a broadcast to one role is refused the archive", async () => {
  const failure = await assertRejects(() =>
    writeBroadcast("archiv-rolle", ["moderator"], [], true)
  ) as { code?: string; constraint?: string };

  assertEquals(failure.code, "23514");
  assertEquals(failure.constraint, "broadcast_archive_only_to_everyone");
});

Deno.test("a broadcast to everyone may go to the archive", async () => {
  await writeBroadcast("archiv-alle", EVERYONE, [], true);
});

Deno.test("naming somebody on top of everyone is refused the archive", async () => {
  // Fuegt niemanden hinzu -- aber "an alle" heisst in der Regel auch "kein Name", damit sie ohne
  // die Oberflaeche dasselbe sagt wie mit ihr.
  const extra = await insertUser("archive-extra");

  await assertRejects(() =>
    writeBroadcast("archiv-alle-und-name", EVERYONE, [extra], true)
  );
});

Deno.test("switching the archive on later is refused for one role", async () => {
  const broadcastId = await writeBroadcast("archiv-spaeter", ["moderator"], []);

  await assertRejects(() =>
    client.query(
      `UPDATE public.broadcast SET publish_in_archive = true WHERE id = $1`,
      [broadcastId],
    )
  );
});

Deno.test("taking a role away from an archived broadcast is refused", async () => {
  const broadcastId = await writeBroadcast(
    "archiv-rolle-weg",
    EVERYONE,
    [],
    true,
  );

  await assertRejects(() =>
    client.query(
      `UPDATE public.broadcast SET audience_roles = '{administrator,moderator}' WHERE id = $1`,
      [broadcastId],
    )
  );
});
