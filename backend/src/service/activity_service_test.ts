import { assertEquals } from "@std/assert";
import { db } from "@/src/database/client.ts";
import {
  ActivityService,
  windowStartFor,
} from "@/src/service/activity_service.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * The metric behind „1000 Online-Minuten der letzten 30 Tage".
 *
 * Every test hands the clock in rather than waiting for it, which is the only way to say anything
 * about a thirty-day window. The two that matter most are the boundary ones: a window that has
 * just fallen out of the thirty days must stop counting, and the sweep must not take one that is
 * still inside it — a retention that ate live data would quietly lock people out of the feature
 * this exists for.
 */

const member = "activity-member";
const other = "activity-other";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

Deno.test.beforeEach(async () => {
  ActivityService.forgetRecordedActivity();
  await clearRateLimits();
});

Deno.test.afterEach(async () => {
  await deleteUsers([member, other]);
  ActivityService.forgetRecordedActivity();
});

/** Windows written straight in, so a test can place them anywhere in the past. */
async function seen(username: string, ...at: Date[]) {
  const userId = await getUserId(username);

  for (const instant of at) {
    // deno-lint-ignore no-await-in-loop -- a handful per test, and the order does not matter
    await db
      .insertInto("activityWindow")
      .values({
        userId,
        windowStart: windowStartFor(instant).toISOString(),
      })
      .onConflict((conflict) =>
        conflict.columns(["userId", "windowStart"]).doNothing()
      )
      .execute();
  }
}

Deno.test("a member who has never been here has no minutes", async () => {
  await registerUser(member);

  assertEquals(
    await ActivityService.onlineMinutesInLast30Days(await getUserId(member)),
    0,
  );
});

Deno.test("each window counts as its fifteen minutes", async () => {
  await registerUser(member);
  const now = new Date("2026-09-02T12:00:00Z");

  await seen(
    member,
    new Date(now.getTime() - 60 * MINUTE),
    new Date(now.getTime() - 45 * MINUTE),
    new Date(now.getTime() - 30 * MINUTE),
    new Date(now.getTime() - 15 * MINUTE),
  );

  assertEquals(
    await ActivityService.onlineMinutesInLast30Days(
      await getUserId(member),
      now,
    ),
    60,
  );
});

Deno.test("two requests inside one window are one window", async () => {
  await registerUser(member);
  const now = new Date("2026-09-02T12:00:00Z");

  // Four minutes apart, so both fall in the same quarter of an hour.
  await seen(
    member,
    new Date(now.getTime() - 20 * MINUTE),
    new Date(now.getTime() - 16 * MINUTE),
  );

  assertEquals(
    await ActivityService.onlineMinutesInLast30Days(
      await getUserId(member),
      now,
    ),
    15,
  );
});

Deno.test("a window older than thirty days stops counting", async () => {
  await registerUser(member);
  const now = new Date("2026-09-02T12:00:00Z");

  await seen(
    member,
    // Just inside, and just outside.
    new Date(now.getTime() - 29 * DAY),
    new Date(now.getTime() - 31 * DAY),
  );

  assertEquals(
    await ActivityService.onlineMinutesInLast30Days(
      await getUserId(member),
      now,
    ),
    15,
  );
});

Deno.test("one member's minutes are not another's", async () => {
  await registerUser(member);
  await registerUser(other);
  const now = new Date("2026-09-02T12:00:00Z");

  await seen(other, new Date(now.getTime() - 30 * MINUTE));

  assertEquals(
    await ActivityService.onlineMinutesInLast30Days(
      await getUserId(member),
      now,
    ),
    0,
  );
});

Deno.test("recording twice in a window writes one row, and the memo does not lie across members", async () => {
  await registerUser(member);
  await registerUser(other);

  const memberId = await getUserId(member);
  const otherId = await getUserId(other);
  const now = new Date("2026-09-02T12:00:00Z");

  await ActivityService.recordActivity(memberId, now);
  await ActivityService.recordActivity(
    memberId,
    new Date(now.getTime() + MINUTE),
  );
  await ActivityService.recordActivity(otherId, now);

  assertEquals(
    await ActivityService.onlineMinutesInLast30Days(memberId, now),
    15,
  );
  // The memo is keyed per member: the second one's window must still be written.
  assertEquals(
    await ActivityService.onlineMinutesInLast30Days(otherId, now),
    15,
  );
});

Deno.test("the sweep takes what is past retention and leaves what the rule still counts", async () => {
  await registerUser(member);

  const now = new Date("2026-09-02T12:00:00Z");
  const memberId = await getUserId(member);

  await seen(
    member,
    new Date(now.getTime() - 1 * DAY),
    new Date(now.getTime() - 29 * DAY),
    // Past thirty days but inside the two-day margin: still swept out, already uncounted.
    new Date(now.getTime() - 40 * DAY),
  );

  const deleted = await ActivityService.deleteWindowsOlderThanRetention(now);

  assertEquals(deleted, 1);
  // The two the rule can still ask about are untouched.
  assertEquals(
    await ActivityService.onlineMinutesInLast30Days(memberId, now),
    30,
  );
});

Deno.test("the sweep keeps a window inside the retention margin", async () => {
  await registerUser(member);
  const now = new Date("2026-09-02T12:00:00Z");

  // 31 days: out of the metric's reach, inside the margin. A sweep that took this would be
  // deleting live data on any clock skew, which is the whole reason the margin exists.
  await seen(member, new Date(now.getTime() - 31 * DAY));

  assertEquals(await ActivityService.deleteWindowsOlderThanRetention(now), 0);
});

Deno.test("an ordinary signed-in request records a window", async () => {
  const cookie = await registerUser(member);
  const memberId = await getUserId(member);

  // Whatever the registration itself wrote, cleared: the point is the request below.
  await db.deleteFrom("activityWindow").where("userId", "=", memberId)
    .execute();
  ActivityService.forgetRecordedActivity();

  assertEquals(await ActivityService.onlineMinutesInLast30Days(memberId), 0);

  // Any authenticated route. The recording hangs off `resolveSessionUser`, which every one of
  // them goes through — if that wiring is ever removed, this is what says so.
  await request("GET", "/api/auth/me", cookie);

  assertEquals(await ActivityService.onlineMinutesInLast30Days(memberId), 15);
});
