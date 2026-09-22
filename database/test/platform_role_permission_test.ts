import { assertEquals, assertRejects } from "@std/assert";
import { cleanUp, client, connect, firstRow, insertUser } from "./support.ts";

/**
 * Was eine Rolle darf -- `platform_role_permission`.
 *
 * **Keine Zeile fuer Administrationen.** Sie duerfen alles; eine Zeile fuer sie waere eine, deren
 * Fehlen etwas bedeuten koennte, und dann liesse sich die Administration aus dem Vorbereiten
 * aussperren -- und damit aus dem Freigeben dessen, was sie selbst schreibt.
 *
 * Die Zeile der Moderation gilt fuer die ganze Datenbank. Was sie hier anfasst, geschieht deshalb
 * in einer Transaktion, die zurueckgerollt wird.
 */

Deno.test.beforeEach(connect);
Deno.test.afterEach(cleanUp);

Deno.test("the migration lets moderators prepare publications", async () => {
  const rows = (await client.query<{ role: string; permission: string }>(
    `SELECT role, permission FROM public.platform_role_permission ORDER BY role, permission`,
  )).rows;

  assertEquals(rows, [
    { role: "moderator", permission: "prepare_publications" },
    // Seit `moderation_sieht_die_warteschlange`: wie bisher alles, jetzt als Berechtigung.
    { role: "moderator", permission: "see_whole_queue" },
  ]);
});

Deno.test("administrators cannot be given a row", async () => {
  await assertRejects(
    () =>
      client.query(
        `INSERT INTO public.platform_role_permission (role, permission)
         VALUES ('administrator', 'prepare_publications')`,
      ),
    Error,
    "platform_role_permission_not_for_administrators",
  );
});

/** Wer vergeben hat, darf sein Konto loeschen; die Berechtigung bleibt, nur der Name geht. */
Deno.test("the grantor's account can still be deleted", async () => {
  await client.query("BEGIN");

  try {
    const grantor = await insertUser("grantor");
    await client.query(
      `UPDATE public.platform_role_permission SET granted_by = $1 WHERE role = 'moderator'`,
      [grantor],
    );

    await client.query(`DELETE FROM public."user" WHERE id = $1`, [grantor]);

    const row = firstRow(
      (await client.query<{ granted_by: string | null }>(
        `SELECT granted_by FROM public.platform_role_permission WHERE role = 'moderator'`,
      )).rows,
    );
    assertEquals(row.granted_by, null);
  } finally {
    await client.query("ROLLBACK");
  }
});
