import { db } from "@/src/database/client.ts";
import { NotificationService } from "@/src/service/notification_service.ts";

/**
 * The reveal: two people who have been writing without knowing who the other is decide to find out.
 *
 * **Both, or neither.** Each says yes for themselves and either can take it back while the other
 * has not answered — a single switch would let whoever pressed first decide for both, and the one
 * moment this whole ritual is aimed at is not somebody else's to take.
 *
 * What actually happens is one flag. `writing_group.authors_are_pseudonymous` goes false and the
 * same group — every post, every thread, every row — is read under real names from then on. Nothing
 * is copied, nothing migrated, and nothing was ever stored under a pseudonym to begin with.
 *
 * **It does not make the group public.** Whether the writing is published is the pair's own
 * decision, taken through the ordinary visibility setting like any other group's. Revealing
 * answers "who are you", not "may everybody read this".
 */

/**
 * How much has to be written together before either side may ask to be revealed.
 *
 * The point of the number is that the anonymity should last long enough to be worth something —
 * two people who reveal after three posts have written to a stranger, not with one.
 *
 * **Counted on the RPG thread alone.** The other three are organisation: two profiles and a place
 * for everything outside the story. Counting those would let a pair talk their way to the button
 * without ever writing the thing they were matched for.
 */
export const POSTS_BEFORE_REVEAL = 50;

export type OwnBlindDate = {
  writingGroupId: string;
  plotTitle: string;
  matchedAt: string;
  /** Posts in the RPG thread, and what is still missing. Both, so the interface can say either. */
  rpgPosts: number;
  postsBeforeReveal: number;
  /** False until the RPG thread has `POSTS_BEFORE_REVEAL` posts in it. */
  mayReveal: boolean;
  /** Whether this member has said yes. */
  iAgreed: boolean;
  /**
   * Whether the other has. Not a leak: it is the person they are already writing with, and knowing
   * somebody is waiting on you is the whole social half of the moment.
   */
  otherAgreed: boolean;
};

/** The member's own running Blind-Date, or nothing. Revealed ones are ordinary groups and gone. */
async function selectOwnBlindDate(
  userId: string,
): Promise<OwnBlindDate | undefined> {
  const mine = await db
    .selectFrom("blindDatePartner")
    .innerJoin("blindDatePair", "blindDatePair.id", "blindDatePartner.pairId")
    .innerJoin(
      "writingGroup",
      "writingGroup.id",
      "blindDatePair.writingGroupId",
    )
    .select([
      "blindDatePair.id as pairId",
      "blindDatePair.writingGroupId",
      "blindDatePair.matchedAt",
      "writingGroup.title as plotTitle",
      "blindDatePair.rpgThreadId",
      "blindDatePartner.wantsRevealAt",
    ])
    .where("blindDatePartner.userId", "=", userId)
    .where("blindDatePartner.isActive", "=", true)
    .executeTakeFirst();

  if (mine === undefined) {
    return undefined;
  }

  const rpgPosts = await countRpgPosts(mine.rpgThreadId);

  const other = await db
    .selectFrom("blindDatePartner")
    .select("wantsRevealAt")
    .where("pairId", "=", mine.pairId)
    .where("userId", "!=", userId)
    .executeTakeFirst();

  return {
    writingGroupId: mine.writingGroupId,
    plotTitle: mine.plotTitle,
    matchedAt: mine.matchedAt,
    rpgPosts,
    postsBeforeReveal: POSTS_BEFORE_REVEAL,
    mayReveal: rpgPosts >= POSTS_BEFORE_REVEAL,
    iAgreed: mine.wantsRevealAt !== null,
    // Spelled out rather than `!= null`: a pair with no second partner row is not a pair whose
    // other side agreed, and the two cases are worth telling apart in the reading.
    otherAgreed: other !== undefined && other.wantsRevealAt !== null,
  };
}

/**
 * Posts in the RPG thread. Drafts do not count: a draft is not something the other has read, and
 * the threshold is about what the two have actually written to each other.
 *
 * A pair made before there were four threads has no `rpg_thread_id` and counts zero. That is the
 * safe direction — it holds the button rather than opening it — and no such pair exists outside a
 * development database.
 */
async function countRpgPosts(rpgThreadId: string | null): Promise<number> {
  if (rpgThreadId === null) {
    return 0;
  }

  const row = await db
    .selectFrom("writingPost")
    .select((eb) => eb.fn.countAll<number>().as("posts"))
    .where("writingThreadId", "=", rpgThreadId)
    .where("isDraft", "=", false)
    .executeTakeFirstOrThrow();

  return Number(row.posts);
}

export type RevealOutcome =
  /** Recorded, and the other has not answered yet. */
  | "waiting"
  /** Both have now agreed: the group is revealed. */
  | "revealed";

/** Refused because the two have not written enough together yet. */
export type RevealRefusal = "not_found" | "too_few_posts";

/**
 * Says yes, and reveals if that was the second yes.
 *
 * One transaction, because the second yes does five things at once and a half-done reveal — a
 * group with real names whose pair still says it is running — would be a state nobody could read
 * correctly afterwards.
 */
async function agreeToReveal(
  userId: string,
): Promise<RevealOutcome | RevealRefusal> {
  return await db.transaction().execute(async (transaction) => {
    const mine = await transaction
      .selectFrom("blindDatePartner")
      .innerJoin("blindDatePair", "blindDatePair.id", "blindDatePartner.pairId")
      .select([
        "blindDatePair.id as pairId",
        "blindDatePair.writingGroupId",
        "blindDatePair.rpgThreadId",
        "blindDatePartner.wantsRevealAt",
      ])
      .where("blindDatePartner.userId", "=", userId)
      .where("blindDatePartner.isActive", "=", true)
      .executeTakeFirst();

    if (mine === undefined) {
      return "not_found";
    }

    // Checked here and not only in the interface: a greyed-out button is a courtesy, and the rule
    // has to hold for anybody who reaches the endpoint another way.
    if (await countRpgPosts(mine.rpgThreadId) < POSTS_BEFORE_REVEAL) {
      return "too_few_posts";
    }

    // Read before the write, so pressing the button again does not tell the other person a second
    // time about a decision they have already been told about.
    const wasAlreadyAgreed = mine.wantsRevealAt !== null;

    await transaction
      .updateTable("blindDatePartner")
      .set({ wantsRevealAt: new Date().toISOString() })
      .where("pairId", "=", mine.pairId)
      .where("userId", "=", userId)
      // Only where it is not already set: pressing twice must not move the moment somebody said
      // yes, which is the only thing that timestamp is for.
      .where("wantsRevealAt", "is", null)
      .execute();

    const partners = await transaction
      .selectFrom("blindDatePartner")
      .select("wantsRevealAt")
      .where("pairId", "=", mine.pairId)
      .execute();

    const everybodyAgreed = partners.length > 0 &&
      partners.every((partner) => partner.wantsRevealAt !== null);

    if (!everybodyAgreed) {
      // The other has to be told, or the decision waits for somebody with no reason to look —
      // which is exactly the bug this fixes. In the transaction, so a yes that was recorded is
      // always a yes that was passed on.
      if (!wasAlreadyAgreed) {
        const other = await transaction
          .selectFrom("blindDatePartner")
          .select("userId")
          .where("pairId", "=", mine.pairId)
          .where("userId", "!=", userId)
          .executeTakeFirst();

        if (other !== undefined) {
          await NotificationService.insertRevealRequestedNotification(
            transaction,
            mine.writingGroupId,
            other.userId,
          );
        }
      }

      return "waiting";
    }

    // The whole reveal: one flag on the group, the pair marked done, and both seats freed for a
    // next Blind-Date. The group keeps every post and stays private.
    await transaction
      .updateTable("writingGroup")
      .set({ authorsArePseudonymous: false })
      .where("id", "=", mine.writingGroupId)
      .execute();

    await transaction
      .updateTable("blindDatePair")
      .set({ revealedAt: new Date().toISOString() })
      .where("id", "=", mine.pairId)
      .execute();

    // `is_active` is what `blind_date_partner_one_active_per_member_idx` keys on, so this is the
    // line that lets either of them apply again.
    await transaction
      .updateTable("blindDatePartner")
      .set({ isActive: false })
      .where("pairId", "=", mine.pairId)
      .execute();

    return "revealed";
  });
}

/**
 * Takes it back, while it can still be taken back.
 *
 * Nothing records that somebody did: the question is only ever "do you want to, now", and a
 * history of hesitation would turn a private change of mind into something the other could ask
 * about.
 */
async function withdrawRevealConsent(
  userId: string,
): Promise<"not_found" | undefined> {
  const updated = await db
    .updateTable("blindDatePartner")
    .set({ wantsRevealAt: null })
    .where("userId", "=", userId)
    .where("isActive", "=", true)
    .returning("userId")
    .executeTakeFirst();

  return updated === undefined ? "not_found" : undefined;
}

/**
 * Whether these two are in a Blind-Date together that has not been revealed.
 *
 * The direct chat between them is closed while it is: the whole point is that they know each other
 * only through the group, and a private message carries a real name in its very first line.
 *
 * Symmetric on purpose — it asks about a pair, not about a direction — and it stops mattering the
 * moment they reveal, because from then on they are two people who know who the other is.
 */
async function areInActiveBlindDateTogether(
  first: string,
  second: string,
): Promise<boolean> {
  if (first === second) {
    return false;
  }

  const shared = await db
    .selectFrom("blindDatePartner as mine")
    .innerJoin(
      "blindDatePartner as theirs",
      "theirs.pairId",
      "mine.pairId",
    )
    .select("mine.pairId")
    .where("mine.userId", "=", first)
    .where("theirs.userId", "=", second)
    // Both seats still taken by this pair: revealing frees them, and a revealed Blind-Date is an
    // ordinary group whose two members may write to each other like anybody else.
    .where("mine.isActive", "=", true)
    .where("theirs.isActive", "=", true)
    .executeTakeFirst();

  return shared !== undefined;
}

export const BlindDateRevealService = {
  areInActiveBlindDateTogether,
  selectOwnBlindDate,
  agreeToReveal,
  withdrawRevealConsent,
};
