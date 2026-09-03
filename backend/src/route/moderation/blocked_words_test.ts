import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import { WordFilterService } from "@/src/service/word_filter_service.ts";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * The word list end to end: added through the API, and masked in what a reader actually receives.
 *
 * `word_filter_service_test.ts` holds the masking itself. What this file is for is the part that
 * unit test cannot see — that a post written before the word existed comes back masked over HTTP,
 * and that the stored row is still what its author wrote. If the second assertion ever fails, the
 * feature has become the one thing it was built not to be.
 */

const administrator = "blocked-word-admin";
const member = "blocked-word-member";

/** Its own word, and one no other fixture writes: the matcher is process-wide. */
const WORD = "kuddelmuddel";
const WRITTEN = `Was für ein ${WORD} hier.`;

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  await db.deleteFrom("blockedWord").where("word", "=", WORD).execute();
  WordFilterService.forgetCachedWords();
  await deleteUsers([administrator, member]);
});

async function asAdministrator(): Promise<string> {
  const cookie = await registerUser(administrator);
  await db
    .updateTable("user")
    .set({ platformRole: "administrator" })
    .where("username", "=", administrator)
    .execute();
  return cookie;
}

const block = (cookie: string, word: string, note?: string) =>
  request("POST", "/api/moderation/blocked-words", cookie, { word, note });

const unblock = (cookie: string, word: string) =>
  request("DELETE", `/api/moderation/blocked-words/${word}`, cookie);

const listWords = (cookie: string) =>
  request("GET", "/api/moderation/blocked-words", cookie);

/** The feed is a QUERY endpoint with a cursor body, not a GET with query parameters. */
const feed = (cookie: string) =>
  request("QUERY", "/api/status-updates", cookie, { limit: 5 });

Deno.test("a word is added, listed lower-cased, and taken off again", async () => {
  const cookie = await asAdministrator();

  assertEquals(
    (await block(cookie, "Kuddelmuddel", "Testwort")).status,
    STATUS_CODE.OK,
  );

  const listed = await (await listWords(cookie)).json();
  const found = listed.find((entry: { word: string }) => entry.word === WORD);

  assertEquals(found?.word, WORD);
  assertEquals(found?.note, "Testwort");
  assertEquals(found?.addedBy?.username, administrator);

  assertEquals((await unblock(cookie, WORD)).status, STATUS_CODE.OK);

  const after = await (await listWords(cookie)).json();
  assertEquals(
    after.some((entry: { word: string }) => entry.word === WORD),
    false,
  );
});

Deno.test("a word added afterwards masks a status update that was already written", async () => {
  const cookie = await asAdministrator();

  const written = await request("POST", "/api/status-updates", cookie, {
    body: WRITTEN,
  });
  assertEquals(written.status, STATUS_CODE.Created);

  const before = await (await feed(cookie)).json();
  assertEquals(
    before.results.some((one: { body: string }) => one.body === WRITTEN),
    true,
    "the update should be readable as written while the list is empty",
  );

  assertEquals((await block(cookie, WORD)).status, STATUS_CODE.OK);

  const after = await (await feed(cookie)).json();
  const masked = after.results.find((one: { body: string }) =>
    one.body.includes("***")
  );

  // Retroactive, and nothing was rewritten to achieve it.
  assertEquals(masked?.body, `Was für ein *** hier.`);

  // The row itself is untouched — the whole reason the mask is a read-time filter.
  const stored = await db
    .selectFrom("statusUpdate")
    .select("body")
    .where("body", "like", "%kuddelmuddel%")
    .executeTakeFirst();

  assertEquals(stored?.body, WRITTEN);
});

Deno.test("taking the word off again gives the reader the original back", async () => {
  const cookie = await asAdministrator();

  await request("POST", "/api/status-updates", cookie, { body: WRITTEN });
  await block(cookie, WORD);
  await unblock(cookie, WORD);

  const after = await (await feed(cookie)).json();

  assertEquals(
    after.results.some((one: { body: string }) => one.body === WRITTEN),
    true,
    "the original text should be readable again once the word is off the list",
  );
});

Deno.test("a moderator may not touch the list, and neither may a member", async () => {
  const memberCookie = await registerUser(member);

  assertEquals((await listWords(memberCookie)).status, STATUS_CODE.Forbidden);
  assertEquals((await block(memberCookie, WORD)).status, STATUS_CODE.Forbidden);

  await db
    .updateTable("user")
    .set({ platformRole: "moderator" })
    .where("username", "=", member)
    .execute();

  // Administrator territory, like the domain list beside it: this decides what the whole
  // community may print, not what happens to one account.
  assertEquals((await listWords(memberCookie)).status, STATUS_CODE.Forbidden);
});

Deno.test("a single letter is refused before it can mask half the dictionary", async () => {
  const cookie = await asAdministrator();

  assertEquals((await block(cookie, "e")).status, STATUS_CODE.BadRequest);
  assertEquals((await block(cookie, "   ")).status, STATUS_CODE.BadRequest);
});
