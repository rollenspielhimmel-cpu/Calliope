import { WordFilterService } from "@/src/service/word_filter_service.ts";
import type { Selectable } from "kysely";
import { db, type Executor, type Transaction } from "@/src/database/client.ts";
import type {
  StatusUpdate as DatabaseStatusUpdate,
  StatusUpdateComment as DatabaseStatusUpdateComment,
} from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { NotificationService } from "@/src/service/notification_service.ts";
import type { User } from "@/src/service/user_service.ts";

export type StatusUpdate =
  & Pick<
    Selectable<DatabaseStatusUpdate>,
    "id" | "createdBy" | "body" | "createdAt"
  >
  // Never null, unlike a group's posts: created_by is NOT NULL and CASCADE, so a status
  // update cannot outlive its author.
  & { createdByUsername: string; commentCount: number };

/**
 * Ein Zitat, wie es die Oberfläche braucht: der Kommentar selbst, nicht eine Kopie davon.
 *
 * **Frisch gelesen, nicht mitgeschrieben.** Ändert jemand seinen Kommentar, stimmt das Zitat
 * weiterhin; benennt sich jemand um, steht überall sofort der neue Name. Genau dafür ist aus dem
 * Zitat ein Bezug geworden.
 */
export type QuotedComment = {
  id: string;
  body: string;
  createdBy: string;
  createdByUsername: string;
};

export type StatusUpdateComment =
  & Pick<
    Selectable<DatabaseStatusUpdateComment>,
    "id" | "statusUpdateId" | "createdBy" | "body" | "createdAt"
  >
  & { createdByUsername: string; quotedComment: QuotedComment | null };

const STATUS_UPDATE_COLUMNS = [
  "statusUpdate.id",
  "statusUpdate.createdBy",
  "statusUpdate.body",
  "statusUpdate.createdAt",
] as const;

/**
 * Liest mit dem Ausführenden, den der Aufrufer mitbringt: In einer Transaktion muss das Zurücklesen
 * dieselbe sehen, sonst findet es die eben geschriebene Zeile nicht — gemessen, als genau das
 * einen 500er ergab.
 */
function statusUpdatesWithAuthor(executor: Executor = db) {
  return executor
    .selectFrom("statusUpdate")
    .innerJoin("user", "user.id", "statusUpdate.createdBy")
    .select([...STATUS_UPDATE_COLUMNS, "user.username as createdByUsername"]);
}

/**
 * Wen dieses Mitglied in den Statusmeldungen nicht sehen will.
 *
 * **Gefiltert wird beim Lesen, nie beim Schreiben** — wie bei den Blocks. Wer jemanden wieder
 * einblendet, bekommt zurück, was verborgen war, statt einer Lücke in der Geschichte.
 *
 * **Die Moderation blendet niemanden aus.** Für sie muss alles sichtbar sein: Im Löschprotokoll
 * steht nur, was gelöscht wurde — was jemand geschrieben und stehen gelassen hat, sieht man nur,
 * wenn man es sehen kann. Deshalb gibt diese Abfrage für eine Rolle leere Listen zurück, statt
 * dass jede Lesestelle daran denken muss.
 */
async function hiddenBy(user: User): Promise<{
  updates: string[];
  comments: string[];
}> {
  if (user.platformRole !== null) {
    return { updates: [], comments: [] };
  }

  const rows = await db
    .selectFrom("statusUpdateHiddenMember")
    .select(["hiddenUserId", "hideUpdates", "hideComments"])
    .where("userId", "=", user.id)
    .execute();

  return {
    updates: rows.filter((row) => row.hideUpdates).map((row) =>
      row.hiddenUserId
    ),
    comments: rows.filter((row) => row.hideComments).map((row) =>
      row.hiddenUserId
    ),
  };
}

/** Was im Einstellungsdialog steht: wen man ausblendet, und womit. */
export type HiddenMember = {
  userId: string;
  username: string;
  hideUpdates: boolean;
  hideComments: boolean;
};

async function listHiddenMembers(userId: string): Promise<HiddenMember[]> {
  return await db
    .selectFrom("statusUpdateHiddenMember")
    .innerJoin("user", "user.id", "statusUpdateHiddenMember.hiddenUserId")
    .select([
      "statusUpdateHiddenMember.hiddenUserId as userId",
      "user.username",
      "statusUpdateHiddenMember.hideUpdates",
      "statusUpdateHiddenMember.hideComments",
    ])
    .where("statusUpdateHiddenMember.userId", "=", userId)
    .orderBy("user.username", "asc")
    .execute();
}

export type HideRefusal = "not_found" | "not_yourself";

/**
 * Stellt für ein Mitglied ein, was von einem anderen verborgen bleibt.
 *
 * Beide Schalter aus heißt: Der Eintrag verschwindet. Sonst gäbe es zwei Arten, „ich sehe alles
 * von dir" zu speichern, und jede Abfrage müsste beide kennen.
 */
async function setHiddenMember(
  transaction: Transaction,
  userId: string,
  hiddenUserId: string,
  { hideUpdates, hideComments }: {
    hideUpdates: boolean;
    hideComments: boolean;
  },
): Promise<HideRefusal | undefined> {
  if (userId === hiddenUserId) {
    return "not_yourself";
  }

  const member = await transaction
    .selectFrom("user")
    .select("id")
    .where("id", "=", hiddenUserId)
    .executeTakeFirst();

  if (member === undefined) {
    return "not_found";
  }

  if (!hideUpdates && !hideComments) {
    await transaction
      .deleteFrom("statusUpdateHiddenMember")
      .where("userId", "=", userId)
      .where("hiddenUserId", "=", hiddenUserId)
      .execute();
    return undefined;
  }

  await transaction
    .insertInto("statusUpdateHiddenMember")
    .values({ userId, hiddenUserId, hideUpdates, hideComments })
    .onConflict((conflict) =>
      conflict
        .columns(["userId", "hiddenUserId"])
        .doUpdateSet({ hideUpdates, hideComments })
    )
    .execute();

  return undefined;
}

/**
 * Newest first, paged by a cursor rather than an offset — the same reasoning as a chat's
 * messages: a status posted while somebody reads shifts the window, so page two would repeat or
 * skip whatever crossed the boundary. Ids are uuidv7 and therefore time-ordered, so comparing
 * them orders the feed too.
 */
async function listStatusUpdates(
  user: User,
  { limit, before }: { limit: number; before?: string },
): Promise<{ results: StatusUpdate[]; nextCursor: string | null }> {
  const hidden = await hiddenBy(user);

  let page = statusUpdatesWithAuthor()
    .leftJoin(
      "statusUpdateComment",
      "statusUpdateComment.statusUpdateId",
      "statusUpdate.id",
    )
    /**
     * **Die Zahl zählt, was man sehen kann.** Steht dort eine Vier und öffnet sich ein Strang mit
     * zwei Kommentaren, sieht das nach einem Fehler aus — und verrät nebenbei, dass da noch etwas
     * ist.
     *
     * Gefiltert wird **in der Zählung**, nicht in der Auswahl. Eine Bedingung auf den
     * verbundenen Kommentar wirft sonst die ganze Meldung hinaus, sobald *alle* ihre Kommentare
     * ausgeblendet sind — der linke Verbund hat dann keine Zeile mehr, die durchkäme. Genau so
     * ist es beim ersten Versuch passiert, und der Test hat es gefangen.
     */
    .select((eb) => {
      const comments = eb.fn.count<number>("statusUpdateComment.id");
      return (hidden.comments.length === 0 ? comments : comments.filterWhere(
        "statusUpdateComment.createdBy",
        "not in",
        hidden.comments,
      )).as("commentCount");
    })
    .groupBy(["statusUpdate.id", "user.id"])
    .orderBy("statusUpdate.id", "desc")
    // One more than asked for, purely to know whether another page exists.
    .limit(limit + 1);

  if (before !== undefined) {
    page = page.where("statusUpdate.id", "<", before);
  }

  if (hidden.updates.length > 0) {
    page = page.where("statusUpdate.createdBy", "not in", hidden.updates);
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
  transaction: Transaction,
  createdBy: string,
  body: string,
): Promise<StatusUpdate> {
  const trimmed = body.trim().slice(0, TEXT_LIMIT.statusUpdateBody);

  const { id } = await transaction
    .insertInto("statusUpdate")
    .values({ createdBy, body: trimmed })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  // Re-read rather than RETURNING, which cannot reach the joined author name. The comment
  // count is not re-read: a status update this is the response to has just been created, so it
  // is zero by construction.
  const created = await statusUpdatesWithAuthor(transaction)
    .where("statusUpdate.id", "=", id)
    .executeTakeFirstOrThrow();

  return { ...created, commentCount: 0 };
}

export type StatusUpdateRefusal = "not_found";

/**
 * Ein Kommentar mit seinem Verfasser — und, wenn er zitiert, mit dem zitierten Kommentar.
 *
 * Die beiden Verknüpfungen für das Zitat sind links: Die meisten Kommentare zitieren nichts, und
 * ein innerer Verbund ließe genau die verschwinden.
 */
function commentsWithAuthor(executor: Executor = db) {
  return executor
    .selectFrom("statusUpdateComment")
    .innerJoin("user", "user.id", "statusUpdateComment.createdBy")
    .leftJoin(
      "statusUpdateComment as quoted",
      "quoted.id",
      "statusUpdateComment.quotedCommentId",
    )
    .leftJoin("user as quotedAuthor", "quotedAuthor.id", "quoted.createdBy")
    .select([
      "statusUpdateComment.id",
      "statusUpdateComment.statusUpdateId",
      "statusUpdateComment.createdBy",
      "statusUpdateComment.body",
      "statusUpdateComment.createdAt",
      "user.username as createdByUsername",
      "quoted.id as quotedId",
      "quoted.body as quotedBody",
      "quoted.createdBy as quotedCreatedBy",
      "quotedAuthor.username as quotedCreatedByUsername",
    ]);
}

/**
 * Baut die vier Spalten des Zitats zu einem Ding zusammen — oder zu nichts.
 *
 * Vier nullbare Felder nebeneinander hieße, dass jede Lesestelle selbst entscheiden muss, wann ein
 * Zitat „da" ist. Hier wird das einmal entschieden: Es ist da, wenn der zitierte Kommentar noch
 * existiert.
 */
function withQuote<
  Row extends {
    quotedId: string | null;
    quotedBody: string | null;
    quotedCreatedBy: string | null;
    quotedCreatedByUsername: string | null;
  },
>(
  row: Row,
):
  & Omit<
    Row,
    "quotedId" | "quotedBody" | "quotedCreatedBy" | "quotedCreatedByUsername"
  >
  & { quotedComment: QuotedComment | null } {
  const {
    quotedId,
    quotedBody,
    quotedCreatedBy,
    quotedCreatedByUsername,
    ...rest
  } = row;

  return {
    ...rest,
    quotedComment:
      quotedId !== null && quotedBody !== null && quotedCreatedBy !== null &&
        quotedCreatedByUsername !== null
        ? {
          id: quotedId,
          body: quotedBody,
          createdBy: quotedCreatedBy,
          createdByUsername: quotedCreatedByUsername,
        }
        : null,
  };
}

async function listComments(
  user: User,
  statusUpdateId: string,
): Promise<StatusUpdateComment[] | StatusUpdateRefusal> {
  const hidden = await hiddenBy(user);

  const statusUpdate = await db
    .selectFrom("statusUpdate")
    .select("id")
    .where("id", "=", statusUpdateId)
    .executeTakeFirst();

  if (statusUpdate === undefined) {
    return "not_found";
  }

  let query = commentsWithAuthor()
    .where("statusUpdateComment.statusUpdateId", "=", statusUpdateId);

  if (hidden.comments.length > 0) {
    query = query.where(
      "statusUpdateComment.createdBy",
      "not in",
      hidden.comments,
    );
  }

  const comments = await query
    // Oldest first — a conversation reads top to bottom. Ids order it the same way created_at
    // would, and are what the feed above already sorts by.
    .orderBy("statusUpdateComment.id", "asc")
    .execute();

  return comments.map(withQuote);
}

export type CommentRefusal = StatusUpdateRefusal | "quoted_not_found";

async function createComment(
  transaction: Transaction,
  statusUpdateId: string,
  createdBy: string,
  body: string,
  /** Der Kommentar, auf den sich dieser bezieht. Muss unter derselben Meldung stehen. */
  quotedCommentId?: string,
): Promise<StatusUpdateComment | CommentRefusal> {
  const statusUpdate = await transaction
    .selectFrom("statusUpdate")
    .select("id")
    .where("id", "=", statusUpdateId)
    .executeTakeFirst();

  if (statusUpdate === undefined) {
    return "not_found";
  }

  // **Vorher geprüft, obwohl die Datenbank es auch täte.** Der zusammengesetzte Fremdschlüssel
  // lehnt ein Zitat aus einer fremden Meldung ab — aber als Verstoß, aus dem eine 500 würde. Ein
  // Nein mit Grund ist hier das, was die Oberfläche braucht.
  if (quotedCommentId !== undefined) {
    const quoted = await transaction
      .selectFrom("statusUpdateComment")
      .select("id")
      .where("id", "=", quotedCommentId)
      .where("statusUpdateId", "=", statusUpdateId)
      .executeTakeFirst();

    if (quoted === undefined) {
      return "quoted_not_found";
    }
  }

  const trimmed = body.trim().slice(0, TEXT_LIMIT.statusUpdateCommentBody);

  const { id } = await transaction
    .insertInto("statusUpdateComment")
    .values({
      statusUpdateId,
      createdBy,
      body: trimmed,
      quotedCommentId: quotedCommentId ?? null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  // In derselben Transaktion: Der Kommentar und die Mitteilung darüber gelten zusammen oder gar
  // nicht. Genau das war der Fehler, der den Transaktions-Umbau ausgelöst hat.
  await NotificationService.insertStatusUpdateCommentNotifications(
    transaction,
    statusUpdateId,
    createdBy,
  );

  // Aus derselben Transaktion gelesen: Sonst läuft die Rückfrage auf einer anderen Verbindung und
  // sieht die eben geschriebene Zeile nicht.
  return withQuote(
    await commentsWithAuthor(transaction)
      .where("statusUpdateComment.id", "=", id)
      .executeTakeFirstOrThrow(),
  );
}

/**
 * Was jemand über eine einzelne Meldung hören will.
 *
 * **Drei Stellungen, nicht zwei.** Nichts eingetragen heißt: die Regel gilt — Mitteilungen
 * bekommt, wer die Meldung geschrieben hat, und wer darunter kommentiert hat. Ausdrücklich an
 * heißt: auch ohne je etwas geschrieben zu haben. Ausdrücklich aus heißt: Ruhe, auch wenn man
 * mitgeschrieben hat.
 *
 * Zurück auf „die Regel gilt" kommt man, indem der Eintrag verschwindet — dafür ist `undefined`
 * da.
 */
async function setSubscription(
  transaction: Transaction,
  statusUpdateId: string,
  userId: string,
  subscribed: boolean | undefined,
): Promise<StatusUpdateRefusal | undefined> {
  const statusUpdate = await transaction
    .selectFrom("statusUpdate")
    .select("id")
    .where("id", "=", statusUpdateId)
    .executeTakeFirst();

  if (statusUpdate === undefined) {
    return "not_found";
  }

  if (subscribed === undefined) {
    await transaction
      .deleteFrom("statusUpdateSubscription")
      .where("statusUpdateId", "=", statusUpdateId)
      .where("userId", "=", userId)
      .execute();
    return undefined;
  }

  await transaction
    .insertInto("statusUpdateSubscription")
    .values({ statusUpdateId, userId, subscribed })
    .onConflict((conflict) =>
      conflict
        .columns(["userId", "statusUpdateId"])
        .doUpdateSet({ subscribed })
    )
    .execute();

  return undefined;
}

/**
 * Was für diese Meldung eingestellt ist — und was gälte, wenn nichts eingestellt wäre.
 *
 * Die Oberfläche braucht beides: Sie schreibt an den Knopf, was als Nächstes passiert, und dafür
 * muss sie wissen, ob gerade Mitteilungen kämen.
 */
async function subscriptionFor(
  statusUpdateId: string,
  userId: string,
): Promise<{ subscribed: boolean; explicit: boolean }> {
  const [entry, author, ownComment] = await Promise.all([
    db
      .selectFrom("statusUpdateSubscription")
      .select("subscribed")
      .where("statusUpdateId", "=", statusUpdateId)
      .where("userId", "=", userId)
      .executeTakeFirst(),
    db
      .selectFrom("statusUpdate")
      .select("id")
      .where("id", "=", statusUpdateId)
      .where("createdBy", "=", userId)
      .executeTakeFirst(),
    db
      .selectFrom("statusUpdateComment")
      .select("id")
      .where("statusUpdateId", "=", statusUpdateId)
      .where("createdBy", "=", userId)
      .executeTakeFirst(),
  ]);

  if (entry !== undefined) {
    return { subscribed: entry.subscribed, explicit: true };
  }

  return {
    subscribed: author !== undefined || ownComment !== undefined,
    explicit: false,
  };
}

export const StatusUpdateService = {
  listHiddenMembers,
  setHiddenMember,
  setSubscription,
  subscriptionFor,
  listStatusUpdates,
  createStatusUpdate,
  listComments,
  createComment,
};
