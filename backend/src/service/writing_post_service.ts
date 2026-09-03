import type { Selectable } from "kysely";
import { db, type Transaction } from "@/src/database/client.ts";
import { NotificationService } from "@/src/service/notification_service.ts";
import type { WritingPost as DatabaseWritingPost } from "@/src/database/schema.ts";
import type { PostDocument } from "@/src/document/document_schema.ts";
import { documentToPlainText } from "@/src/document/document_text.ts";
import {
  type ListQuery,
  type ListResults,
  listResultsWithCount,
  searchPattern,
} from "@/src/list/list_endpoint_query.ts";
import { type FavouriteFilter, withFavourite } from "@/src/query/favourite.ts";
import { WordFilterService } from "@/src/service/word_filter_service.ts";
import { PseudonymService } from "@/src/service/pseudonym_service.ts";
import { BlindDateNameGuardService } from "@/src/service/blind_date_name_guard_service.ts";
import { applyMask } from "@/src/service/word_filter_service.ts";

export type Post =
  & Pick<
    Selectable<DatabaseWritingPost>,
    | "id"
    | "writingThreadId"
    | "text"
    | "isDraft"
    | "createdBy"
    | "createdAt"
    | "editedAt"
    | "editedBy"
  >
  // Not picked from the table, where the column is `unknown` by design — see the `typeMapping`
  // note in `database/.kysely-codegenrc.ts`. This is the type that says what is in there.
  & { document: PostDocument }
  & {
    /** The reader's own favourite, visible to nobody else. */
    isFavourite: boolean;
  }
  // Both null once that account is deleted, because the columns are ON DELETE SET NULL.
  & { createdByUsername: string | null; editedByUsername: string | null }
  & {
    /**
     * True while moderation is looking at an automatically raised Blind-Date name suspicion for
     * this post. The post is shown as written either way — a suspicion is not a finding.
     */
    isUnderReview: boolean;
  };

const SELECTED_COLUMNS = [
  "writingPost.id",
  "writingPost.writingThreadId",
  "writingPost.text",
  "writingPost.isDraft",
  "writingPost.createdBy",
  "writingPost.createdAt",
  "writingPost.editedAt",
  "writingPost.editedBy",
] as const;

/** Reads one post back with its author, bypassing the draft filter: after a write the
 * caller has already established that it may see the row. */
function postWithAuthorById(
  postId: string,
  viewerId: string,
  executor: typeof db | Transaction = db,
) {
  return executor
    .selectFrom("writingPost")
    .leftJoin("user", "user.id", "writingPost.createdBy")
    .$call((builder) =>
      withFavourite(builder, "writing_post", "writingPost.id", viewerId)
    )
    .select((eb) => [
      ...SELECTED_COLUMNS,
      // Cast rather than selected plainly: the column's generated type is `unknown`, and
      // `DOCUMENT_SCHEMA` is what says what may be in there.
      eb.ref("writingPost.document").$castTo<PostDocument>().as("document"),
      "user.username as createdByUsername",
      // A subquery rather than a second join on `user`: an alias widens the builder's table
      // set past what `listResultsWithCount` accepts, and this is a primary-key lookup.
      eb.selectFrom("user as editor")
        .select("editor.username")
        .whereRef("editor.id", "=", "writingPost.editedBy")
        .as("editedByUsername"),
    ])
    .where("writingPost.id", "=", postId);
}

async function insertPost(
  writingGroupId: string,
  threadId: string,
  document: PostDocument,
  isDraft: boolean,
  createdBy: string,
): Promise<Post> {
  return await db.transaction().execute(async (transaction) => {
    const { id } = await transaction
      .insertInto("writingPost")
      // `text` is derived here rather than accepted, so it cannot disagree with the document.
      .values({
        writingThreadId: threadId,
        // An object, not a string: `JSON.stringify` here would store a jsonb *string* rather
        // than a document.
        document,
        text: documentToPlainText(document),
        isDraft,
        createdBy,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    // A draft is visible to nobody but its author, so there is nothing yet to announce. The
    // telling happens when it is published, which is an update rather than an insert.
    if (!isDraft) {
      await NotificationService.insertGroupActivityNotifications(transaction, {
        type: "new_writing_post",
        writingGroupId,
        writingThreadId: threadId,
        writingPostId: id,
        actorId: createdBy,
      });
    }

    // Re-read rather than RETURNING, which cannot reach the joined author name.
    return await withReviewFlag(
      await postWithAuthorById(id, createdBy, transaction)
        .executeTakeFirstOrThrow(),
    );
  });
}

/**
 * A draft is written before publishing, so it belongs to its author alone until it is
 * published. Everything else in the thread is readable by any member.
 */
function readableBy(viewerId: string, executor: typeof db | Transaction = db) {
  return executor
    .selectFrom("writingPost")
    .where((eb) =>
      eb.or([
        eb("writingPost.isDraft", "=", false),
        eb("writingPost.createdBy", "=", viewerId),
      ])
    );
}

/**
 * The author's name is joined in rather than stored, so it follows a rename. The join is
 * left: an account that has been deleted leaves the post behind with no author.
 */
function postsWithAuthor(
  viewerId: string,
  executor: typeof db | Transaction = db,
) {
  return readableBy(viewerId, executor)
    .leftJoin("user", "user.id", "writingPost.createdBy")
    .$call((builder) =>
      withFavourite(builder, "writing_post", "writingPost.id", viewerId)
    )
    .select((eb) => [
      ...SELECTED_COLUMNS,
      // Cast rather than selected plainly: the column's generated type is `unknown`, and
      // `DOCUMENT_SCHEMA` is what says what may be in there.
      eb.ref("writingPost.document").$castTo<PostDocument>().as("document"),
      "user.username as createdByUsername",
      // A subquery rather than a second join on `user`: an alias widens the builder's table
      // set past what `listResultsWithCount` accepts, and this is a primary-key lookup.
      eb.selectFrom("user as editor")
        .select("editor.username")
        .whereRef("editor.id", "=", "writingPost.editedBy")
        .as("editedByUsername"),
    ]);
}

/** Scoped to the thread, so a post id from another thread cannot be reached through it. */
async function selectPost(
  threadId: string,
  postId: string,
  viewerId: string,
): Promise<Post | undefined> {
  const post = await postsWithAuthor(viewerId)
    .where("writingPost.writingThreadId", "=", threadId)
    .where("writingPost.id", "=", postId)
    .executeTakeFirst();

  return post === undefined ? undefined : await withReviewFlag(post);
}

/** A post nobody is looking at, which is every post outside a Blind-Date's exchange thread. */
function notUnderReview<Row>(post: Row): Row & { isUnderReview: boolean } {
  return { ...post, isUnderReview: false };
}

/**
 * The same question for a single post, which the create, read and edit routes each answer once.
 *
 * One indexed lookup rather than skipping it: a post fetched on its own is read by the same two
 * people, and a notice that appears in the list but not on the post itself would look like a bug
 * in the page rather than a thing moderation is doing.
 */
async function withReviewFlag<Row extends { id: string }>(
  post: Row,
): Promise<Row & { isUnderReview: boolean }> {
  const underReview = await BlindDateNameGuardService.postsUnderReview([
    post.id,
  ]);

  return { ...post, isUnderReview: underReview.has(post.id) };
}

async function listPosts(
  threadId: string,
  viewerId: string,
  query: ListQuery & { isDraft: boolean; favourite: FavouriteFilter },
  /**
   * The group the thread belongs to, so the authors can be masked where it is a Blind-Date. The
   * caller has it — every route reaching this has already resolved the group to authorise the
   * read — and passing it beats a second query for a fact already in hand.
   */
  writingGroupId: string,
): Promise<ListResults<Post>> {
  // **No favourites-first ordering here, deliberately.** A thread is prose and reads in the order
  // it was written, so hoisting a favourited post above the paragraph before it would break the
  // reading. What a favourite earns a post is the thread's own filter, which is what #37 asked
  // for before this issue absorbed it.
  const page = await listResultsWithCount(
    postsWithAuthor(viewerId)
      .where("writingPost.writingThreadId", "=", threadId)
      .where("writingPost.isDraft", "=", query.isDraft)
      .$if(
        query.favourite === "only",
        (queryBuilder) => queryBuilder.where("favourite.id", "is not", null),
      )
      // The body rather than a title: a post has none.
      .$if(query.search !== undefined, (queryBuilder) =>
        queryBuilder.where(
          "writingPost.text",
          "ilike",
          // deno-lint-ignore no-non-null-assertion -- the `$if` above only runs this when the term is set
          searchPattern(query.search!),
        )),
    query,
  );

  // The blocked-word list, applied at the read. The search above deliberately runs against the
  // stored text: a member looking for a word should find the post that holds it, and masking
  // before searching would make the list quietly un-findable.
  const masked = await WordFilterService.maskPosts(page.results);

  // And the authors, where this group hides them. Both editors too: "bearbeitet von <name>" would
  // name the very person the pseudonym exists to hide.
  const mask = await PseudonymService.fullMaskForGroup(writingGroupId);

  if (mask === undefined) {
    return { ...page, results: masked.map(notUnderReview) };
  }

  // Which of these moderation is currently looking at, so the interface can say so beside them.
  // One query for the page, and only for a Blind-Date's posts.
  const underReview = await BlindDateNameGuardService.postsUnderReview(
    masked.map((post) => post.id),
  );

  return {
    ...page,
    results: masked.map((post) => ({
      ...post,
      createdByUsername: mask.author(post.createdBy).username,
      editedByUsername: post.editedByUsername === null
        ? null
        : mask.author(post.editedBy).username,
      // Only once a leak was confirmed, and then in every post: `mask.names` is undefined until
      // then, and masking on a suspicion would disfigure innocent prose before anybody looked.
      document: BlindDateNameGuardService.mask(post.document, mask.names),
      text: applyMask(post.text, mask.names),
      isUnderReview: underReview.has(post.id),
    })),
  };
}

/** Returns nothing when there is no such post. Authorisation is the caller's job. */
/**
 * `wasDraft` is the row's state before this change, which is what separates the three ways a
 * post can be written to: autosaving a draft, publishing one, and editing what is already
 * published. Only the last is an edit a reader is told about.
 */
/**
 * `wasDraft` is the row's state before this change, which is what separates the three ways a
 * post can be written to: autosaving a draft, publishing one, and editing what is already
 * published.
 */
async function updatePost(
  postId: string,
  changes: { document?: PostDocument; isDraft?: boolean },
  wasDraft: boolean,
  context: { writingGroupId: string; writingThreadId: string; actorId: string },
): Promise<Post | undefined> {
  const { document, ...rest } = changes;
  const isPublishing = wasDraft && changes.isDraft === false;
  const isEditingPublished = !wasDraft && document !== undefined;

  return await db.transaction().execute(async (transaction) => {
    const updated = await transaction
      .updateTable("writingPost")
      .set({
        ...rest,
        // Both columns move together, or the projection would describe a body it no longer has.
        ...(document !== undefined
          ? {
            document,
            text: documentToPlainText(document),
          }
          : {}),
        // A post is born when it is published, not when its draft was first autosaved: a
        // piece drafted over three days would otherwise appear dated three days ago and sort
        // into the middle of the thread it belongs at the end of.
        ...(isPublishing
          ? { createdAt: Temporal.Now.instant().toString() }
          : {}),
        // Who, not only when: `mayModify` lets somebody administering the group edit another
        // member's post, and the reader is told which of the two happened.
        ...(isEditingPublished
          ? {
            editedAt: Temporal.Now.instant().toString(),
            editedBy: context.actorId,
          }
          : {}),
      })
      .where("id", "=", postId)
      .returning(["id"])
      .executeTakeFirst();

    if (updated === undefined) {
      return undefined;
    }

    // Publishing is the moment the writing becomes everybody's; editing it again is not.
    if (isPublishing) {
      await NotificationService.insertGroupActivityNotifications(transaction, {
        type: "new_writing_post",
        writingGroupId: context.writingGroupId,
        writingThreadId: context.writingThreadId,
        writingPostId: updated.id,
        actorId: context.actorId,
      });
    }

    return await withReviewFlag(
      await postWithAuthorById(updated.id, context.actorId, transaction)
        .executeTakeFirstOrThrow(),
    );
  });
}

async function deletePost(postId: string): Promise<boolean> {
  const deletion = await db
    .deleteFrom("writingPost")
    .where("id", "=", postId)
    .executeTakeFirst();

  return deletion.numDeletedRows > 0n;
}

export const WritingPostService = {
  insertPost,
  selectPost,
  listPosts,
  updatePost,
  deletePost,
};
