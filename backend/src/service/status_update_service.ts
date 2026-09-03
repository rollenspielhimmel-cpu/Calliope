import { WordFilterService } from "@/src/service/word_filter_service.ts";
import type { Selectable } from "kysely";
import { db } from "@/src/database/client.ts";
import type {
  StatusUpdate as DatabaseStatusUpdate,
  StatusUpdateComment as DatabaseStatusUpdateComment,
} from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";

export type StatusUpdate =
  & Pick<
    Selectable<DatabaseStatusUpdate>,
    "id" | "createdBy" | "body" | "createdAt"
  >
  // Never null, unlike a group's posts: created_by is NOT NULL and CASCADE, so a status
  // update cannot outlive its author.
  & { createdByUsername: string; commentCount: number };

export type StatusUpdateComment =
  & Pick<
    Selectable<DatabaseStatusUpdateComment>,
    "id" | "statusUpdateId" | "createdBy" | "body" | "createdAt"
  >
  & { createdByUsername: string };

const STATUS_UPDATE_COLUMNS = [
  "statusUpdate.id",
  "statusUpdate.createdBy",
  "statusUpdate.body",
  "statusUpdate.createdAt",
] as const;

function statusUpdatesWithAuthor() {
  return db
    .selectFrom("statusUpdate")
    .innerJoin("user", "user.id", "statusUpdate.createdBy")
    .select([...STATUS_UPDATE_COLUMNS, "user.username as createdByUsername"]);
}

/**
 * Newest first, paged by a cursor rather than an offset — the same reasoning as a chat's
 * messages: a status posted while somebody reads shifts the window, so page two would repeat or
 * skip whatever crossed the boundary. Ids are uuidv7 and therefore time-ordered, so comparing
 * them orders the feed too.
 */
async function listStatusUpdates(
  { limit, before }: { limit: number; before?: string },
): Promise<{ results: StatusUpdate[]; nextCursor: string | null }> {
  let page = statusUpdatesWithAuthor()
    .leftJoin(
      "statusUpdateComment",
      "statusUpdateComment.statusUpdateId",
      "statusUpdate.id",
    )
    .select((eb) =>
      eb.fn.count<number>("statusUpdateComment.id").as("commentCount")
    )
    .groupBy(["statusUpdate.id", "user.id"])
    .orderBy("statusUpdate.id", "desc")
    // One more than asked for, purely to know whether another page exists.
    .limit(limit + 1);

  if (before !== undefined) {
    page = page.where("statusUpdate.id", "<", before);
  }

  const rows = await page.execute();
  const results = rows.slice(0, limit);

  return {
    // Masked at the read, like every other prose surface — see `word_filter_service.ts`.
    results: await Promise.all(
      results.map(async (update) => ({
        ...update,
        body: await WordFilterService.maskText(update.body),
      })),
    ),
    nextCursor: rows.length > limit ? results.at(-1)?.id ?? null : null,
  };
}

async function createStatusUpdate(
  createdBy: string,
  body: string,
): Promise<StatusUpdate> {
  const trimmed = body.trim().slice(0, TEXT_LIMIT.statusUpdateBody);

  const { id } = await db
    .insertInto("statusUpdate")
    .values({ createdBy, body: trimmed })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  // Re-read rather than RETURNING, which cannot reach the joined author name. The comment
  // count is not re-read: a status update this is the response to has just been created, so it
  // is zero by construction.
  const created = await statusUpdatesWithAuthor()
    .where("statusUpdate.id", "=", id)
    .executeTakeFirstOrThrow();

  return { ...created, commentCount: 0 };
}

export type StatusUpdateRefusal = "not_found";

function commentsWithAuthor() {
  return db
    .selectFrom("statusUpdateComment")
    .innerJoin("user", "user.id", "statusUpdateComment.createdBy")
    .select([
      "statusUpdateComment.id",
      "statusUpdateComment.statusUpdateId",
      "statusUpdateComment.createdBy",
      "statusUpdateComment.body",
      "statusUpdateComment.createdAt",
      "user.username as createdByUsername",
    ]);
}

async function listComments(
  statusUpdateId: string,
): Promise<StatusUpdateComment[] | StatusUpdateRefusal> {
  const statusUpdate = await db
    .selectFrom("statusUpdate")
    .select("id")
    .where("id", "=", statusUpdateId)
    .executeTakeFirst();

  if (statusUpdate === undefined) {
    return "not_found";
  }

  return await commentsWithAuthor()
    .where("statusUpdateComment.statusUpdateId", "=", statusUpdateId)
    // Oldest first — a conversation reads top to bottom. Ids order it the same way created_at
    // would, and are what the feed above already sorts by.
    .orderBy("statusUpdateComment.id", "asc")
    .execute();
}

async function createComment(
  statusUpdateId: string,
  createdBy: string,
  body: string,
): Promise<StatusUpdateComment | StatusUpdateRefusal> {
  const statusUpdate = await db
    .selectFrom("statusUpdate")
    .select("id")
    .where("id", "=", statusUpdateId)
    .executeTakeFirst();

  if (statusUpdate === undefined) {
    return "not_found";
  }

  const trimmed = body.trim().slice(0, TEXT_LIMIT.statusUpdateCommentBody);

  const { id } = await db
    .insertInto("statusUpdateComment")
    .values({ statusUpdateId, createdBy, body: trimmed })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  return await commentsWithAuthor()
    .where("statusUpdateComment.id", "=", id)
    .executeTakeFirstOrThrow();
}

export const StatusUpdateService = {
  listStatusUpdates,
  createStatusUpdate,
  listComments,
  createComment,
};
