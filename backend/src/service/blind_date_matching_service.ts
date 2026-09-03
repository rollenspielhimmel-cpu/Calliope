import { sql } from "kysely";
import { db } from "@/src/database/client.ts";
import type {
  BlindDatePairing,
  BlindDatePostLength,
  BlindDateWritingStyle,
} from "@/src/database/schema.ts";
import type { ListQuery, ListResults } from "@/src/list/list_endpoint_query.ts";
import { listResultsWithCount } from "@/src/list/list_endpoint_query.ts";
import { ActivityService } from "@/src/service/activity_service.ts";
import { NotificationService } from "@/src/service/notification_service.ts";

/**
 * The team's half of Blind-Date: the queue of applications, putting two of them together, and who
 * may not take part.
 *
 * **Nothing here decides anything.** There is no algorithm and deliberately none — whether two
 * writing styles will get on is a judgement, and the whole ritual rests on somebody making it. The
 * queue is sorted oldest first and carries what an operator needs to read; the pairing happens
 * because two application ids were named.
 */

export type PendingApplication = {
  id: string;
  createdAt: string;
  user: { id: string; username: string };
  /** So the team can see who is a regular without leaving the queue. */
  onlineMinutes: number;
  /**
   * True where this application is from somebody who works this desk themselves. They cannot see
   * the queue while it is open — that is the point of the suspension — and whoever is pairing is
   * told, because it changes what a careful choice looks like.
   */
  isBlindDateManager: boolean;
  offerTitle: string | null;
  plotTitle: string;
  writingStyle: BlindDateWritingStyle;
  postLength: BlindDatePostLength;
  roleGender: string;
  pairing: string;
  note: string | null;
};

/** Oldest first: whoever has waited longest is who the team should be looking at. */
async function listPendingApplications(): Promise<PendingApplication[]> {
  const rows = await db
    .selectFrom("blindDateApplication")
    .innerJoin("user", "user.id", "blindDateApplication.userId")
    .leftJoin(
      "blindDateOffer",
      "blindDateOffer.id",
      "blindDateApplication.offerId",
    )
    .select([
      "blindDateApplication.id",
      "blindDateApplication.createdAt",
      "blindDateApplication.plotTitle",
      "blindDateApplication.writingStyle",
      "blindDateApplication.postLength",
      "blindDateApplication.roleGender",
      "blindDateApplication.pairing",
      "blindDateApplication.note",
      "user.id as userId",
      "user.username",
      "user.mayManageBlindDate",
      "blindDateOffer.title as offerTitle",
    ])
    .where("blindDateApplication.status", "=", "pending")
    .orderBy("blindDateApplication.createdAt", "asc")
    .execute();

  // One read of the metric per applicant. The queue is a handful of rows, and the alternative —
  // leaving it out — makes the team open a profile per application to judge the same thing.
  const minutes = await Promise.all(
    rows.map((row) => ActivityService.onlineMinutesInLast30Days(row.userId)),
  );

  return rows.map((row, index) => ({
    id: row.id,
    createdAt: row.createdAt,
    user: { id: row.userId, username: row.username },
    onlineMinutes: minutes[index] ?? 0,
    isBlindDateManager: row.mayManageBlindDate,
    offerTitle: row.offerTitle,
    plotTitle: row.plotTitle,
    writingStyle: row.writingStyle,
    postLength: row.postLength,
    roleGender: row.roleGender,
    pairing: row.pairing,
    note: row.note,
  }));
}

/**
 * The four threads a Blind-Date starts with, in the order they appear.
 *
 * One each to introduce a character, one for everything that is not the story, and the story
 * itself. The names carry the pseudonyms rather than anybody's own, which is what lets the first
 * two be written in before either side knows who the other is.
 *
 * Only the RPG thread counts towards the fifty posts the reveal asks for — the other three are
 * organisation, and counting them would let two people talk their way to the button.
 */
const PROFILE_THREAD_TITLES = [
  "Steckbrief | Blind-Date1",
  "Steckbrief | Blind-Date2",
] as const;

const EXCHANGE_THREAD_TITLE = "Gemeinsamer Austausch";

/** „Heads Up | RPG" — the plot, then what the thread is for. */
function rpgThreadTitle(plotTitle: string): string {
  return `${plotTitle} | RPG`;
}

export type MatchRefusal =
  | "not_found"
  | "same_member"
  | "already_matched"
  | "excluded";

/**
 * Puts two applications together, in one transaction.
 *
 * Everything or nothing: the group, both memberships, the first thread, the pair and its partners,
 * and both applications moving to `matched`. A half-made Blind-Date — a group with one member, or
 * a pair whose applications are still in the queue — is a state nobody could clean up by hand
 * without knowing what was meant, so it is not a state that can occur.
 *
 * The inserts are written here rather than delegated to `WritingGroupService.insertWritingGroup`
 * and `WritingThreadService.insertThread`: both open transactions of their own, and nesting them
 * would give up the guarantee above. What is duplicated is four `INSERT`s.
 *
 * The plot is passed in rather than taken from one of the applications, because the two may name
 * different ones and choosing between them is the team's call, like everything else here.
 */
async function matchApplications(
  firstApplicationId: string,
  secondApplicationId: string,
  plotTitle: string,
  synopsis: string,
  matchedBy: string,
): Promise<MatchRefusal | undefined> {
  if (firstApplicationId === secondApplicationId) {
    return "same_member";
  }

  return await db.transaction().execute(async (transaction) => {
    const applications = await transaction
      .selectFrom("blindDateApplication")
      .select(["id", "userId"])
      .where("id", "in", [firstApplicationId, secondApplicationId])
      .where("status", "=", "pending")
      .execute();

    if (applications.length !== 2) {
      return "not_found";
    }

    const [first, second] = applications;

    if (first === undefined || second === undefined) {
      return "not_found";
    }

    if (first.userId === second.userId) {
      return "same_member";
    }

    // Nobody can be in this position any more, so nothing checks for it. A manager with an open
    // application cannot see the queue, and the root administrator — the one account that could
    // have — may not apply at all: see `administration_account` in `blind_date_service.ts`.

    const userIds = [first.userId, second.userId];

    const excluded = await transaction
      .selectFrom("blindDateExclusion")
      .select("userId")
      .where("userId", "in", userIds)
      .executeTakeFirst();

    // Somebody may have been excluded after applying. Checked here rather than trusted from the
    // queue, which was rendered at some earlier moment.
    if (excluded !== undefined) {
      return "excluded";
    }

    const alreadyMatched = await transaction
      .selectFrom("blindDatePartner")
      .select("userId")
      .where("userId", "in", userIds)
      .where("isActive", "=", true)
      .executeTakeFirst();

    // The database refuses this too — see `blind_date_partner_one_active_per_member_idx` — but a
    // named refusal beats a constraint violation surfacing as a 500.
    if (alreadyMatched !== undefined) {
      return "already_matched";
    }

    const group = await transaction
      .insertInto("writingGroup")
      .values({
        title: plotTitle,
        synopsis,
        // Private, and it stays private through the reveal: whether the writing is published is
        // the pair's decision, taken through the ordinary visibility setting.
        visibility: "private",
        authorsArePseudonymous: true,
        // Nobody "created" it — the team did, and naming an operator here would put a third
        // person in a group of two. `created_by` is nullable for exactly this kind of case.
        createdBy: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const userId of userIds) {
      // deno-lint-ignore no-await-in-loop -- two rows, inside the transaction that owns them
      await transaction
        .insertInto("userInWritingGroup")
        .values({
          writingGroupId: group.id,
          userId,
          // Both administrators: it is their group, and neither outranks the other.
          role: "administrator",
          status: "joined",
        })
        .execute();
    }

    // Four threads, in reading order. `created_by` is null on all of them for the reason the
    // group's is: the team made them, and naming an operator would put a third person in a group
    // of two.
    const threads = await transaction
      .insertInto("writingThread")
      .values([
        ...PROFILE_THREAD_TITLES.map((title) => ({
          writingGroupId: group.id,
          title,
          createdBy: null,
        })),
        {
          writingGroupId: group.id,
          title: EXCHANGE_THREAD_TITLE,
          createdBy: null,
        },
        {
          writingGroupId: group.id,
          title: rpgThreadTitle(plotTitle),
          createdBy: null,
        },
      ])
      .returning(["id", "title"])
      .execute();

    const exchangeThread = threads.find(
      (thread) => thread.title === EXCHANGE_THREAD_TITLE,
    );
    const rpgThread = threads.find(
      (thread) => thread.title === rpgThreadTitle(plotTitle),
    );

    const pair = await transaction
      .insertInto("blindDatePair")
      .values({
        writingGroupId: group.id,
        matchedBy,
        // Held by id, not by title: the members may rename any of these, and every rule that
        // reads one of them has to keep pointing at the same thread afterwards.
        rpgThreadId: rpgThread?.id ?? null,
        exchangeThreadId: exchangeThread?.id ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const application of applications) {
      // deno-lint-ignore no-await-in-loop -- two rows each, inside the same transaction
      await transaction
        .insertInto("blindDatePartner")
        .values({
          pairId: pair.id,
          userId: application.userId,
          applicationId: application.id,
        })
        .execute();
    }

    await transaction
      .updateTable("blindDateApplication")
      .set({
        status: "matched",
        decidedAt: new Date().toISOString(),
        decidedBy: matchedBy,
      })
      .where("id", "in", [firstApplicationId, secondApplicationId])
      .execute();

    // Inside the transaction, so a Blind-Date that exists is always one both people were told
    // about. Being matched is the moment this stops being a form and starts being something that
    // is happening — the old system sent a written message for it, and it mattered to people.
    await NotificationService.insertBlindDateMatchedNotifications(
      transaction,
      group.id,
      userIds,
    );

    return undefined;
  });
}

/** Declining keeps the row, like every other answer to an application. */
async function declineApplication(
  applicationId: string,
  decidedBy: string,
  note: string | null,
): Promise<"not_found" | undefined> {
  const declined = await db
    .updateTable("blindDateApplication")
    .set({
      status: "declined",
      decidedAt: new Date().toISOString(),
      decidedBy,
      decisionNote: note,
    })
    .where("id", "=", applicationId)
    .where("status", "=", "pending")
    .returning("id")
    .executeTakeFirst();

  return declined === undefined ? "not_found" : undefined;
}

export type Exclusion = {
  user: { id: string; username: string };
  reason: string;
  addedBy: { id: string; username: string } | null;
  addedAt: string;
};

/**
 * Who may not take part.
 *
 * Its own list rather than a flag on the watchlist, and the migration says why: that list states
 * of itself that it is neither an incident nor a consequence, and an exclusion is a consequence.
 */
async function listExclusions(): Promise<Exclusion[]> {
  const rows = await db
    .selectFrom("blindDateExclusion")
    .innerJoin("user", "user.id", "blindDateExclusion.userId")
    .leftJoin(
      "user as operator",
      "operator.id",
      "blindDateExclusion.addedBy",
    )
    .select([
      "user.id as userId",
      "user.username",
      "blindDateExclusion.reason",
      "blindDateExclusion.addedAt",
      "operator.id as addedById",
      "operator.username as addedByUsername",
    ])
    .orderBy("user.username", "asc")
    .execute();

  return rows.map((row) => ({
    user: { id: row.userId, username: row.username },
    reason: row.reason,
    addedAt: row.addedAt,
    addedBy: row.addedById === null || row.addedByUsername === null
      ? null
      : { id: row.addedById, username: row.addedByUsername },
  }));
}

/**
 * Excluding somebody also withdraws whatever they have waiting: leaving an application in the
 * queue that can never be matched would have the team read it again at every round.
 */
async function exclude(
  userId: string,
  reason: string,
  addedBy: string,
): Promise<"not_found" | undefined> {
  const target = await db
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst();

  if (target === undefined) {
    return "not_found";
  }

  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("blindDateExclusion")
      .values({ userId, reason, addedBy })
      .onConflict((conflict) =>
        conflict.column("userId").doUpdateSet({ reason, addedBy })
      )
      .execute();

    await transaction
      .updateTable("blindDateApplication")
      .set({
        status: "declined",
        decidedAt: new Date().toISOString(),
        decidedBy: addedBy,
        decisionNote: "Vom Blind-Date ausgeschlossen",
      })
      .where("userId", "=", userId)
      .where("status", "=", "pending")
      .execute();
  });

  return undefined;
}

/** Nothing is undone by this — a Blind-Date already running stays. It only lifts the bar. */
async function removeExclusion(userId: string): Promise<void> {
  await db.deleteFrom("blindDateExclusion").where("userId", "=", userId)
    .execute();
}

export type Participation = {
  id: string;
  username: string;
  /** Seen through to the reveal. */
  revealed: number;
  /** Ended without a reveal, for whatever reason — by either of them or by the guard. */
  ended: number;
  /**
   * Of those, the ones this member ended themselves.
   *
   * The distinction the table exists for: one of them left and the other was left, and counting
   * both as an abandonment would put the same mark on the person who did nothing.
   */
  endedByThem: number;
  /** Neither yet — one at most, but counted rather than assumed. */
  running: number;
  /** The distinct reasons behind `ended`, empty where nothing ended. */
  endedReasons: string[];
  /** When they were last matched, so a long-dormant row reads as history. */
  lastMatchedAt: string | null;
};

/**
 * How a member's Blind-Dates have gone: seen through, broken off, or still running.
 *
 * **A moderation tool, and only that.** This is the same figure the member sees on their own
 * profile, cut three ways and put next to everybody else's — which is a ranking, and a ranking is
 * exactly what this platform decided against showing members. Behind the operator gate it is
 * casework: somebody who breaks off four Blind-Dates in a row leaves four people mid-story, and
 * that is a pattern nobody can see one application at a time.
 *
 * Grouped per member rather than per pair, because the question is about the person.
 * `listResultsWithCount` counts the rows of the grouped query rather than the rows behind it, so
 * the total is the number of members and not the number of pairings.
 *
 * Only members who have actually been in one appear: the inner join does that on its own, and a
 * list padded with everybody at nought would bury the handful of rows worth reading.
 */
function listParticipation(
  query: ListQuery,
): Promise<ListResults<Participation>> {
  return listResultsWithCount(
    db
      .selectFrom("blindDatePartner")
      .innerJoin(
        "blindDatePair",
        "blindDatePair.id",
        "blindDatePartner.pairId",
      )
      .innerJoin("user", "user.id", "blindDatePartner.userId")
      .select((eb) => [
        // Named `id` because every list is tie-broken on that column; see `listResultsWithCount`.
        "user.id as id",
        "user.username",
        eb.fn
          .countAll<number>()
          .filterWhere("blindDatePair.revealedAt", "is not", null)
          .as("revealed"),
        eb.fn
          .countAll<number>()
          .filterWhere("blindDatePair.endedAt", "is not", null)
          .as("ended"),
        eb.fn
          .countAll<number>()
          .filterWhere("blindDatePair.endedBy", "=", eb.ref("user.id"))
          .as("endedByThem"),
        eb.fn
          .countAll<number>()
          .filterWhere("blindDatePair.revealedAt", "is", null)
          .filterWhere("blindDatePair.endedAt", "is", null)
          .as("running"),
        // Why the broken-off ones ended, without repeating a reason once per pair. Empty where
        // none ended. The team reads this beside the numbers: „zwei abgebrochen" says something
        // different depending on whether the guard ended them or the two of them agreed to stop.
        sql<string[]>`coalesce(array_agg(distinct ${
          sql.ref("blind_date_pair.ended_reason")
        }) filter (where ${
          sql.ref("blind_date_pair.ended_at")
        } is not null), '{}')`
          .as("endedReasons"),
        eb.fn
          .max("blindDatePair.matchedAt")
          .as("lastMatchedAt"),
      ])
      .groupBy(["user.id", "user.username"]),
    query,
  );
}

export type AdminOffer = {
  id: string;
  title: string;
  description: string;
  roles: string[];
  closesAt: string | null;
  pairing: BlindDatePairing | null;
  genres: string[];
  closedAt: string | null;
  createdAt: string;
};

/** Every offer, closed ones included: the team needs to see what it has already run. */
async function listAllOffers(): Promise<AdminOffer[]> {
  return await db
    .selectFrom("blindDateOffer")
    .select([
      "id",
      "title",
      "description",
      "roles",
      "closesAt",
      "pairing",
      "genres",
      "closedAt",
      "createdAt",
    ])
    .orderBy("closedAt", "asc")
    .orderBy("createdAt", "desc")
    .execute();
}

/**
 * Offers a plot.
 *
 * The roles are the team's, and applying to this plot means choosing one of them — which is why
 * they are set when the plot is offered rather than described by each applicant in their own
 * words. An offer may name none, and then the role stays the free text it always was.
 */
export type OfferValues = {
  title: string;
  description: string;
  roles: string[];
  closesAt: string | null;
  pairing: BlindDatePairing | null;
  genres: string[];
};

async function createOffer(
  values: OfferValues,
  createdBy: string,
): Promise<void> {
  await db
    .insertInto("blindDateOffer")
    .values({ ...values, createdBy })
    .execute();
}

/**
 * Changes an offer that is still open.
 *
 * There was no way to do this at all, which made a typo permanent and a description that hit the
 * old length limit unfixable — the only way out was to close the offer and write a second one,
 * leaving the first in the list for ever.
 *
 * A closed one stays as it was: applications point at it, and it has to keep saying what somebody
 * applied for months later. The roles may be edited, and an application keeps the text it chose, so
 * a later edit cannot rewrite what anybody applied for.
 */
async function updateOffer(
  offerId: string,
  values: OfferValues,
): Promise<"not_found" | undefined> {
  const updated = await db
    .updateTable("blindDateOffer")
    .set(values)
    .where("id", "=", offerId)
    .where("closedAt", "is", null)
    .returning("id")
    .executeTakeFirst();

  return updated === undefined ? "not_found" : undefined;
}

/** Closed rather than deleted: applications point at it, and it has to stay readable. */
async function closeOffer(offerId: string): Promise<"not_found" | undefined> {
  const closed = await db
    .updateTable("blindDateOffer")
    .set({ closedAt: new Date().toISOString() })
    .where("id", "=", offerId)
    .where("closedAt", "is", null)
    .returning("id")
    .executeTakeFirst();

  return closed === undefined ? "not_found" : undefined;
}

export const BlindDateMatchingService = {
  listPendingApplications,
  matchApplications,
  declineApplication,
  listExclusions,
  exclude,
  removeExclusion,
  listParticipation,
  listAllOffers,
  createOffer,
  updateOffer,
  closeOffer,
};
