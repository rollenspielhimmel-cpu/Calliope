import { db } from "@/src/database/client.ts";
import type { ForumVisibility } from "@/src/database/schema.ts";
import {
  type ForumReader,
  visibilityCeiling,
} from "@/src/service/forum_visibility.ts";

/**
 * The forum's shape: categories that only group, and the sub-forums under them that actually hold
 * threads. Everything a reader is shown here is filtered by what they may see — a sub-forum they
 * may not read is absent, not greyed out, and a category left with nothing in it disappears with
 * its contents rather than standing empty.
 */

export type SubForumSummary = {
  id: string;
  title: string;
  description: string;
  visibility: ForumVisibility;
  position: number;
  threads: number;
  posts: number;
  lastPost:
    | {
      threadId: string;
      threadTitle: string;
      postId: string;
      createdAt: string;
      createdByUsername: string | null;
    }
    | undefined;
};

export type CategorySummary = {
  id: string;
  title: string;
  position: number;
  subForums: SubForumSummary[];
};

export type ForumOverview = {
  categories: CategorySummary[];
  /** What the footer says, counted over what this reader may see and nothing more. */
  totalThreads: number;
  totalPosts: number;
};

/**
 * Counts and the newest post per sub-forum, derived rather than stored.
 *
 * The original this is modelled on kept counters, and they had drifted: two sub-forums showed
 * "0 threads, 0 posts" while still naming a last post, and another showed 433 posts with no last
 * post at all. Deriving all three makes those states unreachable.
 *
 * **The known scaling step.** One aggregate over the visible posts per page load is correct and
 * cheap while the forum is small; the original had 172,711 posts in a single sub-forum, and at
 * that size this wants a counter maintained by trigger — the same shape `last_activity_at`
 * already uses. Measure before adding it.
 */
async function selectOverview(reader: ForumReader): Promise<ForumOverview> {
  const ceiling = visibilityCeiling(reader);

  const categories = await db
    .selectFrom("forumCategory")
    .select(["id", "title", "position"])
    .orderBy("position", "asc")
    .orderBy("id", "asc")
    .execute();

  const subForums = await db
    .selectFrom("subForum")
    .select([
      "id",
      "categoryId",
      "title",
      "description",
      "visibility",
      "position",
    ])
    .where("visibility", "<=", ceiling)
    .orderBy("position", "asc")
    .orderBy("id", "asc")
    .execute();

  if (subForums.length === 0) {
    return { categories: [], totalThreads: 0, totalPosts: 0 };
  }

  const subForumIds = subForums.map((subForum) => subForum.id);

  // A thread the reader may not see counts for nothing and shows nothing, so the same filter
  // decides the numbers and the last post. `greatest` is the stricter-of-the-two rule, in SQL.
  const visibleThreads = db
    .selectFrom("forumThread")
    .innerJoin("subForum", "subForum.id", "forumThread.subForumId")
    .where("forumThread.subForumId", "in", subForumIds)
    .where((eb) =>
      eb(
        eb.fn("greatest", [
          "subForum.visibility",
          eb.fn.coalesce("forumThread.visibility", "subForum.visibility"),
        ]),
        "<=",
        ceiling,
      )
    );

  const threadCounts = await visibleThreads
    .select((eb) => [
      "forumThread.subForumId",
      eb.fn.countAll<number>().as("threads"),
    ])
    .groupBy("forumThread.subForumId")
    .execute();

  const postCounts = await visibleThreads
    .innerJoin("forumPost", "forumPost.forumThreadId", "forumThread.id")
    .select((eb) => [
      "forumThread.subForumId",
      eb.fn.countAll<number>().as("posts"),
    ])
    .groupBy("forumThread.subForumId")
    .execute();

  const lastPosts = await visibleThreads
    .innerJoin("forumPost", "forumPost.forumThreadId", "forumThread.id")
    .leftJoin("user", "user.id", "forumPost.createdBy")
    .select([
      "forumThread.subForumId",
      "forumThread.id as threadId",
      "forumThread.title as threadTitle",
      "forumPost.id as postId",
      "forumPost.createdAt",
      "user.username as createdByUsername",
    ])
    .distinctOn("forumThread.subForumId")
    .orderBy("forumThread.subForumId", "asc")
    .orderBy("forumPost.createdAt", "desc")
    .orderBy("forumPost.id", "desc")
    .execute();

  const threadsBySubForum = new Map(
    threadCounts.map((row) => [row.subForumId, Number(row.threads)]),
  );
  const postsBySubForum = new Map(
    postCounts.map((row) => [row.subForumId, Number(row.posts)]),
  );
  const lastPostBySubForum = new Map(
    lastPosts.map((row) => [row.subForumId, row]),
  );

  const summaries: SubForumSummary[] = subForums.map((subForum) => {
    const lastPost = lastPostBySubForum.get(subForum.id);

    return {
      id: subForum.id,
      title: subForum.title,
      description: subForum.description,
      visibility: subForum.visibility,
      position: subForum.position,
      threads: threadsBySubForum.get(subForum.id) ?? 0,
      posts: postsBySubForum.get(subForum.id) ?? 0,
      lastPost: lastPost === undefined ? undefined : {
        threadId: lastPost.threadId,
        threadTitle: lastPost.threadTitle,
        postId: lastPost.postId,
        createdAt: lastPost.createdAt,
        createdByUsername: lastPost.createdByUsername,
      },
    };
  });

  const byCategory = new Map<string, SubForumSummary[]>();

  for (const summary of summaries) {
    const subForum = subForums.find((one) => one.id === summary.id);
    if (subForum === undefined) continue;
    byCategory.set(subForum.categoryId, [
      ...(byCategory.get(subForum.categoryId) ?? []),
      summary,
    ]);
  }

  return {
    // A category whose sub-forums the reader may not see is not an empty heading: it is absent,
    // which is also what keeps a closed category from advertising that it exists.
    categories: categories
      .map((category) => ({
        id: category.id,
        title: category.title,
        position: category.position,
        subForums: byCategory.get(category.id) ?? [],
      }))
      .filter((category) => category.subForums.length > 0),
    totalThreads: summaries.reduce((total, one) => total + one.threads, 0),
    totalPosts: summaries.reduce((total, one) => total + one.posts, 0),
  };
}

/** Administration reads the whole structure, closed sub-forums included, to be able to edit it. */
async function listStructure() {
  const categories = await db
    .selectFrom("forumCategory")
    .select(["id", "title", "position"])
    .orderBy("position", "asc")
    .orderBy("id", "asc")
    .execute();

  const subForums = await db
    .selectFrom("subForum")
    .select([
      "id",
      "categoryId",
      "title",
      "description",
      "visibility",
      "position",
    ])
    .orderBy("position", "asc")
    .orderBy("id", "asc")
    .execute();

  return categories.map((category) => ({
    ...category,
    subForums: subForums.filter((subForum) =>
      subForum.categoryId === category.id
    ),
  }));
}

async function createCategory(
  title: string,
  position: number,
): Promise<string> {
  const created = await db
    .insertInto("forumCategory")
    .values({ title, position })
    .returning("id")
    .executeTakeFirstOrThrow();

  return created.id;
}

async function updateCategory(
  id: string,
  values: { title: string; position: number },
): Promise<"not_found" | undefined> {
  const updated = await db
    .updateTable("forumCategory")
    .set(values)
    .where("id", "=", id)
    .returning("id")
    .executeTakeFirst();

  return updated === undefined ? "not_found" : undefined;
}

export type CategoryDeletionRefusal = "not_found" | "not_empty";

/**
 * Refused while it still holds sub-forums, rather than taking them with it. The database says the
 * same thing through ON DELETE RESTRICT; this is here to answer with a sentence instead of a 500.
 */
async function deleteCategory(
  id: string,
): Promise<CategoryDeletionRefusal | undefined> {
  const held = await db
    .selectFrom("subForum")
    .select("id")
    .where("categoryId", "=", id)
    .executeTakeFirst();

  if (held !== undefined) {
    return "not_empty";
  }

  const deleted = await db
    .deleteFrom("forumCategory")
    .where("id", "=", id)
    .returning("id")
    .executeTakeFirst();

  return deleted === undefined ? "not_found" : undefined;
}

export type SubForumValues = {
  categoryId: string;
  title: string;
  description: string;
  visibility: ForumVisibility;
  position: number;
};

async function createSubForum(
  values: SubForumValues,
): Promise<{ id: string } | "category_not_found"> {
  const category = await db
    .selectFrom("forumCategory")
    .select("id")
    .where("id", "=", values.categoryId)
    .executeTakeFirst();

  if (category === undefined) {
    return "category_not_found";
  }

  const created = await db
    .insertInto("subForum")
    .values(values)
    .returning("id")
    .executeTakeFirstOrThrow();

  return { id: created.id };
}

export type SubForumRefusal = "not_found" | "category_not_found";

/** Moving one into another category is the same write as renaming it: `categoryId` is a value. */
async function updateSubForum(
  id: string,
  values: SubForumValues,
): Promise<SubForumRefusal | undefined> {
  const category = await db
    .selectFrom("forumCategory")
    .select("id")
    .where("id", "=", values.categoryId)
    .executeTakeFirst();

  if (category === undefined) {
    return "category_not_found";
  }

  const updated = await db
    .updateTable("subForum")
    .set(values)
    .where("id", "=", id)
    .returning("id")
    .executeTakeFirst();

  return updated === undefined ? "not_found" : undefined;
}

export type SubForumDeletionRefusal = "not_found" | "not_empty";

/** Refused while it still holds threads, for the same reason a category is. */
async function deleteSubForum(
  id: string,
): Promise<SubForumDeletionRefusal | undefined> {
  const held = await db
    .selectFrom("forumThread")
    .select("id")
    .where("subForumId", "=", id)
    .executeTakeFirst();

  if (held !== undefined) {
    return "not_empty";
  }

  const deleted = await db
    .deleteFrom("subForum")
    .where("id", "=", id)
    .returning("id")
    .executeTakeFirst();

  return deleted === undefined ? "not_found" : undefined;
}

export const ForumStructureService = {
  selectOverview,
  listStructure,
  createCategory,
  updateCategory,
  deleteCategory,
  createSubForum,
  updateSubForum,
  deleteSubForum,
};
