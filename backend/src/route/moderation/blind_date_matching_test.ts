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
 * The team's Blind-Date tools, and the one thing that must never go half-right.
 *
 * A match writes six things — the group, two memberships, the first thread, the pair, its partners
 * and both application statuses. **Either all of it or none.** A group with one member, or a pair
 * whose applications are still in the queue, is a state nobody could clean up by hand without
 * knowing what was meant, so the test below refuses a match that must fail and then checks that
 * *nothing at all* was left behind.
 */

const alpha = "bdmatch-alpha";
const beta = "bdmatch-beta";
const gamma = "bdmatch-gamma";
const operator = "bdmatch-operator";

const USERS = [alpha, beta, gamma, operator];

const PLOT = "Whispers of Eldermere";
const SYNOPSIS = "Zwei Fremde in einer Stadt, die sich erinnert.";

const APPLICATION = {
  plotTitle: PLOT,
  writingStyle: "prose",
  postLength: "medium",
  roleGender: "weiblich",
  pairing: "offen",
} as const;

Deno.test.beforeEach(async () => {
  sessions.clear();
  await clearRateLimits();
});

Deno.test.afterEach(async () => {
  const ids = db.selectFrom("user").select("id").where("username", "in", USERS);

  const groups = db
    .selectFrom("blindDatePair")
    .innerJoin(
      "blindDatePartner",
      "blindDatePartner.pairId",
      "blindDatePair.id",
    )
    .select("blindDatePair.writingGroupId")
    .where("blindDatePartner.userId", "in", ids);

  const groupIds = (await groups.execute()).map((row) => row.writingGroupId);

  await db.deleteFrom("blindDatePartner").where("userId", "in", ids).execute();

  if (groupIds.length > 0) {
    await db.deleteFrom("blindDatePair").where("writingGroupId", "in", groupIds)
      .execute();
    await db.deleteFrom("writingThread").where("writingGroupId", "in", groupIds)
      .execute();
    await db.deleteFrom("userInWritingGroup").where(
      "writingGroupId",
      "in",
      groupIds,
    ).execute();
    await db.deleteFrom("writingGroup").where("id", "in", groupIds).execute();
  }

  await db.deleteFrom("notification").where("recipientId", "in", ids).execute();
  await db.deleteFrom("blindDateApplication").where("userId", "in", ids)
    .execute();
  await db.deleteFrom("blindDateExclusion").where("userId", "in", ids)
    .execute();

  await deleteUsers(USERS);
});

async function asOperator(): Promise<string> {
  const cookie = await registerUser(operator);
  await db
    .updateTable("user")
    .set({ platformRole: "moderator" })
    .where("username", "=", operator)
    .execute();
  return cookie;
}

/**
 * The session of each applicant this test made, so a later step can act as them. Registering the
 * same name twice fails, which is what `registerUser` is for — this is the way back to a session
 * it already handed out.
 */
const sessions = new Map<string, string>();

/** An applicant with an open application, and the id of it. */
async function anApplicant(username: string): Promise<string> {
  const cookie = await registerUser(username);
  sessions.set(username, cookie);
  await request("POST", "/api/blind-date/applications", cookie, APPLICATION);

  const row = await db
    .selectFrom("blindDateApplication")
    .select("id")
    .where("userId", "=", await getUserId(username))
    .where("status", "=", "pending")
    .executeTakeFirstOrThrow();

  return row.id;
}

const queue = (cookie: string) =>
  request("GET", "/api/moderation/blind-date/applications", cookie);

const match = (cookie: string, first: string, second: string) =>
  request("POST", "/api/moderation/blind-date/matches", cookie, {
    firstApplicationId: first,
    secondApplicationId: second,
    plotTitle: PLOT,
    synopsis: SYNOPSIS,
  });

Deno.test("the queue carries what a pairing is judged on", async () => {
  const cookie = await asOperator();
  await anApplicant(alpha);

  const rows = await (await queue(cookie)).json();
  const row = rows.find((one: { user: { username: string } }) =>
    one.user.username === alpha
  );

  assert(row !== undefined, "the application is missing from the queue");
  assertEquals(row.plotTitle, PLOT);
  assertEquals(row.writingStyle, "prose");
  assertEquals(row.roleGender, "weiblich");
  // The online time beside it, so judging who is a regular takes no second page.
  assertEquals(typeof row.onlineMinutes, "number");
});

Deno.test("a match makes the whole Blind-Date and nothing less", async () => {
  const cookie = await asOperator();
  const first = await anApplicant(alpha);
  const second = await anApplicant(beta);

  assertEquals((await match(cookie, first, second)).status, STATUS_CODE.OK);

  const pair = await db
    .selectFrom("blindDatePair")
    .innerJoin(
      "writingGroup",
      "writingGroup.id",
      "blindDatePair.writingGroupId",
    )
    .select([
      "blindDatePair.id",
      "blindDatePair.writingGroupId",
      "blindDatePair.revealedAt",
      "writingGroup.title",
      "writingGroup.visibility",
      "writingGroup.authorsArePseudonymous",
    ])
    .where("writingGroup.title", "=", PLOT)
    .executeTakeFirstOrThrow();

  // Private, pseudonymous, and not revealed: the three facts the whole ritual rests on.
  assertEquals(pair.visibility, "private");
  assertEquals(pair.authorsArePseudonymous, true);
  assertEquals(pair.revealedAt, null);

  const members = await db
    .selectFrom("userInWritingGroup")
    .select(["userId", "role", "status"])
    .where("writingGroupId", "=", pair.writingGroupId)
    .execute();

  assertEquals(members.length, 2);
  // Both administrators: it is their group, and neither outranks the other.
  assert(members.every((member) => member.role === "administrator"));
  assert(members.every((member) => member.status === "joined"));

  // Four threads, in reading order: a profile each, somewhere for everything that is not the
  // story, and the story itself. Only the last of them counts towards the reveal's fifty posts.
  const threads = await db
    .selectFrom("writingThread")
    .select("title")
    .where("writingGroupId", "=", pair.writingGroupId)
    .execute();

  assertEquals(threads.map((thread) => thread.title), [
    "Steckbrief | Blind-Date1",
    "Steckbrief | Blind-Date2",
    "Gemeinsamer Austausch",
    `${PLOT} | RPG`,
  ]);

  // The two the rules read later are held by id, because a member may rename any of them.
  const held = await db
    .selectFrom("blindDatePair")
    .select(["rpgThreadId", "exchangeThreadId"])
    .where("id", "=", pair.id)
    .executeTakeFirstOrThrow();

  assert(held.rpgThreadId !== null);
  assert(held.exchangeThreadId !== null);

  const partners = await db
    .selectFrom("blindDatePartner")
    .select(["userId", "applicationId", "isActive"])
    .where("pairId", "=", pair.id)
    .execute();

  assertEquals(partners.length, 2);
  assert(partners.every((partner) => partner.isActive));
  // Each partner remembers which application put them there.
  assert(partners.every((partner) => partner.applicationId !== null));

  const applications = await db
    .selectFrom("blindDateApplication")
    .select(["status", "decidedAt", "decidedBy"])
    .where("id", "in", [first, second])
    .execute();

  assert(applications.every((one) => one.status === "matched"));
  assert(applications.every((one) => one.decidedAt !== null));
  assertEquals(
    applications.every((one) => one.decidedBy === null),
    false,
    "the match should record who made it",
  );
});

Deno.test("a member cannot be matched twice, and the refused attempt leaves nothing behind", async () => {
  const cookie = await asOperator();
  const first = await anApplicant(alpha);
  const second = await anApplicant(beta);

  await match(cookie, first, second);

  // Alpha is now in a Blind-Date, and their application has left the queue with them. Trying to
  // reuse it answers 404 rather than 409: the application is not there to match, which is a
  // different fact from the member being busy — see the test below for that one.
  const third = await anApplicant(gamma);
  const groupsBefore = await db
    .selectFrom("writingGroup")
    .select("id")
    .where("title", "=", PLOT)
    .execute();

  const refused = await match(cookie, first, third);
  assertEquals(refused.status, STATUS_CODE.NotFound);

  const groupsAfter = await db
    .selectFrom("writingGroup")
    .select("id")
    .where("title", "=", PLOT)
    .execute();

  // Either all of it or none: no group was left over from the attempt.
  assertEquals(groupsAfter.length, groupsBefore.length);

  const stillWaiting = await db
    .selectFrom("blindDateApplication")
    .select("status")
    .where("id", "=", third)
    .executeTakeFirstOrThrow();

  assertEquals(stillWaiting.status, "pending");
});

Deno.test("two applications from the same member are refused", async () => {
  const cookie = await asOperator();
  const only = await anApplicant(alpha);

  const refused = await match(cookie, only, only);

  assertEquals(refused.status, STATUS_CODE.Conflict);
  assertEquals((await refused.json()).error, "same_member");
});

Deno.test("somebody excluded after applying is not matched", async () => {
  const cookie = await asOperator();
  const first = await anApplicant(alpha);
  const second = await anApplicant(beta);

  // The queue was rendered before this happened, which is exactly why the check is repeated.
  await db
    .insertInto("blindDateExclusion")
    .values({ userId: await getUserId(beta), reason: "Nach Bewerbung" })
    .execute();

  assertEquals(
    (await match(cookie, first, second)).status,
    STATUS_CODE.Conflict,
  );
});

Deno.test("excluding somebody also takes their waiting application out of the queue", async () => {
  const cookie = await asOperator();
  await anApplicant(alpha);

  assertEquals(
    (await request(
      "PUT",
      `/api/moderation/blind-date/exclusions/${await getUserId(alpha)}`,
      cookie,
      { reason: "Wiederholt Absprachen nicht eingehalten" },
    )).status,
    STATUS_CODE.OK,
  );

  const rows = await (await queue(cookie)).json();
  assertEquals(
    rows.some((one: { user: { username: string } }) =>
      one.user.username === alpha
    ),
    false,
    "an application that can never be matched should not stay in the queue",
  );

  const exclusions = await (await request(
    "GET",
    "/api/moderation/blind-date/exclusions",
    cookie,
  )).json();

  assertEquals(
    exclusions.some((one: { user: { username: string } }) =>
      one.user.username === alpha
    ),
    true,
  );
});

Deno.test("declining keeps the row and frees the member to apply again", async () => {
  const cookie = await asOperator();
  const application = await anApplicant(alpha);

  assertEquals(
    (await request(
      "POST",
      `/api/moderation/blind-date/applications/${application}/decline`,
      cookie,
      { note: "Passt gerade zu niemandem" },
    )).status,
    STATUS_CODE.OK,
  );

  const stored = await db
    .selectFrom("blindDateApplication")
    .select(["status", "decisionNote"])
    .where("id", "=", application)
    .executeTakeFirstOrThrow();

  assertEquals(stored.status, "declined");
  assertEquals(stored.decisionNote, "Passt gerade zu niemandem");
});

Deno.test("an offer is opened, seen by members, and closed rather than deleted", async () => {
  const cookie = await asOperator();
  const memberCookie = await registerUser(alpha);

  assertEquals(
    (await request("POST", "/api/moderation/blind-date/offers", cookie, {
      title: "bdmatch Angebot",
      description: "Ein Plot zum Testen.",
    })).status,
    STATUS_CODE.OK,
  );

  const open = await (await request(
    "GET",
    "/api/blind-date/offers",
    memberCookie,
  )).json();

  const offer = open.find((one: { title: string }) =>
    one.title === "bdmatch Angebot"
  );
  assert(offer !== undefined, "members should see the open offer");

  assertEquals(
    (await request(
      "DELETE",
      `/api/moderation/blind-date/offers/${offer.id}`,
      cookie,
    )).status,
    STATUS_CODE.OK,
  );

  const stillOpen = await (await request(
    "GET",
    "/api/blind-date/offers",
    memberCookie,
  )).json();
  assertEquals(
    stillOpen.some((one: { id: string }) => one.id === offer.id),
    false,
  );

  // Closed, not gone: applications point at it and it has to stay readable.
  const all = await (await request(
    "GET",
    "/api/moderation/blind-date/offers",
    cookie,
  )).json();
  const closed = all.find((one: { id: string }) => one.id === offer.id);

  assert(closed !== undefined, "the offer should still be there for the team");
  assert(closed.closedAt !== null);

  await db.deleteFrom("blindDateOffer").where("id", "=", offer.id).execute();
});

Deno.test("an ordinary member reaches none of these", async () => {
  const cookie = await registerUser(alpha);

  assertEquals((await queue(cookie)).status, STATUS_CODE.Forbidden);
  assertEquals(
    (await request("GET", "/api/moderation/blind-date/exclusions", cookie))
      .status,
    STATUS_CODE.Forbidden,
  );
});

Deno.test("a pending application from somebody already in a Blind-Date is refused as a conflict", async () => {
  const cookie = await asOperator();
  const first = await anApplicant(alpha);
  const second = await anApplicant(beta);

  await match(cookie, first, second);

  // The state the ordinary flow prevents — applying is refused while matched — written straight
  // in, because this is the defence for the case the ordinary flow did not produce: a row made by
  // hand, a fix applied elsewhere, or two operators matching at the same moment.
  const revived = await db
    .insertInto("blindDateApplication")
    .values({
      userId: await getUserId(alpha),
      plotTitle: PLOT,
      writingStyle: "prose",
      postLength: "medium",
      roleGender: "weiblich",
      pairing: "offen",
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const third = await anApplicant(gamma);

  const refused = await match(cookie, revived.id, third);

  assertEquals(refused.status, STATUS_CODE.Conflict);
  assertEquals((await refused.json()).error, "already_matched");

  // And gamma is still waiting: the refusal wrote nothing.
  const stillWaiting = await db
    .selectFrom("blindDateApplication")
    .select("status")
    .where("id", "=", third)
    .executeTakeFirstOrThrow();

  assertEquals(stillWaiting.status, "pending");
});

Deno.test("both partners are told, and the notification names nobody", async () => {
  const cookie = await asOperator();
  const first = await anApplicant(alpha);
  const second = await anApplicant(beta);

  await match(cookie, first, second);

  const notifications = await db
    .selectFrom("notification")
    .innerJoin("user", "user.id", "notification.recipientId")
    .select([
      "user.username",
      "notification.type",
      "notification.actorId",
      "notification.writingGroupId",
    ])
    .where("notification.type", "=", "blind_date_matched")
    .where("user.username", "in", [alpha, beta])
    .execute();

  // Being matched is the moment this stops being a form and starts being something that is
  // happening. Both are told, in the same transaction that made the group.
  assertEquals(notifications.length, 2);
  assertEquals(
    notifications.map((one) => one.username).toSorted(),
    [alpha, beta].toSorted(),
  );

  // **No actor.** A Blind-Date is arranged by the team, and naming anybody here would answer the
  // one question the whole feature exists to hold back — in a popup, before anything is opened.
  assert(notifications.every((one) => one.actorId === null));
  assert(notifications.every((one) => one.writingGroupId !== null));

  // And what the recipient actually receives carries no name either.
  const memberCookie = sessions.get(alpha) ?? "";
  const feed =
    await (await request("QUERY", "/api/notifications", memberCookie, {
      limit: 20,
      offset: 0,
      sortAttribute: "occurredAt",
      sortOrder: "desc",
    })).json();

  const arrived = feed.results.find(
    (one: { type: string }) => one.type === "blind_date_matched",
  );

  assert(arrived !== undefined, "the notification should reach the member");
  assertEquals(arrived.actorUsername, null);
  assertEquals(arrived.writingGroupTitle, PLOT);
});

/**
 * The participation list: three numbers per member, and the reasons behind the broken-off ones.
 *
 * Worth its own test because the query is the only grouped one in the service, and a `filter
 * (where …)` that lands on the wrong branch would quietly count a revealed Blind-Date as an
 * abandoned one — a number the team would act on.
 */

/** A finished pair with two members in it, made directly: no matching decision is under test. */
async function aPair(
  first: string,
  second: string,
  state: { revealed: true } | { endedReason: string } | { running: true },
): Promise<void> {
  const group = await db
    .insertInto("writingGroup")
    .values({ title: PLOT, synopsis: SYNOPSIS, visibility: "private" })
    .returning("id")
    .executeTakeFirstOrThrow();

  const now = new Date().toISOString();

  const pair = await db
    .insertInto("blindDatePair")
    .values({
      writingGroupId: group.id,
      ...("revealed" in state ? { revealedAt: now } : {}),
      ...("endedReason" in state
        ? { endedAt: now, endedReason: state.endedReason }
        : {}),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  for (const username of [first, second]) {
    await db
      .insertInto("blindDatePartner")
      .values({
        pairId: pair.id,
        userId: await getUserId(username),
        isActive: "running" in state,
      })
      .execute();
  }
}

const participation = (cookie: string, body: Record<string, unknown> = {}) =>
  request("QUERY", "/api/moderation/blind-date/participation", cookie, {
    limit: 25,
    offset: 0,
    sortAttribute: "ended",
    sortOrder: "desc",
    ...body,
  });

Deno.test("the participation list separates seen through, broken off and running", async () => {
  const cookie = await asOperator();
  await registerUser(alpha);
  await registerUser(beta);
  await registerUser(gamma);

  await aPair(alpha, beta, { revealed: true });
  await aPair(alpha, gamma, { endedReason: "name_revealed" });
  await aPair(alpha, gamma, { running: true });

  const body = await (await participation(cookie)).json();

  const rowOf = (username: string) =>
    body.results.find((row: { username: string }) => row.username === username);

  assertEquals(rowOf(alpha).revealed, 1);
  assertEquals(rowOf(alpha).ended, 1);
  assertEquals(rowOf(alpha).running, 1);
  assertEquals(rowOf(alpha).endedReasons, ["name_revealed"]);

  // The other two are in the same pairs and must be counted for their own share of them.
  assertEquals(rowOf(beta).revealed, 1);
  assertEquals(rowOf(beta).ended, 0);
  assertEquals(rowOf(beta).endedReasons, []);
  assertEquals(rowOf(gamma).ended, 1);
  assertEquals(rowOf(gamma).revealed, 0);

  // Broken-off first, which is the question the page is opened with.
  const ranks = body.results.map((row: { ended: number }) => row.ended);
  assertEquals([...ranks].sort((a: number, b: number) => b - a), ranks);
});

Deno.test("the participation list is an operator's, and nobody else's", async () => {
  const cookie = await registerUser(alpha);

  assertEquals((await participation(cookie)).status, STATUS_CODE.Forbidden);
});
