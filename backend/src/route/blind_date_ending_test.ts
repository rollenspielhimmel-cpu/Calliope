import { assert, assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * Leaving a Blind-Date, and the three questions afterwards.
 *
 * Two things here are worth a test on their own. **Either of them may leave, alone** — the reveal
 * needs both, and a way out that needed both would depend on the person one is trying to get away
 * from. And **the form asks once**: „nein danke" is recorded as a row so the page stops asking,
 * which is the one thing a voluntary form must be able to do.
 */

const leaver = "bdend-leaver";
const left = "bdend-left";

const USERS = [leaver, left];

const PLOT = "Der letzte Zug";

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  const ids = db.selectFrom("user").select("id").where("username", "in", USERS);

  const groupIds = (await db
    .selectFrom("blindDatePair")
    .innerJoin(
      "blindDatePartner",
      "blindDatePartner.pairId",
      "blindDatePair.id",
    )
    .select("blindDatePair.writingGroupId")
    .where("blindDatePartner.userId", "in", ids)
    .execute()).map((row) => row.writingGroupId);

  await db.deleteFrom("blindDateFeedback").where("userId", "in", ids).execute();
  await db.deleteFrom("blindDatePartner").where("userId", "in", ids).execute();
  await db.deleteFrom("notification").where("recipientId", "in", ids).execute();

  if (groupIds.length > 0) {
    await db.deleteFrom("blindDatePair").where("writingGroupId", "in", groupIds)
      .execute();
    await db.deleteFrom("userInWritingGroup").where(
      "writingGroupId",
      "in",
      groupIds,
    ).execute();
    await db.deleteFrom("writingGroup").where("id", "in", groupIds).execute();
  }

  await deleteUsers(USERS);
});

/** A running pair with both of them in it. */
async function aRunningPair(): Promise<string> {
  const group = await db
    .insertInto("writingGroup")
    .values({ title: PLOT, synopsis: "x", visibility: "private" })
    .returning("id")
    .executeTakeFirstOrThrow();

  const pair = await db
    .insertInto("blindDatePair")
    .values({ writingGroupId: group.id })
    .returning("id")
    .executeTakeFirstOrThrow();

  for (const username of USERS) {
    const userId = await getUserId(username);

    await db
      .insertInto("blindDatePartner")
      .values({ pairId: pair.id, userId })
      .execute();

    // The group membership too, which a real match makes. Not decoration: `notification` carries a
    // composite foreign key onto `user_in_writing_group`, so a member who is not in the group
    // cannot be told anything about it — leaving this out made the ending fail at the notification
    // with a foreign-key violation, which is the constraint doing its job on a fixture that was
    // not a real Blind-Date.
    await db
      .insertInto("userInWritingGroup")
      .values({
        writingGroupId: group.id,
        userId,
        role: "administrator",
        status: "joined",
      })
      .execute();
  }

  return pair.id;
}

const endMine = (cookie: string) =>
  request("DELETE", "/api/blind-date/mine", cookie);

const pendingFeedback = (cookie: string) =>
  request("GET", "/api/blind-date/feedback/pending", cookie);

const sendFeedback = (cookie: string, body: Record<string, unknown>) =>
  request("POST", "/api/blind-date/feedback", cookie, body);

Deno.test("one of the two ends it, alone, and both seats are freed", async () => {
  const leaverCookie = await registerUser(leaver);
  const leftCookie = await registerUser(left);
  const pairId = await aRunningPair();

  assertEquals((await endMine(leaverCookie)).status, STATUS_CODE.OK);

  const pair = await db
    .selectFrom("blindDatePair")
    .select(["endedAt", "endedReason", "endedBy", "revealedAt"])
    .where("id", "=", pairId)
    .executeTakeFirstOrThrow();

  assert(pair.endedAt !== null, "the pair should have ended");
  assertEquals(pair.endedReason, "ended_by_partner");
  assertEquals(pair.endedBy, await getUserId(leaver));
  // Ending and revealing are the two ways a pair stops, and never both.
  assertEquals(pair.revealedAt, null);

  const seats = await db
    .selectFrom("blindDatePartner")
    .select("isActive")
    .where("pairId", "=", pairId)
    .execute();

  assertEquals(seats.map((seat) => seat.isActive), [false, false]);

  // Nothing is deleted: the group and everything in it stay, which is the promise the guard's
  // ending makes too.
  const group = await db
    .selectFrom("writingGroup")
    .select("title")
    .where(
      "id",
      "=",
      (await db
        .selectFrom("blindDatePair")
        .select("writingGroupId")
        .where("id", "=", pairId)
        .executeTakeFirstOrThrow()).writingGroupId,
    )
    .executeTakeFirst();

  assertEquals(group?.title, PLOT);

  // The one who was left is told that it ended. No actor and no reason — see the notification's
  // own comment.
  const told = await db
    .selectFrom("notification")
    .select(["type", "actorId"])
    .where("recipientId", "=", await getUserId(left))
    .executeTakeFirst();

  assertEquals(told?.type, "blind_date_ended");
  assertEquals(told?.actorId, null);

  // And it is over for the other one as well, who has nothing left to end.
  assertEquals((await endMine(leftCookie)).status, STATUS_CODE.NotFound);
});

Deno.test("ending needs a Blind-Date to end", async () => {
  const cookie = await registerUser(leaver);

  assertEquals((await endMine(cookie)).status, STATUS_CODE.NotFound);
});

Deno.test("both are asked afterwards, and each answers only for themselves", async () => {
  const leaverCookie = await registerUser(leaver);
  const leftCookie = await registerUser(left);
  const pairId = await aRunningPair();

  // Nothing to ask about while it is still running.
  assertEquals(
    (await pendingFeedback(leaverCookie)).status,
    STATUS_CODE.NotFound,
  );

  await endMine(leaverCookie);

  for (const cookie of [leaverCookie, leftCookie]) {
    const invitation = await (await pendingFeedback(cookie)).json();
    assertEquals(invitation.pairId, pairId);
    assertEquals(invitation.plotTitle, PLOT);
    // Both of them are asked about an ending, not a reveal.
    assertEquals(invitation.wasRevealed, false);
  }

  assertEquals(
    (await sendFeedback(leaverCookie, {
      pairId,
      worked: "partly",
      again: "yes",
      note: "Der Anfang war zäh, danach lief es.",
    })).status,
    STATUS_CODE.OK,
  );

  // Answered, so no longer asked — and the other one still is.
  assertEquals(
    (await pendingFeedback(leaverCookie)).status,
    STATUS_CODE.NotFound,
  );
  assertEquals((await pendingFeedback(leftCookie)).status, STATUS_CODE.OK);

  // And nobody answers twice about the same one.
  assertEquals(
    (await sendFeedback(leaverCookie, { pairId, worked: "no", again: "no" }))
      .status,
    STATUS_CODE.Conflict,
  );
});

Deno.test("declining is an answer, and the page stops asking", async () => {
  const cookie = await registerUser(leaver);
  await registerUser(left);
  const pairId = await aRunningPair();

  await endMine(cookie);

  // Neither answer: „nein danke". The one thing a voluntary form has to be able to do.
  assertEquals((await sendFeedback(cookie, { pairId })).status, STATUS_CODE.OK);
  assertEquals((await pendingFeedback(cookie)).status, STATUS_CODE.NotFound);

  const row = await db
    .selectFrom("blindDateFeedback")
    .select(["worked", "again", "note"])
    .where("userId", "=", await getUserId(leaver))
    .executeTakeFirstOrThrow();

  assertEquals(row.worked, null);
  assertEquals(row.again, null);
  assertEquals(row.note, null);
});

Deno.test("half an answer is refused, and so is a note without one", async () => {
  const cookie = await registerUser(leaver);
  await registerUser(left);
  const pairId = await aRunningPair();

  await endMine(cookie);

  assertEquals(
    (await sendFeedback(cookie, { pairId, worked: "yes" })).status,
    STATUS_CODE.BadRequest,
  );

  // A remark with the two answers left blank would be an answer in disguise.
  assertEquals(
    (await sendFeedback(cookie, { pairId, note: "Ging so." })).status,
    STATUS_CODE.BadRequest,
  );
});

Deno.test("nobody answers about a Blind-Date they were not in", async () => {
  const cookie = await registerUser(leaver);
  const otherCookie = await registerUser(left);
  const pairId = await aRunningPair();

  await endMine(cookie);

  const stranger = "bdend-stranger";
  USERS.push(stranger);
  const strangerCookie = await registerUser(stranger);

  assertEquals(
    (await sendFeedback(strangerCookie, {
      pairId,
      worked: "yes",
      again: "yes",
    }))
      .status,
    STATUS_CODE.NotFound,
  );

  // The two who were in it still may.
  assertEquals(
    (await sendFeedback(otherCookie, { pairId, worked: "yes", again: "yes" }))
      .status,
    STATUS_CODE.OK,
  );
});
