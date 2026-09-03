import { assert, assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import { plainTextToDocument } from "@/src/document/document_text.ts";
import { POSTS_BEFORE_REVEAL } from "@/src/service/blind_date_reveal_service.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  postBody,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * The reveal — the moment the whole ritual is aimed at.
 *
 * Three promises are checked here, and each of them is the feature failing if it stops holding:
 *
 * 1. **Both, or neither.** One yes changes nothing anybody can see.
 * 2. **Nothing is migrated.** The same group, the same posts, the same rows — read under real
 *    names from the second yes onwards. The test writes a post *before* the reveal and finds it
 *    afterwards, by the same id, now signed.
 * 3. **It does not publish anything.** The group stays private. Whether the writing goes public is
 *    the pair's own decision, taken the ordinary way.
 */

const alpha = "reveal-alpha";
const beta = "reveal-beta";
const operator = "reveal-operator";

const USERS = [alpha, beta, operator];

const PLOT = "Reveal-Test-Handlung";

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  const ids = db.selectFrom("user").select("id").where("username", "in", USERS);

  const groupIds = (await db
    .selectFrom("writingGroup")
    .select("id")
    .where("title", "=", PLOT)
    .execute()).map((row) => row.id);

  await db.deleteFrom("notification").where("recipientId", "in", ids).execute();
  await db.deleteFrom("blindDatePartner").where("userId", "in", ids).execute();

  if (groupIds.length > 0) {
    await db.deleteFrom("blindDatePair").where("writingGroupId", "in", groupIds)
      .execute();
    await db.deleteFrom("writingPost").where(
      "writingThreadId",
      "in",
      db.selectFrom("writingThread").select("id").where(
        "writingGroupId",
        "in",
        groupIds,
      ),
    ).execute();
    await db.deleteFrom("writingThread").where("writingGroupId", "in", groupIds)
      .execute();
    await db.deleteFrom("userInWritingGroup").where(
      "writingGroupId",
      "in",
      groupIds,
    ).execute();
    await db.deleteFrom("writingGroup").where("id", "in", groupIds).execute();
  }

  await db.deleteFrom("blindDateApplication").where("userId", "in", ids)
    .execute();
  await deleteUsers(USERS);
});

const APPLICATION = {
  plotTitle: PLOT,
  writingStyle: "prose",
  postLength: "medium",
  roleGender: "egal",
  pairing: "offen",
} as const;

/** A matched Blind-Date with a post from each side, through the ordinary endpoints. */
/**
 * Writes the RPG thread up to the threshold, alternating authors.
 *
 * Two short of it, so the two posts the fixture then writes through the API carry it over —
 * which keeps those doing their real job (proving nothing is migrated by the reveal) while
 * also being the ones that open the button.
 */
async function fillRpgThread(
  threadId: string,
  firstAuthor: string,
  secondAuthor: string,
) {
  const filler = Array.from(
    { length: POSTS_BEFORE_REVEAL - 2 },
    (_, index) => ({
      writingThreadId: threadId,
      createdBy: index % 2 === 0 ? firstAuthor : secondAuthor,
      document: plainTextToDocument(`Absatz ${index + 1}`),
      text: `Absatz ${index + 1}`,
      isDraft: false,
    }),
  );

  await db.insertInto("writingPost").values(filler).execute();
}

async function aMatchedBlindDate() {
  const alphaCookie = await registerUser(alpha);
  const betaCookie = await registerUser(beta);
  const operatorCookie = await registerUser(operator);

  await db
    .updateTable("user")
    .set({ platformRole: "moderator" })
    .where("username", "=", operator)
    .execute();

  for (const cookie of [alphaCookie, betaCookie]) {
    // deno-lint-ignore no-await-in-loop -- one application each
    await request("POST", "/api/blind-date/applications", cookie, APPLICATION);
  }

  const applications = await db
    .selectFrom("blindDateApplication")
    .innerJoin("user", "user.id", "blindDateApplication.userId")
    .select(["blindDateApplication.id", "user.username"])
    .where("user.username", "in", [alpha, beta])
    .where("blindDateApplication.status", "=", "pending")
    .execute();

  await request("POST", "/api/moderation/blind-date/matches", operatorCookie, {
    firstApplicationId: applications[0]?.id,
    secondApplicationId: applications[1]?.id,
    plotTitle: PLOT,
    synopsis: "Zwei, die einander nicht kennen.",
  });

  const group = await db
    .selectFrom("writingGroup")
    .select("id")
    .where("title", "=", PLOT)
    .executeTakeFirstOrThrow();

  // The RPG thread by id, not the first of the four: the group now starts with two profile
  // threads and an exchange thread as well, and it is only this one the reveal counts.
  const pair = await db
    .selectFrom("blindDatePair")
    .select("rpgThreadId")
    .where("writingGroupId", "=", group.id)
    .executeTakeFirstOrThrow();

  const thread = { id: pair.rpgThreadId as string };

  // Enough written together to be allowed to ask. Filled straight in rather than through the
  // API: fifty round trips would make every test in this file a minute long, and what is under
  // test here is the reveal, not posting.
  await fillRpgThread(thread.id, await getUserId(alpha), await getUserId(beta));

  // A post from each side, written while both are still anonymous.
  for (const cookie of [alphaCookie, betaCookie]) {
    // deno-lint-ignore no-await-in-loop -- one post each, in order
    await request(
      "POST",
      `/api/groups/${group.id}/threads/${thread.id}/posts`,
      cookie,
      postBody("Ein Absatz aus der anonymen Zeit."),
    );
  }

  return { alphaCookie, betaCookie, groupId: group.id, threadId: thread.id };
}

const mine = (cookie: string) => request("GET", "/api/blind-date/mine", cookie);
const agree = (cookie: string) =>
  request("PUT", "/api/blind-date/reveal", cookie);
const takeBack = (cookie: string) =>
  request("DELETE", "/api/blind-date/reveal", cookie);

const posts = (
  cookie: string,
  groupId: string,
  threadId: string,
  body: Record<string, unknown> = {},
) =>
  request("QUERY", `/api/groups/${groupId}/threads/${threadId}/posts`, cookie, {
    limit: 20,
    offset: 0,
    sortAttribute: "createdAt",
    sortOrder: "asc",
    ...body,
  });

Deno.test("one yes changes nothing anybody can see", async () => {
  const { alphaCookie, betaCookie, groupId, threadId } =
    await aMatchedBlindDate();

  assertEquals((await agree(alphaCookie)).status, STATUS_CODE.OK);
  assertEquals(
    (await (await agree(alphaCookie)).json()).outcome,
    "waiting",
    "pressing twice must not stand in for the other",
  );

  // Beta sees that somebody is waiting on them, and still no name.
  const betaView = await (await mine(betaCookie)).json();
  assertEquals(betaView.iAgreed, false);
  assertEquals(betaView.otherAgreed, true);

  const stillHidden = await (await posts(betaCookie, groupId, threadId)).json();
  assert(
    stillHidden.results.every((post: { createdByUsername: string }) =>
      post.createdByUsername.startsWith("Blind-Date-Partner")
    ),
  );
});

Deno.test("the second yes reveals, and nothing was migrated to do it", async () => {
  const { alphaCookie, betaCookie, groupId, threadId } =
    await aMatchedBlindDate();

  // The last page of the thread, which is where the two posts written through the API are. The
  // rest is filler that got the pair over the threshold; what this test is about is that specific
  // rows survive the reveal untouched, not how many there are.
  const before = await (await posts(alphaCookie, groupId, threadId, {
    limit: 2,
    offset: POSTS_BEFORE_REVEAL - 2,
    sortAttribute: "createdAt",
    sortOrder: "asc",
  })).json();

  const idsBefore = before.results.map((post: { id: string }) => post.id);
  assertEquals(idsBefore.length, 2);

  // Still anonymous at this point, which is what makes the comparison afterwards mean something.
  assert(
    before.results.every((post: { createdByUsername: string }) =>
      post.createdByUsername.startsWith("Blind-Date-Partner")
    ),
  );

  await agree(alphaCookie);
  assertEquals((await (await agree(betaCookie)).json()).outcome, "revealed");

  const after = await (await posts(alphaCookie, groupId, threadId, {
    limit: 2,
    offset: POSTS_BEFORE_REVEAL - 2,
    sortAttribute: "createdAt",
    sortOrder: "asc",
  })).json();

  // The same rows, by id. Nothing was copied and nothing rewritten — only how they are read.
  assertEquals(after.results.map((post: { id: string }) => post.id), idsBefore);
  assertEquals(
    after.results
      .map((post: { createdByUsername: string }) => post.createdByUsername)
      .toSorted(),
    [alpha, beta].toSorted(),
  );

  const group = await db
    .selectFrom("writingGroup")
    .select(["authorsArePseudonymous", "visibility"])
    .where("id", "=", groupId)
    .executeTakeFirstOrThrow();

  assertEquals(group.authorsArePseudonymous, false);
  // **It does not publish anything.** Whether the writing goes public is the pair's own decision.
  assertEquals(group.visibility, "private");
});

Deno.test("a revealed Blind-Date is an ordinary group and no longer one of these", async () => {
  const { alphaCookie, betaCookie } = await aMatchedBlindDate();

  await agree(alphaCookie);
  await agree(betaCookie);

  assertEquals((await mine(alphaCookie)).status, STATUS_CODE.NotFound);

  // And both seats are free, so either may apply for a next one.
  assertEquals(
    (await (await request(
      "GET",
      "/api/blind-date/eligibility",
      alphaCookie,
    )).json()).reason,
    null,
  );

  const active = await (await request(
    "GET",
    "/api/blind-date/active",
    alphaCookie,
  )).json();

  assertEquals(
    active.some((one: { plotTitle: string }) => one.plotTitle === PLOT),
    false,
    "a revealed Blind-Date should leave the running list",
  );
});

Deno.test("consent can be taken back while the other has not answered", async () => {
  const { alphaCookie, betaCookie, groupId, threadId } =
    await aMatchedBlindDate();

  await agree(alphaCookie);
  assertEquals((await takeBack(alphaCookie)).status, STATUS_CODE.OK);

  assertEquals((await (await mine(betaCookie)).json()).otherAgreed, false);

  // Beta saying yes now is the first yes, not the second.
  assertEquals((await (await agree(betaCookie)).json()).outcome, "waiting");

  const stillHidden = await (await posts(alphaCookie, groupId, threadId))
    .json();
  assert(
    stillHidden.results.every((post: { createdByUsername: string }) =>
      post.createdByUsername.startsWith("Blind-Date-Partner")
    ),
  );
});

Deno.test("somebody without a Blind-Date has nothing to agree to", async () => {
  const cookie = await registerUser(alpha);

  assertEquals((await mine(cookie)).status, STATUS_CODE.NotFound);
  assertEquals((await agree(cookie)).status, STATUS_CODE.NotFound);
  assertEquals((await takeBack(cookie)).status, STATUS_CODE.NotFound);
});

Deno.test("the moment somebody said yes is not moved by saying it again", async () => {
  const { alphaCookie } = await aMatchedBlindDate();

  await agree(alphaCookie);

  const first = await db
    .selectFrom("blindDatePartner")
    .select("wantsRevealAt")
    .where("userId", "=", await getUserId(alpha))
    .executeTakeFirstOrThrow();

  await agree(alphaCookie);

  const second = await db
    .selectFrom("blindDatePartner")
    .select("wantsRevealAt")
    .where("userId", "=", await getUserId(alpha))
    .executeTakeFirstOrThrow();

  // The timestamp is when they decided, which a second press does not change.
  assertEquals(second.wantsRevealAt, first.wantsRevealAt);
});

Deno.test("the first yes actively tells the other side", async () => {
  const { alphaCookie, betaCookie } = await aMatchedBlindDate();

  await agree(alphaCookie);

  const feed = await (await request("QUERY", "/api/notifications", betaCookie, {
    limit: 20,
    offset: 0,
    sortAttribute: "occurredAt",
    sortOrder: "desc",
  })).json();

  const told = feed.results.find(
    (one: { type: string }) => one.type === "blind_date_reveal_requested",
  );

  // Without this the decision sat in the group waiting for somebody with no reason to look.
  assert(told !== undefined, "the other side should be told");
  // Actorless, like the match: there is one other person it could be, and naming them would
  // answer the question the reveal exists to ask together.
  assertEquals(told.actorUsername, null);
  assertEquals(told.writingGroupTitle, PLOT);
});

Deno.test("pressing yes twice does not tell the other side twice", async () => {
  const { alphaCookie, betaCookie } = await aMatchedBlindDate();

  await agree(alphaCookie);
  await agree(alphaCookie);

  const feed = await (await request("QUERY", "/api/notifications", betaCookie, {
    limit: 20,
    offset: 0,
    sortAttribute: "occurredAt",
    sortOrder: "desc",
  })).json();

  assertEquals(
    feed.results.filter(
      (one: { type: string }) => one.type === "blind_date_reveal_requested",
    ).length,
    1,
  );
});

Deno.test("the second yes reveals rather than asking again", async () => {
  const { alphaCookie, betaCookie } = await aMatchedBlindDate();

  await agree(alphaCookie);
  assertEquals((await (await agree(betaCookie)).json()).outcome, "revealed");

  const feed =
    await (await request("QUERY", "/api/notifications", alphaCookie, {
      limit: 20,
      offset: 0,
      sortAttribute: "occurredAt",
      sortOrder: "desc",
    })).json();

  // Alpha already said yes; being asked to would be nonsense.
  assertEquals(
    feed.results.some(
      (one: { type: string }) => one.type === "blind_date_reveal_requested",
    ),
    false,
  );
});

Deno.test("the button stays shut until enough has been written together", async () => {
  const { alphaCookie, threadId } = await aMatchedBlindDate();

  // Back below the threshold: the fixture wrote it over, so this takes two away again.
  await db
    .deleteFrom("writingPost")
    .where(
      "id",
      "in",
      db
        .selectFrom("writingPost")
        .select("id")
        .where("writingThreadId", "=", threadId)
        .limit(2),
    )
    .execute();

  const standing = await (await mine(alphaCookie)).json();

  assertEquals(standing.mayReveal, false);
  assertEquals(standing.rpgPosts, POSTS_BEFORE_REVEAL - 2);
  // The number is returned so the interface can say what is still missing rather than only
  // greying the button out.
  assertEquals(standing.postsBeforeReveal, POSTS_BEFORE_REVEAL);

  // And the endpoint refuses, not only the button: a greyed-out control is a courtesy, and
  // the rule has to hold for anybody who reaches the endpoint another way.
  const refused = await agree(alphaCookie);
  assertEquals(refused.status, STATUS_CODE.Conflict);
  assertEquals((await refused.json()).error, "too_few_posts");
});

Deno.test("only the RPG thread counts, not the three organisational ones", async () => {
  const { alphaCookie, betaCookie, groupId, threadId } =
    await aMatchedBlindDate();

  // Take the RPG thread below the threshold, then write plenty in the exchange thread.
  await db
    .deleteFrom("writingPost")
    .where(
      "id",
      "in",
      db
        .selectFrom("writingPost")
        .select("id")
        .where("writingThreadId", "=", threadId)
        .limit(5),
    )
    .execute();

  const exchange = await db
    .selectFrom("blindDatePair")
    .select("exchangeThreadId")
    .where("writingGroupId", "=", groupId)
    .executeTakeFirstOrThrow();

  for (let index = 0; index < 10; index += 1) {
    // deno-lint-ignore no-await-in-loop -- ten posts, written in order
    await request(
      "POST",
      `/api/groups/${groupId}/threads/${exchange.exchangeThreadId}/posts`,
      index % 2 === 0 ? alphaCookie : betaCookie,
      postBody("Organisatorisches."),
    );
  }

  // Talking is not writing together: a pair must not be able to reach the button by planning
  // the story rather than writing it.
  const standing = await (await mine(alphaCookie)).json();
  assertEquals(standing.mayReveal, false);
  assertEquals(standing.rpgPosts, POSTS_BEFORE_REVEAL - 5);
});
