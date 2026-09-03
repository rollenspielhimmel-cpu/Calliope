import { assertEquals, assertExists } from "@std/assert";
import { db } from "@/src/database/client.ts";
import type { ForumVisibility } from "@/src/database/schema.ts";
import type { PostDocument } from "@/src/document/document_schema.ts";
import { ForumThreadService } from "@/src/service/forum_thread_service.ts";

/**
 * Threads and posts: who may read them, and what deleting the last post does.
 *
 * Like its neighbour, this file owns only the rows it makes — a deployment has a forum of its
 * own, and emptying the tables would delete it.
 */

const NOBODY = undefined;
const MEMBER = { platformRole: null } as const;
const MODERATOR = { platformRole: "moderator" } as const;

const ANY_QUERY = { limit: 20, offset: 0, sort: [] };

const created: string[] = [];
const authors: string[] = [];

function documentSaying(text: string): PostDocument {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  } as PostDocument;
}

async function seed(
  subForumVisibility: ForumVisibility,
  threadVisibility: ForumVisibility | null = null,
) {
  const category = await db
    .insertInto("forumCategory")
    .values({ title: "Themen-Testkategorie" })
    .returning("id")
    .executeTakeFirstOrThrow();

  created.push(category.id);

  const subForum = await db
    .insertInto("subForum")
    .values({
      categoryId: category.id,
      title: "Testabteil",
      description: "Zum Testen",
      visibility: subForumVisibility,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const thread = await db
    .insertInto("forumThread")
    .values({
      subForumId: subForum.id,
      title: "Ein Thema",
      visibility: threadVisibility,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  // The file's own account, rather than whoever happens to be in the table. Taking the first
  // row of `user` made these tests depend on some other file having run first — alone, or on
  // a freshly built database, there was nobody there and the foreign key refused the post.
  const author = await db
    .insertInto("user")
    .values({
      username: `forum-test-${crypto.randomUUID().slice(0, 8)}`,
      emailAddress: `forum-test-${
        crypto.randomUUID().slice(0, 8)
      }@example.test`,
      hashedPassword: "nicht zum Anmelden gedacht",
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  authors.push(author.id);

  const post = await db
    .insertInto("forumPost")
    .values({
      forumThreadId: thread.id,
      document: documentSaying("Der erste Beitrag"),
      text: "Der erste Beitrag",
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return {
    subForumId: subForum.id,
    threadId: thread.id,
    postId: post.id,
    authorId: author.id,
  };
}

Deno.test.afterEach(async () => {
  if (created.length === 0) return;

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

  await db.deleteFrom("forumPost").where("forumThreadId", "in", threads)
    .execute();
  await db.deleteFrom("forumThread").where("subForumId", "in", subForums)
    .execute();
  await db.deleteFrom("subForum").where("categoryId", "in", created).execute();
  await db.deleteFrom("forumCategory").where("id", "in", created).execute();

  // Last, because the posts above reference it.
  await db.deleteFrom("user").where("id", "in", authors).execute();

  created.length = 0;
  authors.length = 0;
});

Deno.test("a thread in a closed sub-forum is not there for a reader who may not see it", async () => {
  const { threadId, subForumId } = await seed("moderation");

  assertEquals(
    await ForumThreadService.selectThread(threadId, NOBODY),
    undefined,
  );
  assertEquals(
    await ForumThreadService.selectThread(threadId, MEMBER),
    undefined,
  );
  assertExists(await ForumThreadService.selectThread(threadId, MODERATOR));

  // And the sub-forum it hangs off is equally absent, so nothing hints that it exists.
  assertEquals(
    await ForumThreadService.selectSubForum(subForumId, MEMBER),
    undefined,
  );
});

Deno.test("a thread marked open inside a closed sub-forum stays closed", async () => {
  // The rule that makes moving a thread into a closed sub-forum a way to hide it.
  const { threadId } = await seed("administration", "everyone");

  assertEquals(
    await ForumThreadService.selectThread(threadId, MEMBER),
    undefined,
  );
  assertEquals(
    await ForumThreadService.selectThread(threadId, MODERATOR),
    undefined,
  );
});

Deno.test("a thread narrowed by hand disappears from its open sub-forum's list", async () => {
  const { subForumId, threadId } = await seed("everyone");

  assertEquals(
    (await ForumThreadService.listThreads(subForumId, NOBODY, ANY_QUERY))
      .totalResults,
    1,
  );

  assertEquals(
    await ForumThreadService.setThreadVisibility(
      threadId,
      "moderation",
      MODERATOR,
    ),
    undefined,
  );

  const forNobody = await ForumThreadService.listThreads(
    subForumId,
    NOBODY,
    ANY_QUERY,
  );
  const forModerator = await ForumThreadService.listThreads(
    subForumId,
    MODERATOR,
    ANY_QUERY,
  );

  // The sub-forum is still open and still listed; its one thread is simply not in the page,
  // and not in the total either — the count describes what was shown.
  assertEquals(forNobody.totalResults, 0);
  assertEquals(forNobody.results, []);
  assertEquals(forModerator.totalResults, 1);
});

Deno.test("a thread carries how many posts it holds", async () => {
  const { subForumId, threadId, authorId } = await seed("everyone");

  await ForumThreadService.createPost(
    threadId,
    documentSaying("Noch einer"),
    authorId,
  );

  const listed = (await ForumThreadService.listThreads(
    subForumId,
    NOBODY,
    ANY_QUERY,
  )).results[0];

  assertExists(listed);
  assertEquals(listed.posts, 2);
  assertEquals(
    (await ForumThreadService.selectThread(threadId, NOBODY))?.posts,
    2,
  );
});

Deno.test("the post text is written by the server, never taken from the client", async () => {
  const { threadId, authorId } = await seed("everyone");
  const author = authorId;

  const { postId } = await ForumThreadService.createPost(
    threadId,
    documentSaying("Was hier steht"),
    author,
  );

  const stored = await db
    .selectFrom("forumPost")
    .select("text")
    .where("id", "=", postId)
    .executeTakeFirstOrThrow();

  // Search, a report excerpt and the length bound all read this column and none of them can
  // read a tree — the same reason `writing_post.text` is derived.
  assertEquals(stored.text, "Was hier steht");
});

Deno.test("only the author may change a post, unless an operator does it", async () => {
  const { threadId, postId, authorId } = await seed("everyone");
  const somebodyElse = authorId;

  assertEquals(
    await ForumThreadService.updatePost(
      threadId,
      postId,
      documentSaying("Fremd"),
      somebodyElse,
      false,
    ),
    "not_yours",
  );

  assertEquals(
    await ForumThreadService.updatePost(
      threadId,
      postId,
      documentSaying("Von der Moderation"),
      somebodyElse,
      true,
    ),
    undefined,
  );
});

Deno.test("removing the last post removes the thread with it", async () => {
  const { threadId, postId, authorId } = await seed("everyone");
  const operator = authorId;

  assertEquals(
    await ForumThreadService.deletePost(threadId, postId, operator, true),
    undefined,
  );

  // A thread with nothing in it is the empty row opening one is written to prevent, so it is
  // not left behind when the last post goes.
  assertEquals(
    await ForumThreadService.selectThread(threadId, MODERATOR),
    undefined,
  );
});

Deno.test("removing one of several posts leaves the thread standing", async () => {
  const { threadId, postId, authorId } = await seed("everyone");
  const operator = authorId;

  await ForumThreadService.createPost(
    threadId,
    documentSaying("Bleibt"),
    operator,
  );

  assertEquals(
    await ForumThreadService.deletePost(threadId, postId, operator, true),
    undefined,
  );

  assertEquals(
    (await ForumThreadService.selectThread(threadId, MODERATOR))?.posts,
    1,
  );
});
