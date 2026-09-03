import { assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import type { ForumVisibility } from "@/src/database/schema.ts";
import type { PostDocument } from "@/src/document/document_schema.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  registerUser,
  request,
} from "@/src/test/support.ts";
import { clearFavourite, setFavourite } from "@/src/test/favourites.ts";

/**
 * Reporting and favouriting a forum post — the two things that reach a post from outside the
 * forum's own routes, and so the two that had to learn about it.
 *
 * The rule both share is `resolveVisibleTarget`: **you can only act on what you can see**. For a
 * forum post that means the thread's own visibility rule, not a second copy of it, which is why a
 * closed sub-forum is tested here rather than trusted.
 *
 * Like the other forum files, this one owns only the rows it makes — a deployment has a forum of
 * its own, and emptying the tables would delete it.
 */

const author = "forum-target-author";
const reporter = "forum-target-reporter";
const moderator = "forum-target-moderator";

const REPORTED_TEXT = "Etwas Übles (Forum).";

const created: string[] = [];

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  const fixtureUsers = db
    .selectFrom("user")
    .select("id")
    .where("username", "in", [author, reporter, moderator]);

  // Reports outlive their reporter by design, so they go first, while they can still be found.
  await db
    .deleteFrom("report")
    .where((eb) =>
      eb.or([
        eb("reporterId", "in", fixtureUsers),
        eb("reportedAuthorId", "in", fixtureUsers),
      ])
    )
    .execute();

  if (created.length > 0) {
    const subForums = db.selectFrom("subForum").select("id").where(
      "categoryId",
      "in",
      created,
    );
    const threads = db.selectFrom("forumThread").select("id").where(
      "subForumId",
      "in",
      subForums,
    );

    // Favourites cascade with the post, and a report's reference is SET NULL, so nothing else
    // has to be swept up here.
    await db.deleteFrom("forumPost").where("forumThreadId", "in", threads)
      .execute();
    await db.deleteFrom("forumThread").where("subForumId", "in", subForums)
      .execute();
    await db.deleteFrom("subForum").where("categoryId", "in", created)
      .execute();
    await db.deleteFrom("forumCategory").where("id", "in", created).execute();

    created.length = 0;
  }

  await deleteUsers([author, reporter, moderator]);
});

function documentSaying(text: string): PostDocument {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  } as PostDocument;
}

/** A sub-forum with one thread and one post by `author`, written straight into the tables. */
async function aForumPost(
  visibility: ForumVisibility = "everyone",
  text = REPORTED_TEXT,
) {
  const authorId = await getUserId(author);

  const category = await db
    .insertInto("forumCategory")
    .values({ title: "Melde-Testkategorie" })
    .returning("id")
    .executeTakeFirstOrThrow();

  created.push(category.id);

  const subForum = await db
    .insertInto("subForum")
    .values({
      categoryId: category.id,
      title: "Melde-Testabteil",
      description: "Zum Testen",
      visibility,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const thread = await db
    .insertInto("forumThread")
    .values({
      subForumId: subForum.id,
      title: "Ein Thema",
      createdBy: authorId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const post = await db
    .insertInto("forumPost")
    .values({
      forumThreadId: thread.id,
      document: documentSaying(text),
      // The server's own projection, as the routes write it.
      text,
      createdBy: authorId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return { threadId: thread.id, postId: post.id, authorId };
}

const report = (cookie: string, targetId: string) =>
  request("POST", "/api/reports", cookie, {
    targetType: "forum_post",
    targetId,
    category: "harassment",
    reason: "Beleidigend",
  });

const storedFor = (postId: string) =>
  db
    .selectFrom("report")
    .selectAll()
    .where("reportedForumPostId", "=", postId)
    .executeTakeFirst();

/** No cookie at all is how somebody without an account reads an open sub-forum. */
const listPosts = (threadId: string, cookie = "") =>
  request("QUERY", `/api/forum/threads/${threadId}/posts`, cookie, {
    limit: 20,
    offset: 0,
    sortAttribute: "createdAt",
    sortOrder: "asc",
  });

Deno.test("reporting a forum post keeps the server's own copy of what it said", async () => {
  await registerUser(author);
  const reporterCookie = await registerUser(reporter);

  const { postId } = await aForumPost();

  assertEquals((await report(reporterCookie, postId)).status, STATUS_CODE.OK);

  const stored = await storedFor(postId);
  assertExists(stored);
  assertEquals(stored.targetType, "forum_post");
  // The excerpt is the point: the queue stays readable after the post is gone, and it is the
  // server's copy rather than one the reporter composed.
  assertEquals(stored.targetExcerpt, REPORTED_TEXT);
  assertEquals(stored.reportedAuthorId, await getUserId(author));
});

Deno.test("a report of a forum post survives the post", async () => {
  await registerUser(author);
  const reporterCookie = await registerUser(reporter);

  const { postId } = await aForumPost();
  assertEquals((await report(reporterCookie, postId)).status, STATUS_CODE.OK);

  await db.deleteFrom("forumPost").where("id", "=", postId).execute();

  // SET NULL, not CASCADE: the reference empties and the report stays, which is what the excerpt
  // and `reported_author_id` are stored for.
  const stored = await db
    .selectFrom("report")
    .selectAll()
    .where("targetType", "=", "forum_post")
    .where("reportedAuthorId", "=", await getUserId(author))
    .executeTakeFirst();

  assertExists(stored, "the report went with the post");
  assertEquals(stored.reportedForumPostId, null);
  assertEquals(stored.targetExcerpt, REPORTED_TEXT);
});

Deno.test("reporting your own forum post is refused", async () => {
  const authorCookie = await registerUser(author);
  const { postId } = await aForumPost();

  assertEquals(
    (await report(authorCookie, postId)).status,
    STATUS_CODE.Forbidden,
  );
});

Deno.test("a post nobody may read cannot be reported, and does not answer that it exists", async () => {
  await registerUser(author);
  const reporterCookie = await registerUser(reporter);
  const moderatorCookie = await registerUser(moderator);

  const { postId } = await aForumPost("moderation");

  // 404 rather than 403: a refusal that distinguished the two would make reporting a way of
  // finding out what is in a closed sub-forum.
  assertEquals(
    (await report(reporterCookie, postId)).status,
    STATUS_CODE.NotFound,
  );

  await db
    .updateTable("user")
    .set({ platformRole: "moderator" })
    .where("username", "=", moderator)
    .execute();

  assertEquals((await report(moderatorCookie, postId)).status, STATUS_CODE.OK);
});

Deno.test("favouriting a forum post stores it, and clearing removes it", async () => {
  await registerUser(author);
  const reporterCookie = await registerUser(reporter);

  const { postId } = await aForumPost();

  assertEquals(
    (await setFavourite(reporterCookie, "forum_post", postId)).status,
    STATUS_CODE.OK,
  );

  const stored = await db
    .selectFrom("favourite")
    .selectAll()
    .where("forumPostId", "=", postId)
    .executeTakeFirst();

  assertExists(stored);
  assertEquals(stored.userId, await getUserId(reporter));

  // Favouriting twice is the same as favouriting once, and the second is not an error.
  assertEquals(
    (await setFavourite(reporterCookie, "forum_post", postId)).status,
    STATUS_CODE.OK,
  );

  assertEquals(
    (await clearFavourite(reporterCookie, "forum_post", postId)).status,
    STATUS_CODE.OK,
  );

  assertEquals(
    await db
      .selectFrom("favourite")
      .selectAll()
      .where("forumPostId", "=", postId)
      .executeTakeFirst(),
    undefined,
  );
});

Deno.test("a post in a closed sub-forum cannot be favourited either", async () => {
  await registerUser(author);
  const reporterCookie = await registerUser(reporter);

  const { postId } = await aForumPost("moderation");

  assertEquals(
    (await setFavourite(reporterCookie, "forum_post", postId)).status,
    STATUS_CODE.NotFound,
  );
});

Deno.test("the post list says whose favourite it is, and says false for a reader without an account", async () => {
  await registerUser(author);
  const reporterCookie = await registerUser(reporter);
  const moderatorCookie = await registerUser(moderator);

  const { threadId, postId } = await aForumPost();

  assertEquals(
    (await setFavourite(reporterCookie, "forum_post", postId)).status,
    STATUS_CODE.OK,
  );

  const mine = await (await listPosts(threadId, reporterCookie)).json();
  assertEquals(mine.results[0].isFavourite, true);

  // Scoped to the reader: a copy of the join that lost its `favourite.user_id` line would report
  // everybody's favourites as everybody's.
  const theirs = await (await listPosts(threadId, moderatorCookie)).json();
  assertEquals(theirs.results[0].isFavourite, false);

  // Nobody has favourites, and the sub-forum is open, so this reads without a session at all.
  const anonymous = await (await listPosts(threadId)).json();
  assertEquals(anonymous.results[0].isFavourite, false);
  assertEquals(anonymous.results[0].text, REPORTED_TEXT);
});
