import { db } from "@/src/database/client.ts";
import type {
  BlindDateAgain,
  BlindDateVerdict,
} from "@/src/database/schema.ts";
import { ENDED_BECAUSE_A_PARTNER_LEFT } from "@/src/service/blind_date_ended_reason.ts";
import { NotificationService } from "@/src/service/notification_service.ts";

/**
 * How a Blind-Date stops when nobody reveals, and the one thing asked afterwards.
 *
 * Two halves of the same moment, which is why they share a file. Until now a Blind-Date could only
 * be revealed or taken away by the name guard — there was no way out of one, which meant somebody
 * who wanted to stop was stuck in it, and stuck out of the next one as well, because the seat is
 * only freed when a pair stops being current.
 *
 * **Either of them may end it, alone.** Not both, the way revealing needs both: a reveal is
 * something two people do to each other and must be mutual, while staying is something neither of
 * them owes. Requiring agreement to leave would make the way out depend on the person one is
 * trying to get away from.
 *
 * **Ending is not deleting**, the same as the guard's ending. The group, its four threads and
 * everything both of them wrote stay exactly as they are and stay pseudonymous. What ends is the
 * pairing.
 */

export type EndingRefusal = "not_found";

/**
 * Ends this member's running Blind-Date.
 *
 * One transaction: the pair, both seats and the other person's notification are one event, and a
 * half-done ending — a pair marked over with two people still holding its seats — is a state
 * nobody could put right by hand.
 *
 * The other side is told that it ended and nothing else. No reason and no actor, exactly as the
 * guard's ending tells them: „die andere Person hat beendet" invites an answer to a decision that
 * is not up for discussion, and the notification is not the place to have that out.
 */
async function endOwnBlindDate(
  userId: string,
): Promise<EndingRefusal | undefined> {
  return await db.transaction().execute(async (transaction) => {
    const mine = await transaction
      .selectFrom("blindDatePartner")
      .innerJoin("blindDatePair", "blindDatePair.id", "blindDatePartner.pairId")
      .select(["blindDatePair.id as pairId", "blindDatePair.writingGroupId"])
      .where("blindDatePartner.userId", "=", userId)
      .where("blindDatePartner.isActive", "=", true)
      .executeTakeFirst();

    if (mine === undefined) {
      return "not_found";
    }

    const ended = await transaction
      .updateTable("blindDatePair")
      .set({
        endedAt: new Date().toISOString(),
        endedReason: ENDED_BECAUSE_A_PARTNER_LEFT,
        endedBy: userId,
      })
      .where("id", "=", mine.pairId)
      // Both null, or the guard confirmed a leak in the same breath and its ending stands.
      .where("endedAt", "is", null)
      .where("revealedAt", "is", null)
      .returning("id")
      .executeTakeFirst();

    if (ended === undefined) {
      return "not_found";
    }

    // The line that frees both seats: `blind_date_partner_one_active_per_member_idx` keys on it,
    // so this is what lets either of them apply again.
    await transaction
      .updateTable("blindDatePartner")
      .set({ isActive: false })
      .where("pairId", "=", mine.pairId)
      .execute();

    const others = await transaction
      .selectFrom("blindDatePartner")
      .select("userId")
      .where("pairId", "=", mine.pairId)
      .where("userId", "!=", userId)
      .execute();

    for (const other of others) {
      await NotificationService.insertBlindDateEndedNotification(
        transaction,
        mine.writingGroupId,
        other.userId,
      );
    }

    return undefined;
  });
}

/**
 * A Blind-Date of this member's that is over and has not been asked about yet.
 *
 * The most recent one only. Somebody coming back after three of them should be asked about the one
 * they remember, not handed a queue of forms — and a form nobody can face is a form nobody fills
 * in.
 *
 * A declined form counts as asked: see the table's own comment. Without that the page would go on
 * asking after every ending for ever.
 */
export type FeedbackInvitation = {
  pairId: string;
  plotTitle: string;
  /** True where the two of them revealed, false where it ended without one. */
  wasRevealed: boolean;
  endedAt: string;
};

async function selectPendingFeedback(
  userId: string,
): Promise<FeedbackInvitation | undefined> {
  const row = await db
    .selectFrom("blindDatePartner")
    .innerJoin("blindDatePair", "blindDatePair.id", "blindDatePartner.pairId")
    .innerJoin(
      "writingGroup",
      "writingGroup.id",
      "blindDatePair.writingGroupId",
    )
    .select((eb) => [
      "blindDatePair.id as pairId",
      "writingGroup.title as plotTitle",
      "blindDatePair.revealedAt",
      "blindDatePair.endedAt",
      eb.fn
        .coalesce("blindDatePair.revealedAt", "blindDatePair.endedAt")
        .as("finishedAt"),
    ])
    .where("blindDatePartner.userId", "=", userId)
    .where((eb) =>
      eb.or([
        eb("blindDatePair.revealedAt", "is not", null),
        eb("blindDatePair.endedAt", "is not", null),
      ])
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("blindDateFeedback")
            .select("blindDateFeedback.id")
            .whereRef("blindDateFeedback.pairId", "=", "blindDatePair.id")
            .where("blindDateFeedback.userId", "=", userId),
        ),
      )
    )
    .orderBy("finishedAt", "desc")
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return {
    pairId: row.pairId,
    plotTitle: row.plotTitle,
    wasRevealed: row.revealedAt !== null,
    endedAt: String(row.finishedAt),
  };
}

export type FeedbackAnswers = {
  /** Both, or neither — neither being „nein danke". The table's CHECK says the same thing. */
  worked: BlindDateVerdict | null;
  again: BlindDateAgain | null;
  note: string | null;
};

export type FeedbackRefusal = "not_found" | "already_answered";

/**
 * Records one member's answers, or their decline.
 *
 * The pair is checked against this member rather than trusted from the request: the id comes from
 * the page, and a page can be edited. Somebody may only answer about a Blind-Date they were in.
 */
async function submitFeedback(
  userId: string,
  pairId: string,
  answers: FeedbackAnswers,
): Promise<FeedbackRefusal | undefined> {
  const theirs = await db
    .selectFrom("blindDatePartner")
    .innerJoin("blindDatePair", "blindDatePair.id", "blindDatePartner.pairId")
    .select("blindDatePair.id")
    .where("blindDatePartner.userId", "=", userId)
    .where("blindDatePartner.pairId", "=", pairId)
    .where((eb) =>
      eb.or([
        eb("blindDatePair.revealedAt", "is not", null),
        eb("blindDatePair.endedAt", "is not", null),
      ])
    )
    .executeTakeFirst();

  if (theirs === undefined) {
    return "not_found";
  }

  // Insert rather than upsert: the form is offered once, and a second answer would be somebody
  // changing what they said about a thing that is over. The unique key is what enforces it; the
  // race between two submits lands here rather than on a later read.
  const inserted = await db
    .insertInto("blindDateFeedback")
    .values({ pairId, userId, ...answers })
    .onConflict((conflict) =>
      conflict.columns(["pairId", "userId"]).doNothing()
    )
    .returning("id")
    .executeTakeFirst();

  return inserted === undefined ? "already_answered" : undefined;
}

/** One member's answers, as the team reads them. */
export type FeedbackEntry = {
  id: string;
  pairId: string;
  plotTitle: string;
  username: string;
  worked: BlindDateVerdict | null;
  again: BlindDateAgain | null;
  note: string | null;
  createdAt: string;
};

/**
 * Every answer, newest first, for the team.
 *
 * With names: the whole reason the team reads this is to ask somebody about what they wrote, and an
 * anonymous complaint about a format nobody can follow up is a worse thing to hold than a signed
 * one. The form says out loud that the team sees it and the other person never does.
 *
 * Declines are in here too, with both answers empty. A form nine people in ten decline is telling
 * the team something the answers themselves cannot.
 */
function listFeedback(): Promise<FeedbackEntry[]> {
  return db
    .selectFrom("blindDateFeedback")
    .innerJoin("user", "user.id", "blindDateFeedback.userId")
    .innerJoin("blindDatePair", "blindDatePair.id", "blindDateFeedback.pairId")
    .innerJoin(
      "writingGroup",
      "writingGroup.id",
      "blindDatePair.writingGroupId",
    )
    .select([
      "blindDateFeedback.id",
      "blindDateFeedback.pairId",
      "writingGroup.title as plotTitle",
      "user.username",
      "blindDateFeedback.worked",
      "blindDateFeedback.again",
      "blindDateFeedback.note",
      "blindDateFeedback.createdAt",
    ])
    .orderBy("blindDateFeedback.createdAt", "desc")
    .execute();
}

export const BlindDateEndingService = {
  endOwnBlindDate,
  selectPendingFeedback,
  submitFeedback,
  listFeedback,
};
