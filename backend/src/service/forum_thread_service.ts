import { db } from "@/src/database/client.ts";
import type { ForumVisibility } from "@/src/database/schema.ts";
import type { PostDocument } from "@/src/document/document_schema.ts";
import { documentToPlainText } from "@/src/document/document_text.ts";
import {
  type ListQuery,
  type ListResults,
  listResultsWithCount,
  searchPattern,
} from "@/src/list/list_endpoint_query.ts";
import {
  type ForumReader,
  maySee,
  visibilityCeiling,
} from "@/src/service/forum_visibility.ts";
import { withFavourite } from "@/src/query/favourite.ts";
import type { User } from "@/src/service/user_service.ts";
import { WordFilterService } from "@/src/service/word_filter_service.ts";

/**
 * Threads in a sub-forum and the posts in them.
 *
 * Every read here starts from the same place: what the reader may see. That is the stricter of the
 * sub-forum's visibility and the thread's own — see `forum_visibility.ts` — and it is applied in
 * SQL so a list, a count and a single lookup cannot disagree about it. There is no separate
 * "is it visible" call for a route to forget.
 *
 * Deliberately unlike its neighbour next door: a `writing_post` may be a draft and is authorised
 * through the group's membership. Neither applies here, and nothing is shared but the document.
 */

/** The sub-forum a thread list is being read from, once the reader is allowed it. */
export type VisibleSubForum = {
  id: string;
  title: string;
  description: string;
  visibility: ForumVisibility;
  categoryTitle: string;
};

async function selectSubForum(
  subForumId: string,
  reader: ForumReader,
): Promise<VisibleSubForum | undefined> {
  return await db
    .selectFrom("subForum")
    .innerJoin("forumCategory", "forumCategory.id", "subForum.categoryId")
    .select([
      "subForum.id",
      "subForum.title",
      "subForum.description",
      "subForum.visibility",
      "forumCategory.title as categoryTitle",
    ])
    .where("subForum.id", "=", subForumId)
    .where("subForum.visibility", "<=", visibilityCeiling(reader))
    .executeTakeFirst();
}

export type ForumThreadSummary = {
  id: string;
  title: string;
  visibility: ForumVisibility | null;
  createdAt: string;
  lastActivityAt: string;
  createdByUsername: string | null;
  posts: number;
};

/**
 * The threads of one sub-forum, newest activity first by default.
 *
 * `posts` is counted per thread in the same query rather than fetched per row: a sub-forum's list
 * is twenty threads, and twenty extra round trips is the shape that makes a forum feel slow.
 */
function threadsIn(subForumId: string, reader: ForumReader) {
  const ceiling = visibilityCeiling(reader);

  return db
    .selectFrom("forumThread")
    .innerJoin("subForum", "subForum.id", "forumThread.subForumId")
    .leftJoin("user", "user.id", "forumThread.createdBy")
    .where("forumThread.subForumId", "=", subForumId)
    // The stricter of the two, as everywhere else.
    .where((eb) =>
      eb(
        eb.fn("greatest", [
          "subForum.visibility",
          eb.fn.coalesce("forumThread.visibility", "subForum.visibility"),
        ]),
        "<=",
        ceiling,
      )
    )
    .select((eb) => [
      "forumThread.id",
      "forumThread.title",
      "forumThread.visibility",
      "forumThread.createdAt",
      "forumThread.lastActivityAt",
      "user.username as createdByUsername",
      eb
        .selectFrom("forumPost")
        .select((inner) => inner.fn.countAll<number>().as("count"))
        .whereRef("forumPost.forumThreadId", "=", "forumThread.id")
        .as("posts"),
    ]);
}

async function listThreads(
  subForumId: string,
  reader: ForumReader,
  query: ListQuery,
): Promise<ListResults<ForumThreadSummary>> {
  const results = await listResultsWithCount(
    threadsIn(subForumId, reader).$if(
      query.search !== undefined,
      (builder) =>
        builder.where(
          "forumThread.title",
          "ilike",
          // deno-lint-ignore no-non-null-assertion -- the `$if` only runs this when it is set
          searchPattern(query.search!),
        ),
    ),
    query,
  );

  return {
    totalResults: results.totalResults,
    results: results.results.map((thread) => ({
      ...thread,
      posts: Number(thread.posts ?? 0),
    })),
  };
}

export type ForumThread = ForumThreadSummary & {
  subForumId: string;
  subForumTitle: string;
  /** What the thread is actually read at: the stricter of its own and its sub-forum's. */
  effectiveVisibility: ForumVisibility;
};

async function selectThread(
  threadId: string,
  reader: ForumReader,
): Promise<ForumThread | undefined> {
  const ceiling = visibilityCeiling(reader);

  const thread = await db
    .selectFrom("forumThread")
    .innerJoin("subForum", "subForum.id", "forumThread.subForumId")
    .leftJoin("user", "user.id", "forumThread.createdBy")
    .select((eb) => [
      "forumThread.id",
      "forumThread.title",
      "forumThread.visibility",
      "forumThread.createdAt",
      "forumThread.lastActivityAt",
      "forumThread.subForumId",
      "subForum.title as subForumTitle",
      "user.username as createdByUsername",
      eb.fn("greatest", [
        "subForum.visibility",
        eb.fn.coalesce("forumThread.visibility", "subForum.visibility"),
      ]).$castTo<ForumVisibility>().as("effectiveVisibility"),
      eb
        .selectFrom("forumPost")
        .select((inner) => inner.fn.countAll<number>().as("count"))
        .whereRef("forumPost.forumThreadId", "=", "forumThread.id")
        .as("posts"),
    ])
    .where("forumThread.id", "=", threadId)
    .where((eb) =>
      eb(
        eb.fn("greatest", [
          "subForum.visibility",
          eb.fn.coalesce("forumThread.visibility", "subForum.visibility"),
        ]),
        "<=",
        ceiling,
      )
    )
    .executeTakeFirst();

  return thread === undefined
    ? undefined
    : { ...thread, posts: Number(thread.posts ?? 0) };
}

export type ForumPost = {
  id: string;
  document: PostDocument;
  /** The server's own plain-text projection, which is what an edit is measured against. */
  text: string;
  createdAt: string;
  createdBy: string | null;
  createdByUsername: string | null;
  editedAt: string | null;
  editedByUsername: string | null;
  isFavourite: boolean;
};

/**
 * The posts of a thread, oldest first — a forum is read forwards, unlike a chat.
 *
 * The caller has already resolved the thread through `selectThread`, which is what decides
 * whether these may be read at all; nothing is re-checked per post because a post carries no
 * visibility of its own.
 */
async function listPosts(
  threadId: string,
  query: ListQuery,
  // The account rather than `ForumReader`, unlike its neighbours: whose favourites these are is
  // a question about an id, and `ForumReader` deliberately knows only about the role.
  reader: User | undefined,
): Promise<ListResults<ForumPost>> {
  // The join is skipped altogether for a reader without an account rather than run against a
  // stand-in id: `favourite.user_id` is a UUID, and no value there means "nobody".
  const readerId = reader?.id;

  const page = await listResultsWithCount(
    db
      .selectFrom("forumPost")
      .leftJoin("user", "user.id", "forumPost.createdBy")
      .where("forumPost.forumThreadId", "=", threadId)
      .$if(
        readerId !== undefined,
        (builder) =>
          // deno-lint-ignore no-non-null-assertion -- the `$if` only runs this when it is set
          withFavourite(builder, "forum_post", "forumPost.id", readerId!),
      )
      .select((eb) => [
        "forumPost.id",
        // Cast rather than selected plainly: the column's generated type is `unknown`, and
        // `DOCUMENT_SCHEMA` is what says what may be in there. Same as `writing_post`.
        eb.ref("forumPost.document").$castTo<PostDocument>().as("document"),
        "forumPost.text",
        "forumPost.createdAt",
        "forumPost.createdBy",
        "forumPost.editedAt",
        "user.username as createdByUsername",
        eb
          .selectFrom("user as editor")
          .select("editor.username")
          .whereRef("editor.id", "=", "forumPost.editedBy")
          .as("editedByUsername"),
      ]),
    query,
  );

  // `$if` leaves the alias optional in the type, which is what it is: absent when nobody is
  // reading, and nobody has favourites.
  //
  // Masked here rather than in the query: the blocked-word list is applied when text is read, and
  // this is the read. `visible_target.ts` reaches a post's text without coming through here, on
  // purpose — a report's excerpt is evidence and has to be what was actually written.
  return {
    ...page,
    results: await WordFilterService.maskPosts(
      page.results.map((post) => ({
        ...post,
        isFavourite: post.isFavourite ?? false,
      })),
    ),
  };
}

/**
 * A thread and its first post, in one transaction: a thread with no post in it would show in
 * every list as an empty row nobody can answer, and there is no draft state here to explain it.
 */
async function createThread(
  subForumId: string,
  title: string,
  document: PostDocument,
  createdBy: string,
): Promise<{ threadId: string }> {
  return await db.transaction().execute(async (transaction) => {
    const thread = await transaction
      .insertInto("forumThread")
      .values({ subForumId, title, createdBy })
      .returning("id")
      .executeTakeFirstOrThrow();

    await transaction
      .insertInto("forumPost")
      .values({
        forumThreadId: thread.id,
        document,
        // Written by the server, never sent by the client — the same rule `writing_post.text`
        // follows, because search and a report excerpt read text and cannot read a tree.
        text: documentToPlainText(document),
        createdBy,
      })
      .execute();

    return { threadId: thread.id };
  });
}

async function createPost(
  threadId: string,
  document: PostDocument,
  createdBy: string,
): Promise<{ postId: string }> {
  const post = await db
    .insertInto("forumPost")
    .values({
      forumThreadId: threadId,
      document,
      text: documentToPlainText(document),
      createdBy,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return { postId: post.id };
}

export type PostRefusal = "not_found" | "not_yours";

/**
 * Editing marks the post as edited, which is the one change a reader is told about. An operator
 * may edit anybody's; everybody else only their own.
 */
async function updatePost(
  threadId: string,
  postId: string,
  document: PostDocument,
  editedBy: string,
  mayEditAnybody: boolean,
): Promise<PostRefusal | undefined> {
  const post = await db
    .selectFrom("forumPost")
    .select(["id", "createdBy"])
    .where("id", "=", postId)
    .where("forumThreadId", "=", threadId)
    .executeTakeFirst();

  if (post === undefined) {
    return "not_found";
  }

  if (!mayEditAnybody && post.createdBy !== editedBy) {
    return "not_yours";
  }

  await db
    .updateTable("forumPost")
    .set({
      document,
      text: documentToPlainText(document),
      editedAt: Temporal.Now.instant().toString(),
      editedBy,
    })
    .where("id", "=", postId)
    .execute();

  return undefined;
}

/**
 * Deleting the last post of a thread takes the thread with it: a thread with nothing in it is
 * the empty row `createThread` exists to prevent, and leaving one behind would be the same state
 * reached from the other end.
 */
async function deletePost(
  threadId: string,
  postId: string,
  deletedBy: string,
  mayDeleteAnybody: boolean,
): Promise<PostRefusal | undefined> {
  return await db.transaction().execute(async (transaction) => {
    const post = await transaction
      .selectFrom("forumPost")
      .select(["id", "createdBy"])
      .where("id", "=", postId)
      .where("forumThreadId", "=", threadId)
      .executeTakeFirst();

    if (post === undefined) {
      return "not_found";
    }

    if (!mayDeleteAnybody && post.createdBy !== deletedBy) {
      return "not_yours";
    }

    await transaction.deleteFrom("forumPost").where("id", "=", postId)
      .execute();

    const remaining = await transaction
      .selectFrom("forumPost")
      .select("id")
      .where("forumThreadId", "=", threadId)
      .executeTakeFirst();

    if (remaining === undefined) {
      await transaction
        .deleteFrom("forumThread")
        .where("id", "=", threadId)
        .execute();
    }

    return undefined;
  });
}

/**
 * The two moderation levers on a thread. Both take the reader and resolve the thread through
 * `selectThread`, so what may be acted on is exactly what may be seen — one rule, not a second
 * copy of it that could drift.
 *
 * `beyond_your_reach` is the rule that is not simply "may you see it". A moderator may not put a
 * thread somewhere they cannot follow it: doing so would hide it from the person who hid it, with
 * no way back. It is 403 rather than 404 because the thread is plainly there — they are reading it.
 */
export type ThreadModerationRefusal = "not_found" | "beyond_your_reach";

/** Narrowing a thread, or `null` to let it fall back to its sub-forum's setting. */
async function setThreadVisibility(
  threadId: string,
  visibility: ForumVisibility | null,
  reader: ForumReader,
): Promise<ThreadModerationRefusal | undefined> {
  if (await selectThread(threadId, reader) === undefined) {
    return "not_found";
  }

  // `null` is always within reach: it can only widen a thread back to its sub-forum's setting,
  // which the mover is already reading.
  if (visibility !== null && !maySee(visibility, reader)) {
    return "beyond_your_reach";
  }

  const updated = await db
    .updateTable("forumThread")
    .set({ visibility })
    .where("id", "=", threadId)
    .returning("id")
    .executeTakeFirst();

  return updated === undefined ? "not_found" : undefined;
}

/**
 * Moving a thread into another sub-forum.
 *
 * The target is resolved against the mover's own ceiling, so a sub-forum they may not read is
 * `not_found` — the same answer reading it would give, and for the same reason.
 *
 * Note what does *not* need guarding: a thread carrying its own `visibility` keeps it through the
 * move, and the stricter of the two still wins, so moving a marked thread into an open sub-forum
 * cannot publish it. Only a thread with no marking of its own takes on wherever it lands — which
 * is the point of moving, and what the interface has to say out loud before it happens.
 */
async function moveThread(
  threadId: string,
  subForumId: string,
  reader: ForumReader,
): Promise<ThreadModerationRefusal | undefined> {
  if (await selectThread(threadId, reader) === undefined) {
    return "not_found";
  }

  const target = await db
    .selectFrom("subForum")
    .select("id")
    .where("id", "=", subForumId)
    .where("visibility", "<=", visibilityCeiling(reader))
    .executeTakeFirst();

  if (target === undefined) {
    return "not_found";
  }

  // Idempotent: moving a thread where it already is is not an error, and the trigger that used
  // to make this bump `last_activity_at` is gone — see 20260902200000.
  await db
    .updateTable("forumThread")
    .set({ subForumId })
    .where("id", "=", threadId)
    .execute();

  return undefined;
}

export const ForumThreadService = {
  selectSubForum,
  listThreads,
  selectThread,
  listPosts,
  createThread,
  createPost,
  updatePost,
  deletePost,
  setThreadVisibility,
  moveThread,
};
