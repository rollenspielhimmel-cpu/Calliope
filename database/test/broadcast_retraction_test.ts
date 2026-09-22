import { assertEquals, assertRejects } from "@std/assert";
import { cleanUp, client, connect, firstRow, insertUser } from "./support.ts";

/**
 * Wer eine Rundmail zurueckgezogen hat und wann -- und was die Datenbank daran festhaelt.
 *
 * **Die Folgerungsform, nicht die Gleichheit.** Das ist der eine Test hier, auf den es ankommt:
 * Das Konto dessen, der zurueckgezogen hat, muss sich loeschen lassen. Eine Gleichheit zwischen den
 * beiden Spalten verboete genau den Zustand, den das Loeschen erzeugt -- dieselbe Falle wie einst
 * `publication_approval_is_whole`.
 */

Deno.test.beforeEach(connect);
Deno.test.afterEach(async () => {
  await client.query(
    `DELETE FROM public.publication WHERE kind = 'broadcast' AND id IN
       (SELECT publication_id FROM public.broadcast WHERE subject = 'db-test-zurueck')`,
  );
  await cleanUp();
});

/** Eine versendete Rundmail, direkt geschrieben -- die Route interessiert hier nicht. */
async function releasedBroadcast(approverId: string): Promise<string> {
  const publication = firstRow(
    (await client.query<{ id: string }>(
      `INSERT INTO public.publication (kind, status, approved_by, approved_at, released_at)
       VALUES ('broadcast', 'released', $1, now(), now()) RETURNING id`,
      [approverId],
    )).rows,
  );

  await client.query(
    `INSERT INTO public.broadcast
       (publication_id, subject, body, audience_roles, deliver_to_inbox, publish_in_archive)
     VALUES ($1, 'db-test-zurueck', 'Text', '{administrator}', true, false)`,
    [publication.id],
  );

  return publication.id;
}

Deno.test("the retractor's account can still be deleted", async () => {
  const retractor = await insertUser("retractor");
  const id = await releasedBroadcast(retractor);

  await client.query(
    `UPDATE public.publication SET retracted_by = $1, retracted_at = now() WHERE id = $2`,
    [retractor, id],
  );

  await client.query(`DELETE FROM public."user" WHERE id = $1`, [retractor]);

  const row = firstRow(
    (await client.query<{ retracted_by: string | null; retracted: boolean }>(
      `SELECT retracted_by, retracted_at IS NOT NULL AS retracted FROM public.publication WHERE id = $1`,
      [id],
    )).rows,
  );
  // Der Name geht mit dem Konto, dass zurueckgezogen wurde, bleibt.
  assertEquals(row.retracted_by, null);
  assertEquals(row.retracted, true);
});

Deno.test("a retractor without a time is refused", async () => {
  const retractor = await insertUser("retractor-no-time");
  const id = await releasedBroadcast(retractor);

  await assertRejects(() =>
    client.query(
      `UPDATE public.publication SET retracted_by = $1 WHERE id = $2`,
      [retractor, id],
    )
  );
});

Deno.test("only what went out can be retracted", async () => {
  const author = await insertUser("retract-waiting");
  const waiting = firstRow(
    (await client.query<{ id: string }>(
      `INSERT INTO public.publication (kind, status, written_by) VALUES ('broadcast', 'awaiting_approval', $1) RETURNING id`,
      [author],
    )).rows,
  );

  // Was noch wartet, wird verworfen, nicht zurueckgezogen.
  await assertRejects(() =>
    client.query(
      `UPDATE public.publication SET retracted_at = now() WHERE id = $1`,
      [waiting.id],
    )
  );

  await client.query(`DELETE FROM public.publication WHERE id = $1`, [
    waiting.id,
  ]);
});
