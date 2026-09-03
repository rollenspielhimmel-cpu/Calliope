import { assertEquals } from "@std/assert";
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
 * The direct chat between two people in a running Blind-Date is closed.
 *
 * They know each other only through the group, under pseudonyms, and a private message carries a
 * real name in its very first line — the invitation itself would end the Blind-Date before either
 * of them decided to.
 *
 * **The refusal has to stay neutral**, which is the half worth testing hardest. It sits beside the
 * block and the ban and answers in their words: „Contact is not possible". Saying *why* — "you are
 * in a Blind-Date together" — would name the partner outright, which is the one thing this whole
 * feature exists to hold back. A test that only checked the 403 would pass on a message that gives
 * the game away, so the body is asserted too.
 */

const alpha = "bdchat-alpha";
const beta = "bdchat-beta";
const outsider = "bdchat-outsider";

const USERS = [alpha, beta, outsider];

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  const ids = db.selectFrom("user").select("id").where("username", "in", USERS);

  const groups = (await db
    .selectFrom("blindDatePair")
    .innerJoin(
      "blindDatePartner",
      "blindDatePartner.pairId",
      "blindDatePair.id",
    )
    .select("blindDatePair.writingGroupId")
    .where("blindDatePartner.userId", "in", ids)
    .execute()).map((row) => row.writingGroupId);

  await db.deleteFrom("blindDatePartner").where("userId", "in", ids).execute();

  if (groups.length > 0) {
    await db.deleteFrom("blindDatePair").where("writingGroupId", "in", groups)
      .execute();
    await db.deleteFrom("writingThread").where("writingGroupId", "in", groups)
      .execute();
    await db.deleteFrom("userInWritingGroup").where(
      "writingGroupId",
      "in",
      groups,
    ).execute();
    await db.deleteFrom("writingGroup").where("id", "in", groups).execute();
  }

  await db.deleteFrom("userInChatGroup").where("userId", "in", ids).execute();
  await db
    .deleteFrom("chatGroup")
    .where("title", "in", [CHAT_TITLE])
    .execute();

  await deleteUsers(USERS);
});

const CHAT_TITLE = "bdchat Testchat";

/**
 * Two members in a Blind-Date, written straight in: the matching route is tested next door, and
 * what is under test here is only the pair existing.
 */
async function aBlindDateBetween(first: string, second: string) {
  const group = await db
    .insertInto("writingGroup")
    .values({
      title: "bdchat Handlung",
      synopsis: "x",
      visibility: "private",
      authorsArePseudonymous: true,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const pair = await db
    .insertInto("blindDatePair")
    .values({ writingGroupId: group.id })
    .returning("id")
    .executeTakeFirstOrThrow();

  // The ids first, then one insert: the `await` inside the values was a second one inside the
  // loop, which is what the lint rule is there to catch.
  const userIds = await Promise.all([first, second].map(getUserId));

  await db
    .insertInto("blindDatePartner")
    .values(userIds.map((userId) => ({ pairId: pair.id, userId })))
    .execute();

  return { pairId: pair.id, writingGroupId: group.id };
}

/** A chat owned by `cookie`, and the attempt to invite `username` into it. */
async function inviteInto(cookie: string, username: string) {
  const chat = await (await request("POST", "/api/chats", cookie, {
    title: CHAT_TITLE,
  })).json();

  return await request(
    "POST",
    `/api/chats/${chat.id}/memberships`,
    cookie,
    { userId: await getUserId(username) },
  );
}

Deno.test("the two in a Blind-Date cannot invite each other to a chat", async () => {
  const alphaCookie = await registerUser(alpha);
  await registerUser(beta);
  await aBlindDateBetween(alpha, beta);

  const refused = await inviteInto(alphaCookie, beta);

  assertEquals(refused.status, STATUS_CODE.Forbidden);
});

Deno.test("the refusal does not say why, because saying why would name the partner", async () => {
  const alphaCookie = await registerUser(alpha);
  await registerUser(beta);
  await aBlindDateBetween(alpha, beta);

  const body = await (await inviteInto(alphaCookie, beta)).json();

  // The same words a block and a ban answer with, and deliberately so.
  assertEquals(body.error, "Contact is not possible");

  const said = JSON.stringify(body).toLowerCase();
  for (const giveaway of ["blind", "date", "partner", "pseudonym", beta]) {
    assertEquals(
      said.includes(giveaway.toLowerCase()),
      false,
      `the refusal mentioned "${giveaway}", which would give the partner away`,
    );
  }
});

Deno.test("it is closed in both directions", async () => {
  await registerUser(alpha);
  const betaCookie = await registerUser(beta);
  await aBlindDateBetween(alpha, beta);

  // The pair is what is blocked, not a direction: whoever asks first gets the same answer.
  assertEquals(
    (await inviteInto(betaCookie, alpha)).status,
    STATUS_CODE.Forbidden,
  );
});

Deno.test("everybody else is unaffected, including each of them separately", async () => {
  const alphaCookie = await registerUser(alpha);
  await registerUser(beta);
  await registerUser(outsider);
  await aBlindDateBetween(alpha, beta);

  // Being in a Blind-Date closes one door, not every door.
  assertEquals(
    (await inviteInto(alphaCookie, outsider)).status,
    STATUS_CODE.Created,
  );
});

Deno.test("the chat opens again once they have revealed", async () => {
  const alphaCookie = await registerUser(alpha);
  await registerUser(beta);
  const { pairId } = await aBlindDateBetween(alpha, beta);

  assertEquals(
    (await inviteInto(alphaCookie, beta)).status,
    STATUS_CODE.Forbidden,
  );

  // What the reveal does: the pair is done and both seats are freed. From then on they are two
  // people who know who the other is, and there is nothing left to protect.
  await db
    .updateTable("blindDatePartner")
    .set({ isActive: false })
    .where("pairId", "=", pairId)
    .execute();
  await db
    .updateTable("blindDatePair")
    .set({ revealedAt: new Date().toISOString() })
    .where("id", "=", pairId)
    .execute();

  assertEquals(
    (await inviteInto(alphaCookie, beta)).status,
    STATUS_CODE.Created,
  );
});
