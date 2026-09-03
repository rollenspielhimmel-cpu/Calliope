import { db } from "@/src/database/client.ts";
import type {
  BlindDatePairing,
  BlindDatePostLength,
  BlindDateWritingStyle,
} from "@/src/database/schema.ts";
import { ActivityService } from "@/src/service/activity_service.ts";
import { ENDED_BECAUSE_NAME_REVEALED } from "@/src/service/blind_date_ended_reason.ts";

/**
 * Who may apply for a Blind-Date, and the applications themselves.
 *
 * The matching is `blind_date_matching_service.ts` and the pseudonymity is
 * `pseudonym_service.ts`; this file is the member's half — whether they may take part, and what
 * they asked for.
 */

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
//   ███  PLATZHALTER  ███   Hier gehört das Veröffentlichungsdatum von Blind-Date hin.
//
//   Solange dies `undefined` ist, läuft die Anlaufphase und die 1000-Minuten-Regel greift NICHT.
//   Das ist Absicht: bei Veröffentlichung hat naturgemäß niemand 1000 Minuten gesammelt.
//
//   Sobald das echte Datum feststeht, wird genau diese eine Zeile ersetzt, zum Beispiel:
//
//       const LAUNCHED_ON: string | undefined = "2027-03-01";
//
//   Die Regel greift dann drei Monate danach von selbst. Nichts anderes ist zu ändern.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const LAUNCHED_ON: string | undefined = undefined;

/**
 * The grace period the platform owner asked for, counted from the launch above.
 *
 * A fixed date rather than "three months after this instance first ran": a database set up afresh
 * would silently restart the grace period, and an environment variable would put a rule nobody can
 * read in review into a deployment setting.
 */
const GRACE_MONTHS = 3;

/** The rule itself, once the grace period is over. */
export const REQUIRED_ONLINE_MINUTES = 1_000;

/** When the 1000-minute rule starts being applied, or `undefined` while no launch date is set. */
export function onlineTimeEnforcedFrom(): Date | undefined {
  if (LAUNCHED_ON === undefined) {
    return undefined;
  }

  const launched = new Date(`${LAUNCHED_ON}T00:00:00Z`);
  return new Date(
    Date.UTC(
      launched.getUTCFullYear(),
      launched.getUTCMonth() + GRACE_MONTHS,
      launched.getUTCDate(),
    ),
  );
}

/** Whether the online-time condition is live yet. */
export function onlineTimeIsEnforced(now: Date = new Date()): boolean {
  const from = onlineTimeEnforcedFrom();
  return from !== undefined && now >= from;
}

/**
 * Why somebody may not apply, or `undefined` when they may.
 *
 * The order matters: an excluded member is told that and nothing else. Telling them their online
 * time on top would invite them to fix the wrong thing.
 */
export type Ineligibility =
  | "excluded"
  | "already_applied"
  | "already_matched"
  | "not_enough_online_time";

export type Eligibility = {
  /** `undefined` when they may apply. */
  reason: Ineligibility | undefined;
  /** What they have, so the form can say so rather than only refusing. */
  onlineMinutes: number;
  requiredOnlineMinutes: number;
  /** True while the launch grace period is running and the minutes do not count against anybody. */
  inGracePeriod: boolean;
};

async function eligibilityFor(
  userId: string,
  now: Date = new Date(),
): Promise<Eligibility> {
  const enforced = onlineTimeIsEnforced(now);

  const [excluded, pending, matched, onlineMinutes] = await Promise.all([
    db
      .selectFrom("blindDateExclusion")
      .select("userId")
      .where("userId", "=", userId)
      .executeTakeFirst(),
    db
      .selectFrom("blindDateApplication")
      .select("id")
      .where("userId", "=", userId)
      .where("status", "=", "pending")
      .executeTakeFirst(),
    db
      .selectFrom("blindDatePartner")
      .select("userId")
      .where("userId", "=", userId)
      .where("isActive", "=", true)
      .executeTakeFirst(),
    // Read even while the grace period runs, because the form shows it either way — somebody
    // should be able to see where they stand before the rule starts applying to them.
    ActivityService.onlineMinutesInLast30Days(userId, now),
  ]);

  const reason: Ineligibility | undefined = excluded !== undefined
    ? "excluded"
    : matched !== undefined
    ? "already_matched"
    : pending !== undefined
    ? "already_applied"
    : enforced && onlineMinutes < REQUIRED_ONLINE_MINUTES
    ? "not_enough_online_time"
    : undefined;

  return {
    reason,
    onlineMinutes,
    requiredOnlineMinutes: REQUIRED_ONLINE_MINUTES,
    inGracePeriod: !enforced,
  };
}

export type Offer = {
  id: string;
  title: string;
  description: string;
  /**
   * The roles this plot has, as the team named them. Empty where it named none, and then the
   * applicant describes the role they want in their own words as before.
   */
  roles: string[];
  /** When applying stops, where the team set a date. Null means „until we have enough". */
  closesAt: string | null;
  /** Which pairing the plot is written for, or null where the team did not say. */
  pairing: BlindDatePairing | null;
  /** What it feels like, in the team's own words. Empty where it named none. */
  genres: string[];
  createdAt: string;
};

/**
 * What the team is offering right now. Closed offers are history and stay out.
 *
 * An offer whose deadline has passed is **not** filtered out here. Nothing closes an offer
 * automatically — that is the team's decision — so it stays on the page with its date showing and
 * `apply` refuses it. Dropping it silently would be closing it automatically while pretending not
 * to, and somebody who applied yesterday would find the plot gone.
 */
async function listOpenOffers(): Promise<Offer[]> {
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
      "createdAt",
    ])
    .where("closedAt", "is", null)
    .orderBy("createdAt", "desc")
    .execute();
}

/**
 * One offer, for the page that shows a plot in full.
 *
 * The card truncates, because a card that grows with its text stops being a card — so there has to
 * be somewhere the whole thing is readable, and a page rather than an expanding box because a plot
 * worth eight thousand characters is worth a link somebody can send.
 *
 * Open ones only, like the list: an offer the team has closed is no longer on the page the link
 * came from.
 */
async function selectOpenOffer(offerId: string): Promise<Offer | undefined> {
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
      "createdAt",
    ])
    .where("id", "=", offerId)
    .where("closedAt", "is", null)
    .executeTakeFirst();
}

/**
 * A Blind-Date that is running, as everybody else may see it.
 *
 * **This is the one public window onto them, and it is deliberately narrow.** No names, no ids, no
 * dates that could be lined up against somebody's activity — a plot, how much has been written and
 * when it last was. Its whole purpose is to show that Blind-Date is alive, which is what makes
 * people apply.
 *
 * The number is an ordinal for reading, not an identity: it comes from the order the pairs were
 * matched in, so it shifts if an older one is deleted. Nothing refers to it.
 */
export type ActiveBlindDate = {
  number: number;
  plotTitle: string;
  posts: number;
  lastActivityAt: string;
};

/** Only the unrevealed ones: a revealed Blind-Date is an ordinary group and no longer this. */
async function listActiveBlindDates(): Promise<ActiveBlindDate[]> {
  const rows = await db
    .selectFrom("blindDatePair")
    .innerJoin(
      "writingGroup",
      "writingGroup.id",
      "blindDatePair.writingGroupId",
    )
    .select((eb) => [
      "writingGroup.title as plotTitle",
      "writingGroup.lastActivityAt",
      eb
        .selectFrom("writingPost")
        .innerJoin(
          "writingThread",
          "writingThread.id",
          "writingPost.writingThreadId",
        )
        .select((inner) => inner.fn.countAll<number>().as("posts"))
        .whereRef("writingThread.writingGroupId", "=", "writingGroup.id")
        // A draft is not a post anybody has read; counting it would overstate how alive this is.
        .where("writingPost.isDraft", "=", false)
        .as("posts"),
    ])
    .where("blindDatePair.revealedAt", "is", null)
    .orderBy("blindDatePair.matchedAt", "asc")
    .execute();

  return rows.map((row, index) => ({
    number: index + 1,
    plotTitle: row.plotTitle,
    posts: Number(row.posts ?? 0),
    lastActivityAt: row.lastActivityAt,
  }));
}

export type ApplicationValues = {
  /** The offer taken up, where one was. A proactive application names its own plot and has none. */
  offerId: string | null;
  plotTitle: string;
  writingStyle: BlindDateWritingStyle;
  postLength: BlindDatePostLength;
  roleGender: string;
  pairing: string;
  note: string | null;
};

export type OwnApplication = ApplicationValues & {
  id: string;
  createdAt: string;
};

/** The member's own open application, which is the only one they may see or withdraw. */
async function selectOwnPendingApplication(
  userId: string,
): Promise<OwnApplication | undefined> {
  return await db
    .selectFrom("blindDateApplication")
    .select([
      "id",
      "offerId",
      "plotTitle",
      "writingStyle",
      "postLength",
      "roleGender",
      "pairing",
      "note",
      "createdAt",
    ])
    .where("userId", "=", userId)
    .where("status", "=", "pending")
    .executeTakeFirst();
}

export type ApplicationRefusal =
  | Ineligibility
  | "no_such_offer"
  | "offer_expired"
  | "role_not_offered";

/**
 * Applies, or says why not.
 *
 * The eligibility is checked here rather than trusted from a previous call: the form asks first so
 * it can explain itself, and a check that only ran there would be a check anybody could skip.
 */
async function apply(
  userId: string,
  values: ApplicationValues,
  now: Date = new Date(),
): Promise<ApplicationRefusal | undefined> {
  const { reason } = await eligibilityFor(userId, now);

  if (reason !== undefined) {
    return reason;
  }

  if (values.offerId !== null) {
    const offer = await db
      .selectFrom("blindDateOffer")
      .select(["id", "roles", "closesAt"])
      .where("id", "=", values.offerId)
      .where("closedAt", "is", null)
      .executeTakeFirst();

    // A closed offer answers the same as one that never existed: it is no longer on the page the
    // application was made from, and accepting it would put somebody in a round that has moved on.
    if (offer === undefined) {
      return "no_such_offer";
    }

    // The deadline, read here rather than trusted from the page: the page was rendered at some
    // point in the past, and a form left open across the deadline would still post.
    if (offer.closesAt !== null && new Date(offer.closesAt) <= now) {
      return "offer_expired";
    }

    // Where the team named the roles, the answer has to be one of them — that is the whole point
    // of naming them, and a request that skips the form could otherwise put anything in the field.
    if (offer.roles.length > 0 && !offer.roles.includes(values.roleGender)) {
      return "role_not_offered";
    }
  }

  await db
    .insertInto("blindDateApplication")
    .values({ userId, ...values })
    .execute();

  return undefined;
}

/**
 * Withdrawing is a status, not a delete — the team asked to keep every application, and somebody
 * who applied and thought better of it is part of what the queue says.
 */
async function withdraw(userId: string): Promise<"not_found" | undefined> {
  const withdrawn = await db
    .updateTable("blindDateApplication")
    .set({ status: "withdrawn", decidedAt: new Date().toISOString() })
    .where("userId", "=", userId)
    .where("status", "=", "pending")
    .returning("id")
    .executeTakeFirst();

  return withdrawn === undefined ? "not_found" : undefined;
}

/**
 * How many Blind-Dates this member has seen through.
 *
 * **Only ever shown to the member themselves.** On somebody else's profile it would be a score,
 * and a number beside a name is read as a ranking whatever the label says — which is the one thing
 * this platform has decided not to have. As their own, it is a record of what they did.
 *
 * Counted off the pair rather than off `is_active`, so it says „this Blind-Date is over" rather
 * than „this seat is free" — two facts that happen to coincide today and need not tomorrow.
 *
 * A pair the name guard ended does **not** count. That is the ritual failing rather than finishing,
 * and counting it would put a tick beside the one ending nobody wanted.
 */
async function countCompletedBlindDates(userId: string): Promise<number> {
  const row = await db
    .selectFrom("blindDatePartner")
    .innerJoin(
      "blindDatePair",
      "blindDatePair.id",
      "blindDatePartner.pairId",
    )
    .select((eb) => eb.fn.countAll<number>().as("completed"))
    .where("blindDatePartner.userId", "=", userId)
    .where((eb) =>
      eb.or([
        eb("blindDatePair.revealedAt", "is not", null),
        eb("blindDatePair.endedAt", "is not", null),
      ])
    )
    .where((eb) =>
      eb.or([
        eb("blindDatePair.endedReason", "is", null),
        eb("blindDatePair.endedReason", "!=", ENDED_BECAUSE_NAME_REVEALED),
      ])
    )
    .executeTakeFirst();

  return Number(row?.completed ?? 0);
}

export const BlindDateService = {
  eligibilityFor,
  listOpenOffers,
  selectOpenOffer,
  listActiveBlindDates,
  selectOwnPendingApplication,
  apply,
  withdraw,
  onlineTimeIsEnforced,
  countCompletedBlindDates,
};
