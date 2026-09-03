import { db } from "@/src/database/client.ts";

/**
 * How much time a member has actually spent here, recorded in fifteen-minute windows.
 *
 * The metric exists for one rule — Blind-Date asks for 1000 minutes in the last 30 days — and it
 * had to be built because nothing already stored could answer it: `user_session` carries a single
 * `updated_at` per session, so it says when somebody was last here and nothing about how long.
 *
 * **A window means "did something", not "had a tab open".** It is written the first time a request
 * of theirs lands inside it and never topped up, so an open browser earns nothing. That is the
 * right shape for a rule about taking part.
 *
 * **Deliberately coarse, and deliberately short-lived.** Fifteen minutes is too blunt to
 * reconstruct somebody's day from, and `deleteWindowsOlderThanRetention` throws away everything
 * past what the metric can ask about. Nothing exposes the individual windows over the API — only
 * the total — because "when is this person at their computer" is not a question this platform
 * should be able to answer about anybody.
 */

/** The same granularity the session refresh already works at, and the table's bound. */
const WINDOW_MINUTES = 15;

/** What the rule asks about. Anything older can go: no question here reaches past it. */
export const ACTIVITY_LOOKBACK_DAYS = 30;

/**
 * A few days more than the metric needs, so a clock skew or a late sweep cannot eat a window the
 * rule is still counting.
 */
const RETENTION_DAYS = ACTIVITY_LOOKBACK_DAYS + 2;

const MILLISECONDS_PER_MINUTE = 60_000;

/** The window an instant falls in, truncated down to a quarter of an hour. */
export function windowStartFor(at: Date): Date {
  const size = WINDOW_MINUTES * MILLISECONDS_PER_MINUTE;
  return new Date(Math.floor(at.getTime() / size) * size);
}

/**
 * The window each member was last written for, so a second request inside the same fifteen minutes
 * costs nothing at all rather than a wasted `ON CONFLICT DO NOTHING`.
 *
 * Being per-instance is not a correctness problem: the worst a cold instance does is write a row
 * that is already there, which the primary key absorbs. It is bounded by the number of members who
 * were active since this process started, and pruned on the same schedule as the table.
 */
const lastWritten = new Map<string, number>();

/**
 * Records that this member was here. Called from the session middleware, so it runs for every
 * signed-in request and for nothing else.
 */
async function recordActivity(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const windowStart = windowStartFor(now);

  if (lastWritten.get(userId) === windowStart.getTime()) {
    return;
  }

  await db
    .insertInto("activityWindow")
    .values({ userId, windowStart: windowStart.toISOString() })
    // The same window twice is the same fact. Writing it again is free rather than an error.
    .onConflict((conflict) =>
      conflict.columns(["userId", "windowStart"]).doNothing()
    )
    .execute();

  lastWritten.set(userId, windowStart.getTime());
}

/**
 * Minutes the member was active over the last `ACTIVITY_LOOKBACK_DAYS`.
 *
 * Counted windows times their length, which is an over-estimate for anybody who fired one request
 * and left. That is the honest direction to be wrong in for an entry condition: it errs towards
 * letting somebody in rather than towards keeping them out on a technicality.
 */
async function onlineMinutesInLast30Days(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(
    now.getTime() - ACTIVITY_LOOKBACK_DAYS * 24 * 60 * MILLISECONDS_PER_MINUTE,
  );

  const row = await db
    .selectFrom("activityWindow")
    .select((eb) => eb.fn.countAll<number>().as("windows"))
    .where("userId", "=", userId)
    .where("windowStart", ">=", since.toISOString())
    .executeTakeFirstOrThrow();

  return Number(row.windows) * WINDOW_MINUTES;
}

/** Swept nightly. What it deletes cannot be asked about any more, so nothing is lost. */
async function deleteWindowsOlderThanRetention(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - RETENTION_DAYS * 24 * 60 * MILLISECONDS_PER_MINUTE,
  );

  const deleted = await db
    .deleteFrom("activityWindow")
    .where("windowStart", "<", cutoff.toISOString())
    .executeTakeFirst();

  // The memo holds one number per member seen since start-up; a sweep is the natural moment to
  // let go of the ones who have not been back.
  const oldestKept = windowStartFor(cutoff).getTime();
  for (const [userId, written] of lastWritten) {
    if (written < oldestKept) {
      lastWritten.delete(userId);
    }
  }

  return Number(deleted.numDeletedRows ?? 0);
}

/** For tests, which need the memo not to answer for a member they have just cleared. */
function forgetRecordedActivity(): void {
  lastWritten.clear();
}

export const ActivityService = {
  recordActivity,
  onlineMinutesInLast30Days,
  deleteWindowsOlderThanRetention,
  forgetRecordedActivity,
};
