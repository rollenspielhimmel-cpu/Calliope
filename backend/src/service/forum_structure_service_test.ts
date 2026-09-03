import { assertEquals, assertExists } from "@std/assert";
import { db } from "@/src/database/client.ts";
import type { ForumVisibility } from "@/src/database/schema.ts";
import { ForumStructureService } from "@/src/service/forum_structure_service.ts";
import {
  effectiveVisibility,
  type ForumReader,
} from "@/src/service/forum_visibility.ts";

/**
 * The visibility rule, end to end against the database — the part of it that lives in SQL
 * (`greatest` over the enum, and the newest post per sub-forum) cannot be checked by types.
 *
 * The rule under test: the **stricter** of the sub-forum's setting and the thread's own wins, so
 * moving a thread into a closed sub-forum hides it whatever the thread itself says.
 *
 * **These tests do not own the forum.** A deployment has categories of its own, and an earlier
 * version of this file both emptied the four tables afterwards and asserted on `categories[0]` —
 * which deleted somebody's forum and then read theirs instead of its own. Every assertion below
 * is scoped to the rows the test made, and so is the cleanup.
 */

const NOBODY = undefined;
const MEMBER = { platformRole: null } as const;
const MODERATOR = { platformRole: "moderator" } as const;
const ADMINISTRATOR = { platformRole: "administrator" } as const;

/** The categories this file made, so both the reading and the cleanup can be scoped to them. */
const created: string[] = [];

async function newCategory(title: string): Promise<string> {
  const category = await db
    .insertInto("forumCategory")
    .values({ title })
    .returning("id")
    .executeTakeFirstOrThrow();

  created.push(category.id);
  return category.id;
}

/** One category holding one sub-forum at the given visibility, with one thread and one post. */
async function seed(
  title: string,
  subForumVisibility: ForumVisibility,
  threadVisibility: ForumVisibility | null = null,
) {
  const categoryId = await newCategory(`${title}-Kategorie`);

  const subForum = await db
    .insertInto("subForum")
    .values({
      categoryId,
      title,
      description: "Zum Testen",
      visibility: subForumVisibility,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const thread = await db
    .insertInto("forumThread")
    .values({
      subForumId: subForum.id,
      title: `${title}-Thema`,
      visibility: threadVisibility,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await db
    .insertInto("forumPost")
    .values({
      forumThreadId: thread.id,
      document: { type: "doc", content: [] },
      text: "Ein Beitrag",
    })
    .execute();

  return { categoryId, subForumId: subForum.id, threadId: thread.id };
}

/** The overview, narrowed to what this test put there — whatever else the deployment holds. */
async function ownCategories(reader: ForumReader) {
  const overview = await ForumStructureService.selectOverview(reader);
  return overview.categories.filter((category) =>
    created.includes(category.id)
  );
}

async function subForumTitles(reader: ForumReader): Promise<string[]> {
  return (await ownCategories(reader)).flatMap((category) =>
    category.subForums.map((subForum) => subForum.title)
  );
}

/** The one sub-forum a single-`seed` test made. */
async function onlySubForum(reader: ForumReader) {
  return (await ownCategories(reader))[0]?.subForums[0];
}

/** Bottom-up, because the references between these four are RESTRICT rather than CASCADE. */
Deno.test.afterEach(async () => {
  if (created.length === 0) {
    return;
  }

  const subForums = db
    .selectFrom("subForum")
    .select("id")
    .where("categoryId", "in", created);

  const threads = db
    .selectFrom("forumThread")
    .select("id")
    .where("subForumId", "in", subForums);

  await db.deleteFrom("forumPost").where("forumThreadId", "in", threads)
    .execute();
  await db.deleteFrom("forumThread").where("subForumId", "in", subForums)
    .execute();
  await db.deleteFrom("subForum").where("categoryId", "in", created).execute();
  await db.deleteFrom("forumCategory").where("id", "in", created).execute();

  created.length = 0;
});

Deno.test("a reader sees the levels at or below their own, and nothing above", async () => {
  await seed("Offen", "everyone");
  await seed("Mitglieder", "members");
  await seed("Moderation", "moderation");
  await seed("Administration", "administration");

  assertEquals(await subForumTitles(NOBODY), ["Offen"]);
  assertEquals((await subForumTitles(MEMBER)).sort(), ["Mitglieder", "Offen"]);
  assertEquals((await subForumTitles(MODERATOR)).sort(), [
    "Mitglieder",
    "Moderation",
    "Offen",
  ]);
  assertEquals((await subForumTitles(ADMINISTRATOR)).length, 4);
});

Deno.test("a category whose sub-forums are all closed is absent, not an empty heading", async () => {
  await seed("Nur Administration", "administration");

  assertEquals(await ownCategories(MEMBER), []);
});

Deno.test("the counts and the last post are what the reader may see", async () => {
  await seed("Offen", "everyone");

  const subForum = await onlySubForum(NOBODY);

  assertExists(subForum);
  assertEquals(subForum.threads, 1);
  assertEquals(subForum.posts, 1);
  assertExists(subForum.lastPost, "a sub-forum with a post has a last post");
});

Deno.test("a sub-forum with no posts names no last post", async () => {
  // The original this is modelled on showed both impossible states — "0 threads, 0 posts" beside
  // a last post, and 433 posts beside none. Derived, neither can happen.
  const categoryId = await newCategory("Leer");

  await db
    .insertInto("subForum")
    .values({
      categoryId,
      title: "Ohne Beiträge",
      description: "Noch nichts",
      visibility: "everyone",
    })
    .execute();

  const subForum = await onlySubForum(NOBODY);

  assertExists(subForum);
  assertEquals(subForum.threads, 0);
  assertEquals(subForum.posts, 0);
  assertEquals(subForum.lastPost, undefined);
});

Deno.test("a thread cannot be more open than the sub-forum holding it", async () => {
  // The move that hides a thread: `everyone` on the thread, administration on the sub-forum.
  await seed("Versteckt", "administration", "everyone");

  assertEquals(await subForumTitles(NOBODY), []);
  assertEquals(await subForumTitles(MEMBER), []);
  assertEquals((await onlySubForum(ADMINISTRATOR))?.threads, 1);
});

Deno.test("a thread can be stricter than the sub-forum holding it", async () => {
  await seed("Offen mit stillem Thema", "everyone", "moderation");

  // The sub-forum is still listed — it is open — but its one thread is not counted for a reader
  // who may not see it, so the numbers say nothing about what is hidden.
  assertEquals((await onlySubForum(NOBODY))?.threads, 0);
  assertEquals((await onlySubForum(NOBODY))?.lastPost, undefined);
  assertEquals((await onlySubForum(MODERATOR))?.threads, 1);
});

Deno.test("the totals count everything the reader was shown", async () => {
  await seed("Offen", "everyone");

  const overview = await ForumStructureService.selectOverview(NOBODY);
  const shown = overview.categories.flatMap((category) => category.subForums);

  // Stated as a relation rather than as a number, because a deployment may hold more than this
  // test put there — and the relation is what the footer actually promises.
  assertEquals(
    overview.totalThreads,
    shown.reduce((total, subForum) => total + subForum.threads, 0),
  );
  assertEquals(
    overview.totalPosts,
    shown.reduce((total, subForum) => total + subForum.posts, 0),
  );
});

Deno.test("the stricter of the two is what the helper says as well", () => {
  // The same rule the SQL applies, so the two cannot drift apart.
  assertEquals(
    effectiveVisibility("everyone", "administration"),
    "administration",
  );
  assertEquals(
    effectiveVisibility("administration", "everyone"),
    "administration",
  );
  assertEquals(effectiveVisibility("members", null), "members");
  assertEquals(effectiveVisibility("moderation", "members"), "moderation");
});

Deno.test("a category still holding sub-forums is refused rather than emptied", async () => {
  const { categoryId, subForumId } = await seed("Belegt", "everyone");

  assertEquals(
    await ForumStructureService.deleteCategory(categoryId),
    "not_empty",
  );
  // And the sub-forum likewise, while it still holds a thread.
  assertEquals(
    await ForumStructureService.deleteSubForum(subForumId),
    "not_empty",
  );
});
