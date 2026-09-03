import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import type { ForumVisibility } from "@/src/database/schema.ts";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * Moving a thread, and setting who may read it.
 *
 * Two rules are worth more than the happy paths here. **A sub-forum the mover may not read is
 * 404**, so moving cannot be used to map what is behind a closed door. And **nobody may put a
 * thread beyond their own reach**: a moderator marking a thread `administration` would hide it
 * from themselves with no way back, which is 403 rather than a quiet success.
 *
 * Like the other forum files, this one owns only the rows it makes.
 */

const moderator = "move-test-moderator";
const administrator = "move-test-admin";
const member = "move-test-member";

const created: string[] = [];

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  if (created.length > 0) {
    const subForums = db.selectFrom("subForum").select("id").where(
      "categoryId",
      "in",
      created,
    );

    await db
      .deleteFrom("forumThread")
      .where("subForumId", "in", subForums)
      .execute();
    await db.deleteFrom("subForum").where("categoryId", "in", created)
      .execute();
    await db.deleteFrom("forumCategory").where("id", "in", created).execute();

    created.length = 0;
  }

  await deleteUsers([moderator, administrator, member]);
});

async function setRole(
  username: string,
  role: "administrator" | "moderator" | null,
) {
  await db
    .updateTable("user")
    .set({ platformRole: role })
    .where("username", "=", username)
    .execute();
}

async function aSubForum(
  categoryId: string,
  title: string,
  visibility: ForumVisibility,
): Promise<string> {
  const subForum = await db
    .insertInto("subForum")
    .values({ categoryId, title, description: "Zum Testen", visibility })
    .returning("id")
    .executeTakeFirstOrThrow();

  return subForum.id;
}

/**
 * A category, the sub-forum a thread starts in, and the one it is moved to. Named rather than
 * indexed out of an array: `from` and `to` are what every test below is actually about.
 */
async function seed(
  here: ForumVisibility,
  there: ForumVisibility = "everyone",
) {
  const category = await db
    .insertInto("forumCategory")
    .values({ title: "Verschiebe-Testkategorie" })
    .returning("id")
    .executeTakeFirstOrThrow();

  created.push(category.id);

  const from = await aSubForum(category.id, "Abteil A", here);
  const to = await aSubForum(category.id, "Abteil B", there);

  const thread = await db
    .insertInto("forumThread")
    .values({ subForumId: from, title: "Ein Thema" })
    .returning("id")
    .executeTakeFirstOrThrow();

  return { from, to, threadId: thread.id };
}

const move = (cookie: string, threadId: string, subForumId: string) =>
  request(
    "PATCH",
    `/api/forum/threads/${threadId}/sub-forum`,
    cookie,
    { subForumId },
  );

const setVisibility = (
  cookie: string,
  threadId: string,
  visibility: ForumVisibility | null,
) =>
  request(
    "PUT",
    `/api/forum/threads/${threadId}/visibility`,
    cookie,
    { visibility },
  );

const storedThread = (threadId: string) =>
  db
    .selectFrom("forumThread")
    .select(["subForumId", "visibility", "lastActivityAt"])
    .where("id", "=", threadId)
    .executeTakeFirstOrThrow();

Deno.test("a moderator moves a thread into another sub-forum", async () => {
  const cookie = await registerUser(moderator);
  await setRole(moderator, "moderator");

  const { to, threadId } = await seed("everyone");

  assertEquals(
    (await move(cookie, threadId, to)).status,
    STATUS_CODE.OK,
  );
  assertEquals((await storedThread(threadId)).subForumId, to);

  // Moving it where it already is is not an error: the same request twice is the same state.
  assertEquals(
    (await move(cookie, threadId, to)).status,
    STATUS_CODE.OK,
  );
});

Deno.test("moving a thread is not activity in it", async () => {
  const cookie = await registerUser(moderator);
  await setRole(moderator, "moderator");

  const { to, threadId } = await seed("everyone");
  const before = (await storedThread(threadId)).lastActivityAt;

  assertEquals(
    (await move(cookie, threadId, to)).status,
    STATUS_CODE.OK,
  );

  // A moderator tidying up old threads must not drag them all to the top of the list they land
  // in. The trigger that did this is gone — see 20260902200000.
  assertEquals((await storedThread(threadId)).lastActivityAt, before);

  assertEquals(
    (await setVisibility(cookie, threadId, "moderation")).status,
    STATUS_CODE.OK,
  );
  assertEquals((await storedThread(threadId)).lastActivityAt, before);
});

Deno.test("a sub-forum the mover may not read is not a place to move to, and does not say it exists", async () => {
  const cookie = await registerUser(moderator);
  await setRole(moderator, "moderator");

  const { from, to, threadId } = await seed("everyone", "administration");

  // 404, not 403: the moderator has no business learning what is behind an administration door.
  assertEquals(
    (await move(cookie, threadId, to)).status,
    STATUS_CODE.NotFound,
  );
  assertEquals((await storedThread(threadId)).subForumId, from);
});

Deno.test("a thread the mover may not read cannot be moved either", async () => {
  const cookie = await registerUser(moderator);
  await setRole(moderator, "moderator");

  const { to, threadId } = await seed("administration", "everyone");

  assertEquals(
    (await move(cookie, threadId, to)).status,
    STATUS_CODE.NotFound,
  );
});

Deno.test("an administrator reaches what a moderator cannot", async () => {
  const cookie = await registerUser(administrator);
  await setRole(administrator, "administrator");

  const { to, threadId } = await seed("everyone", "administration");

  assertEquals(
    (await move(cookie, threadId, to)).status,
    STATUS_CODE.OK,
  );
  assertEquals((await storedThread(threadId)).subForumId, to);
});

Deno.test("an ordinary member moves nothing", async () => {
  const cookie = await registerUser(member);
  const { to, threadId } = await seed("everyone");

  assertEquals(
    (await move(cookie, threadId, to)).status,
    STATUS_CODE.Forbidden,
  );
  assertEquals(
    (await setVisibility(cookie, threadId, "moderation")).status,
    STATUS_CODE.Forbidden,
  );
});

Deno.test("a moderator narrows a thread and lets it go again", async () => {
  const cookie = await registerUser(moderator);
  await setRole(moderator, "moderator");

  const { threadId } = await seed("everyone");

  assertEquals(
    (await setVisibility(cookie, threadId, "moderation")).status,
    STATUS_CODE.OK,
  );
  assertEquals((await storedThread(threadId)).visibility, "moderation");

  // `null` is the way back to the sub-forum's own setting, not a fourth level.
  assertEquals(
    (await setVisibility(cookie, threadId, null)).status,
    STATUS_CODE.OK,
  );
  assertEquals((await storedThread(threadId)).visibility, null);
});

Deno.test("nobody may put a thread beyond their own reach", async () => {
  const moderatorCookie = await registerUser(moderator);
  await setRole(moderator, "moderator");

  const { threadId } = await seed("everyone");

  // 403, not 404: the thread is plainly there — they are reading it. What is refused is being
  // left unable to undo this.
  assertEquals(
    (await setVisibility(moderatorCookie, threadId, "administration")).status,
    STATUS_CODE.Forbidden,
  );
  assertEquals((await storedThread(threadId)).visibility, null);

  const administratorCookie = await registerUser(administrator);
  await setRole(administrator, "administrator");

  assertEquals(
    (await setVisibility(administratorCookie, threadId, "administration"))
      .status,
    STATUS_CODE.OK,
  );

  // And now it is out of the moderator's hands entirely, which is the same rule read the other
  // way round: they can no longer see it, so they can no longer act on it.
  assertEquals(
    (await setVisibility(moderatorCookie, threadId, null)).status,
    STATUS_CODE.NotFound,
  );
});
