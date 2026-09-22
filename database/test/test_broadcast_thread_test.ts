import { assertEquals, assertRejects } from "@std/assert";
import {
  cleanUp,
  client,
  connect,
  insertUser,
  TEST_PREFIX,
} from "./support.ts";

/**
 * Ein Test-Faden steht in keinem Postfach des Teams -- und die Datenbank laesst nicht zu, dass er
 * es doch tut. Sonst laesen alle Admins Test-Rundmails im Verlauf mit, und eine offene Frage der
 * Person, die testet, schloesse sich still.
 */

Deno.test.beforeEach(connect);
Deno.test.afterEach(cleanUp);

async function insertThread(
  title: string,
  partnerId: string,
  flags: { test: boolean; administration: boolean },
): Promise<void> {
  await client.query(
    `INSERT INTO public.chat_group
       (title, administration_partner_id, is_test_broadcast, addressed_to_administration)
     VALUES ($1, $2, $3, $4)`,
    [`${TEST_PREFIX}${title}`, partnerId, flags.test, flags.administration],
  );
}

Deno.test("a test thread cannot also be addressed to the administration", async () => {
  const tester = await insertUser("test-thread-both");

  const failure = await assertRejects(() =>
    insertThread("beides", tester, { test: true, administration: true })
  ) as { constraint?: string };

  assertEquals(
    failure.constraint,
    "chat_group_test_is_not_for_the_administration",
  );
});

Deno.test("a test thread on its own is fine", async () => {
  const tester = await insertUser("test-thread-alone");

  await insertThread("nur-test", tester, { test: true, administration: false });
});
