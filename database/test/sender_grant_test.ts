import { assertEquals, assertRejects } from "@std/assert";
import { cleanUp, client, connect, insertUser } from "./support.ts";

/**
 * Wer welchen Absender nutzen darf -- `sender_grant`.
 *
 * Genau eines von beiden, Rolle oder Person; keine Zeile fuer Administrationen; und "Admin" steht
 * als Null, also muss die Eindeutigkeit Nullen als gleich zaehlen. Was die Tabelle mit den
 * vorhandenen Zeilen der Moderation teilt, geschieht in einer Transaktion, die zurueckgerollt wird.
 */

Deno.test.beforeEach(connect);
Deno.test.afterEach(cleanUp);

async function inRolledBackTransaction(
  body: () => Promise<void>,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await body();
  } finally {
    await client.query("ROLLBACK");
  }
}

Deno.test("the migration keeps what moderators could do: sending as Admin", async () => {
  const rows = (await client.query<{ count: string }>(
    `SELECT count(*) FROM public.sender_grant
     WHERE sender_user_id IS NULL AND role = 'moderator'`,
  )).rows;

  assertEquals(rows[0]?.count, "1");
});

Deno.test("a grant names a role or a person, not both and not neither", async () => {
  const person = await insertUser("grantee");

  await assertRejects(
    () =>
      client.query(
        `INSERT INTO public.sender_grant (sender_user_id, role, user_id)
         VALUES (NULL, 'moderator', $1)`,
        [person],
      ),
    Error,
    "sender_grant_role_or_person",
  );
  await assertRejects(
    () =>
      client.query(
        `INSERT INTO public.sender_grant (sender_user_id) VALUES (NULL)`,
      ),
    Error,
    "sender_grant_role_or_person",
  );
});

Deno.test("administrators cannot be given a sender", async () => {
  await assertRejects(
    () =>
      client.query(
        `INSERT INTO public.sender_grant (sender_user_id, role)
         VALUES (NULL, 'administrator')`,
      ),
    Error,
    "sender_grant_not_for_administrators",
  );
});

/** "Admin" ist die Null, und zweimal "Admin fuer die Moderation" waere sonst zweierlei. */
Deno.test("Admin for the moderators exists once, although it is a null", async () => {
  await inRolledBackTransaction(async () => {
    await assertRejects(
      () =>
        client.query(
          `INSERT INTO public.sender_grant (sender_user_id, role)
           VALUES (NULL, 'moderator')`,
        ),
      Error,
      "sender_grant_role_idx",
    );
  });
});

Deno.test("a person holds a sender once, and loses it with the account", async () => {
  const person = await insertUser("grantee");

  await client.query(
    `INSERT INTO public.sender_grant (sender_user_id, user_id) VALUES (NULL, $1)`,
    [person],
  );
  await assertRejects(
    () =>
      client.query(
        `INSERT INTO public.sender_grant (sender_user_id, user_id) VALUES (NULL, $1)`,
        [person],
      ),
    Error,
    "sender_grant_person_idx",
  );

  await client.query(`DELETE FROM public."user" WHERE id = $1`, [person]);

  const left = (await client.query(
    `SELECT 1 FROM public.sender_grant WHERE user_id = $1`,
    [person],
  )).rows;
  assertEquals(left, []);
});
