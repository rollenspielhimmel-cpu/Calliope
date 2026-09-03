import { db } from "@/src/database/client.ts";
import { mayModeratePlatform } from "@/src/service/platform_authorization.ts";
import type { StrikeAction, StrikeSeverity } from "@/src/database/schema.ts";

/**
 * The ladder from the platform rules: warning, warning, then 24, 48 and 72 hours. The service
 * *suggests* the next rung and never enforces it — how heavily an incident weighs is a human
 * judgement, and a severe one may be answered with a suspension straight away, or skip the
 * ladder entirely. `suggestNextAction` fills a form in; it does not decide anything.
 *
 * A suspension is deliberately not a ban: `ban_service.ts` holds the name and the address for
 * good, this lapses on its own and says so to the member it is about.
 */

/** Hours for the first, second and third strike. Past the third, the third's length again. */
const SUSPENSION_HOURS = [24, 48, 72] as const;

/** What a fourth incident and beyond is suggested: the last rung again, never less. */
const LAST_RUNG_HOURS: number = 72;

/** The same refusals a ban can give, for the same reasons — see `BanService.banUser`. */
export type StrikeRefusal = "not_found" | "is_an_operator";

export type SuggestedAction = {
  priorWarnings: number;
  priorSuspensions: number;
  action: StrikeAction;
  /** Only set where `action` is "suspension". */
  suggestedHours: number | null;
  /**
   * True once the ladder has been walked to its end. The interface says so; nothing here acts on
   * it, because deleting an account is a separate decision taken through its own route.
   */
  ladderExhausted: boolean;
};

/**
 * Counts what was decided before and names the next rung. Deliberately returns numbers rather
 * than a sentence: what an operator reads is German and belongs in the interface, the way every
 * other label in this project does.
 */
async function suggestNextAction(userId: string): Promise<SuggestedAction> {
  const history = await db
    .selectFrom("strike")
    .select("action")
    .where("userId", "=", userId)
    .execute();

  const priorWarnings =
    history.filter((row) => row.action === "warning").length;
  const priorSuspensions =
    history.filter((row) => row.action === "suspension").length;

  if (priorWarnings < 2) {
    return {
      priorWarnings,
      priorSuspensions,
      action: "warning",
      suggestedHours: null,
      ladderExhausted: false,
    };
  }

  const strikeNumber = priorSuspensions + 1;

  return {
    priorWarnings,
    priorSuspensions,
    action: "suspension",
    suggestedHours: SUSPENSION_HOURS[strikeNumber - 1] ?? LAST_RUNG_HOURS,
    ladderExhausted: strikeNumber > SUSPENSION_HOURS.length,
  };
}

/**
 * Where a member stands on the ladder right now, for the overview that groups them by it.
 *
 * This is the counterpart of `suggestNextAction`, which names the *next* rung; this one names the
 * rung already reached. Both read the same two counts, so they cannot disagree about what happened
 * — only about which direction they are looking.
 *
 * The rung itself is left as two numbers rather than a token. Which section a member is filed
 * under is a question the interface answers, in German, like every other label in this project;
 * inventing `"warning_2"` here would put half a sentence in the API and the other half in a Vue
 * file, where the two would drift.
 */
export type LadderStanding = {
  id: string;
  username: string;
  warnings: number;
  suspensions: number;
  /** Set only while a suspension is still running — the parenthetical in „1. Strike (gesperrt)". */
  suspendedUntil: string | null;
  suspensionReason: string | null;
  /** Whether the account is banned outright, which outranks every rung. */
  bannedAt: string | null;
  lastStrikeAt: string;
  /** The two lists are read together, so the overview can say who is on both. */
  watchlistNote: string | null;
};

/**
 * Everyone with at least one strike, worst first.
 *
 * Members with a clean record are absent rather than listed as "0 Verwarnungen": the page is the
 * ladder, and a community's whole membership under a heading about strikes would read as an
 * accusation of everybody.
 */
async function listLadder(): Promise<LadderStanding[]> {
  const rows = await db
    .selectFrom("strike")
    .innerJoin("user", "user.id", "strike.userId")
    .leftJoin("watchlistEntry", "watchlistEntry.userId", "strike.userId")
    .select((eb) => [
      "user.id",
      "user.username",
      "user.suspendedUntil",
      "user.suspensionReason",
      "user.bannedAt",
      "watchlistEntry.note as watchlistNote",
      eb.fn
        .count<number>("strike.id")
        .filterWhere("strike.action", "=", "warning")
        .as("warnings"),
      eb.fn
        .count<number>("strike.id")
        .filterWhere("strike.action", "=", "suspension")
        .as("suspensions"),
      eb.fn.max("strike.issuedAt").as("lastStrikeAt"),
    ])
    .groupBy([
      "user.id",
      "user.username",
      "user.suspendedUntil",
      "user.suspensionReason",
      "user.bannedAt",
      "watchlistEntry.note",
    ])
    .execute();

  const now = Date.now();

  return rows
    .map((row) => ({
      id: row.id,
      username: row.username,
      warnings: Number(row.warnings),
      suspensions: Number(row.suspensions),
      // A suspension that has run its course is not a current one. The column keeps the date
      // either way — it lapses on its own rather than being cleared — so the comparison is here.
      suspendedUntil:
        row.suspendedUntil !== null && Date.parse(row.suspendedUntil) > now
          ? row.suspendedUntil
          : null,
      suspensionReason:
        row.suspendedUntil !== null && Date.parse(row.suspendedUntil) > now
          ? row.suspensionReason
          : null,
      bannedAt: row.bannedAt,
      lastStrikeAt: row.lastStrikeAt as string,
      watchlistNote: row.watchlistNote,
    }))
    // Worst first, and the most recent of equals first: whoever opens this page is looking for
    // who is furthest along, not for an alphabet.
    .sort((a, b) =>
      b.suspensions - a.suspensions ||
      b.warnings - a.warnings ||
      Date.parse(b.lastStrikeAt) - Date.parse(a.lastStrikeAt)
    );
}

/**
 * An operator cannot be given a strike, the same rule and for the same reason as a ban: demoting
 * first is an administrator's act, so removing an operator takes two deliberate steps.
 */
async function refuseTarget(
  userId: string,
): Promise<StrikeRefusal | undefined> {
  const target = await db
    .selectFrom("user")
    .select(["id", "platformRole"])
    .where("id", "=", userId)
    .executeTakeFirst();

  if (target === undefined) {
    return "not_found";
  }

  return mayModeratePlatform(target.platformRole)
    ? "is_an_operator"
    : undefined;
}

async function issueWarning(
  userId: string,
  severity: StrikeSeverity,
  reason: string,
  issuedBy: string,
): Promise<StrikeRefusal | undefined> {
  const refusal = await refuseTarget(userId);

  if (refusal !== undefined) {
    return refusal;
  }

  await db
    .insertInto("strike")
    .values({ userId, severity, action: "warning", reason, issuedBy })
    .execute();

  return undefined;
}

/** Unlike a warning, a suspension is enforced as it is recorded: one transaction, both rows. */
async function issueSuspension(
  userId: string,
  severity: StrikeSeverity,
  reason: string,
  hours: number,
  issuedBy: string,
): Promise<{ suspendedUntil: string } | StrikeRefusal> {
  const refusal = await refuseTarget(userId);

  if (refusal !== undefined) {
    return refusal;
  }

  const suspendedUntil = Temporal.Now.instant().add({ hours }).toString();

  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("strike")
      .values({
        userId,
        severity,
        action: "suspension",
        reason,
        suspendedUntil,
        issuedBy,
      })
      .execute();

    // The reason is deliberately kept on `user` as well as in the history: the sign-in check
    // reads that one row and must not have to walk the history to say why.
    await transaction
      .updateTable("user")
      .set({ suspendedUntil, suspensionReason: reason })
      .where("id", "=", userId)
      .execute();

    // A suspended member left signed in would otherwise keep writing until the cookie expires,
    // which is what the ban's own transaction ends its sessions for.
    await transaction
      .deleteFrom("userSession")
      .where("userId", "=", userId)
      .execute();
  });

  return { suspendedUntil };
}

/**
 * Lifts a suspension before it lapses. The history keeps the entry that imposed it: what was
 * decided happened, whatever was decided afterwards.
 */
async function liftSuspension(
  userId: string,
): Promise<"not_found" | undefined> {
  const lifted = await db
    .updateTable("user")
    .set({ suspendedUntil: null, suspensionReason: null })
    .where("id", "=", userId)
    .where("suspendedUntil", "is not", null)
    .returning("id")
    .executeTakeFirst();

  return lifted === undefined ? "not_found" : undefined;
}

export type StrikeHistoryEntry = {
  id: string;
  severity: StrikeSeverity;
  action: StrikeAction;
  reason: string;
  suspendedUntil: string | null;
  issuedBy: { id: string; username: string } | null;
  issuedAt: string;
};

async function listHistory(userId: string): Promise<StrikeHistoryEntry[]> {
  const rows = await db
    .selectFrom("strike")
    .leftJoin("user", "user.id", "strike.issuedBy")
    .select([
      "strike.id",
      "strike.severity",
      "strike.action",
      "strike.reason",
      "strike.suspendedUntil",
      "strike.issuedAt",
      "user.id as issuedById",
      "user.username as issuedByUsername",
    ])
    .where("strike.userId", "=", userId)
    .orderBy("strike.issuedAt", "desc")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    severity: row.severity,
    action: row.action,
    reason: row.reason,
    suspendedUntil: row.suspendedUntil,
    issuedBy: row.issuedById === null || row.issuedByUsername === null
      ? null
      : { id: row.issuedById, username: row.issuedByUsername },
    issuedAt: row.issuedAt,
  }));
}

export const StrikeService = {
  suggestNextAction,
  listLadder,
  issueWarning,
  issueSuspension,
  liftSuspension,
  listHistory,
};
