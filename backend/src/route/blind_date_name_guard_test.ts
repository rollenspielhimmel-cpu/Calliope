import { assert, assertEquals } from "@std/assert";
import { db } from "@/src/database/client.ts";
import {
  AUTOMATIC_EXCLUSION_REASON,
  BlindDateNameGuardService,
} from "@/src/service/blind_date_name_guard_service.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  postBody,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * The name guard: somebody writes their own name into the exchange thread, and moderation is asked
 * to look at it.
 *
 * **This is a basic check and the tests are written to say so.** There is a whole test below whose
 * only job is to record what it does *not* catch — spaced-out letters, a nickname, saying who you
 * are without a name — so that nobody reads a green suite here as "the anonymity is guaranteed".
 *
 * **And it decides nothing on its own.** A match files a report; every consequence waits for a
 * human. That is because a username can be an ordinary German word — „Rose", „Wolke" — and the
 * automatic version this replaced would have cost two people their Blind-Date over a harmless
 * sentence. The price, which the tests below pin down: while the suspicion is open the post is
 * shown exactly as written, so the other person can read the name in it.
 *
 * The things that must hold:
 *
 *  1. **Only the exchange thread.** The RPG thread is fiction, and a character may share a name
 *     with a member. Putting that in front of moderation would be worse than the leak.
 *  2. **Whole words only.** „Ann" inside „dann" must not raise a suspicion at all.
 *  3. **Nothing happens before a human decides.** No ending, no exclusion, no mail, no masking.
 *  4. **Confirming ends it and keeps everything.** The group, the threads and every post stay;
 *     from then on both names are masked wherever the group is read.
 *  5. **Dismissing does nothing at all**, and the notice disappears.
 *  6. **The other person learns that it ended and not why.**
 */

const alpha = "guardalpha";
const beta = "guardbeta";
const operator = "guard-operator";

const USERS = [alpha, beta, operator];

const PLOT = "Guard-Testhandlung";

const APPLICATION = {
  plotTitle: PLOT,
  writingStyle: "prose",
  postLength: "medium",
  roleGender: "egal",
  pairing: "offen",
} as const;

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

  await db.deleteFrom("notification").where("recipientId", "in", ids).execute();
  await db.deleteFrom("blindDatePartner").where("userId", "in", ids).execute();
  await db.deleteFrom("blindDateExclusion").where("userId", "in", ids)
    .execute();
  await db.deleteFrom("blindDateApplication").where("userId", "in", ids)
    .execute();

  if (groups.length > 0) {
    await db.deleteFrom("blindDatePair").where("writingGroupId", "in", groups)
      .execute();

    const threads = db.selectFrom("writingThread").select("id").where(
      "writingGroupId",
      "in",
      groups,
    );
    await db.deleteFrom("writingPost").where("writingThreadId", "in", threads)
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

  await deleteUsers(USERS);
});

/** A matched Blind-Date, with the ids of both threads that matter. */
async function aBlindDate() {
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
    .select("blindDateApplication.id")
    .where("user.username", "in", [alpha, beta])
    .where("blindDateApplication.status", "=", "pending")
    .execute();

  await request("POST", "/api/moderation/blind-date/matches", operatorCookie, {
    firstApplicationId: applications[0]?.id,
    secondApplicationId: applications[1]?.id,
    plotTitle: PLOT,
    synopsis: "Zwei, die einander nicht kennen.",
  });

  const pair = await db
    .selectFrom("blindDatePair")
    .innerJoin(
      "writingGroup",
      "writingGroup.id",
      "blindDatePair.writingGroupId",
    )
    .select([
      "blindDatePair.id as pairId",
      "blindDatePair.writingGroupId",
      "blindDatePair.exchangeThreadId",
      "blindDatePair.rpgThreadId",
    ])
    .where("writingGroup.title", "=", PLOT)
    .executeTakeFirstOrThrow();

  return { alphaCookie, betaCookie, operatorCookie, ...pair };
}

const write = (
  cookie: string,
  groupId: string,
  threadId: string,
  text: string,
) =>
  request(
    "POST",
    `/api/groups/${groupId}/threads/${threadId}/posts`,
    cookie,
    postBody(text),
  );

const openSuspicion = async (operatorCookie: string) => {
  const list = await (await request(
    "GET",
    "/api/moderation/blind-date/suspicions",
    operatorCookie,
  )).json();

  return list[0];
};

const confirmSuspicion = (operatorCookie: string, id: string) =>
  request(
    "POST",
    `/api/moderation/blind-date/suspicions/${id}/confirm`,
    operatorCookie,
  );

const dismissSuspicion = (operatorCookie: string, id: string) =>
  request(
    "POST",
    `/api/moderation/blind-date/suspicions/${id}/dismiss`,
    operatorCookie,
  );

const readPosts = async (
  cookie: string,
  groupId: string,
  threadId: string,
) =>
  await (await request(
    "QUERY",
    `/api/groups/${groupId}/threads/${threadId}/posts`,
    cookie,
    { limit: 20, offset: 0, sortAttribute: "createdAt", sortOrder: "asc" },
  )).json();

const pairState = (pairId: string) =>
  db
    .selectFrom("blindDatePair")
    .select(["endedAt", "endedReason", "revealedAt"])
    .where("id", "=", pairId)
    .executeTakeFirstOrThrow();

Deno.test("a name in the exchange thread files a report and does nothing else", async () => {
  const {
    alphaCookie,
    operatorCookie,
    writingGroupId,
    exchangeThreadId,
    pairId,
  } = await aBlindDate();

  await write(
    alphaCookie,
    writingGroupId,
    exchangeThreadId as string,
    `Bis morgen! Liebe Grüße, ${alpha}`,
  );

  const suspicion = await openSuspicion(operatorCookie);

  assert(suspicion !== undefined, "the suspicion should be in the queue");
  assertEquals(suspicion.suspected.username, alpha);
  assert(suspicion.excerpt.includes(alpha));

  // And nothing at all has happened to anybody.
  assertEquals((await pairState(pairId)).endedAt, null);

  const exclusion = await db
    .selectFrom("blindDateExclusion")
    .select("userId")
    .where("userId", "=", await getUserId(alpha))
    .executeTakeFirst();

  assertEquals(exclusion, undefined, "nobody should be excluded yet");
});

Deno.test("the report reaches the ordinary queue, with no reporter", async () => {
  const { alphaCookie, operatorCookie, writingGroupId, exchangeThreadId } =
    await aBlindDate();

  await write(
    alphaCookie,
    writingGroupId,
    exchangeThreadId as string,
    `Ich bin übrigens ${alpha}.`,
  );

  const suspicion = await openSuspicion(operatorCookie);

  const report = await db
    .selectFrom("report")
    .select(["reporterId", "targetType", "status", "reason"])
    .where("id", "=", suspicion.reportId)
    .executeTakeFirstOrThrow();

  // Nobody reported this. Null is how this project records a missing human throughout.
  assertEquals(report.reporterId, null);
  assertEquals(report.targetType, "writing_post");
  assertEquals(report.status, "open");
  assert(report.reason.includes("Automatisch erkannt"));
});

Deno.test("while it is open the post is shown as written, with a notice beside it", async () => {
  const { alphaCookie, betaCookie, writingGroupId, exchangeThreadId } =
    await aBlindDate();

  await write(
    alphaCookie,
    writingGroupId,
    exchangeThreadId as string,
    `Hier schreibt ${alpha}, freut mich!`,
  );

  const page = await readPosts(
    betaCookie,
    writingGroupId,
    exchangeThreadId as string,
  );
  const post = page.results[0];

  // **The cost of waiting for a human, pinned down.** The name is readable until somebody
  // decides — masking it first would disfigure an innocent sentence, which is exactly what the
  // automatic version did wrong.
  assert(post.text.includes(alpha));
  assertEquals(post.isUnderReview, true);
});

Deno.test("confirming ends the Blind-Date, keeps everything, and masks the names", async () => {
  const {
    alphaCookie,
    betaCookie,
    operatorCookie,
    writingGroupId,
    exchangeThreadId,
    rpgThreadId,
    pairId,
  } = await aBlindDate();

  await write(betaCookie, writingGroupId, rpgThreadId as string, "Ein Absatz.");
  await write(
    alphaCookie,
    writingGroupId,
    exchangeThreadId as string,
    `Grüße, ${alpha}`,
  );

  const suspicion = await openSuspicion(operatorCookie);
  assertEquals(
    (await confirmSuspicion(operatorCookie, suspicion.id)).status,
    200,
  );

  const state = await pairState(pairId);
  assert(state.endedAt !== null, "the pair should have ended");
  assertEquals(state.endedReason, "name_revealed");
  // Ended, not revealed: nobody was shown to anybody.
  assertEquals(state.revealedAt, null);

  // Nothing deleted, and still pseudonymous.
  const group = await db
    .selectFrom("writingGroup")
    .select("authorsArePseudonymous")
    .where("id", "=", writingGroupId)
    .executeTakeFirstOrThrow();
  assertEquals(group.authorsArePseudonymous, true);

  const threads = await db
    .selectFrom("writingThread")
    .select("id")
    .where("writingGroupId", "=", writingGroupId)
    .execute();
  assertEquals(threads.length, 4);

  // From here on the name is hidden wherever the group is read — and the row still holds it.
  const page = await readPosts(
    betaCookie,
    writingGroupId,
    exchangeThreadId as string,
  );
  assertEquals(JSON.stringify(page).includes(alpha), false);
  assert(JSON.stringify(page).includes("***"));

  const stored = await db
    .selectFrom("writingPost")
    .select("text")
    .where("writingThreadId", "=", exchangeThreadId as string)
    .executeTakeFirstOrThrow();
  assert(stored.text.includes(alpha), "the stored post should be unchanged");
});

Deno.test("confirming excludes the author, naming the operator who decided it", async () => {
  const { alphaCookie, operatorCookie, writingGroupId, exchangeThreadId } =
    await aBlindDate();

  await write(
    alphaCookie,
    writingGroupId,
    exchangeThreadId as string,
    `Tschüss, ${alpha}`,
  );

  const suspicion = await openSuspicion(operatorCookie);
  await confirmSuspicion(operatorCookie, suspicion.id);

  const exclusion = await db
    .selectFrom("blindDateExclusion")
    .select(["reason", "addedBy"])
    .where("userId", "=", await getUserId(alpha))
    .executeTakeFirstOrThrow();

  assertEquals(exclusion.reason, AUTOMATIC_EXCLUSION_REASON);
  // A human decided this one, unlike the version this replaced — so the list says whose.
  assertEquals(exclusion.addedBy, await getUserId(operator));
});

Deno.test("dismissing does nothing at all, and the notice goes away", async () => {
  const {
    alphaCookie,
    betaCookie,
    operatorCookie,
    writingGroupId,
    exchangeThreadId,
    pairId,
  } = await aBlindDate();

  await write(
    alphaCookie,
    writingGroupId,
    exchangeThreadId as string,
    `Die ${alpha} blüht im Garten.`,
  );

  const suspicion = await openSuspicion(operatorCookie);
  assertEquals(
    (await dismissSuspicion(operatorCookie, suspicion.id)).status,
    200,
  );

  // The whole point of the human step: a username that is an ordinary word costs nobody
  // anything.
  assertEquals((await pairState(pairId)).endedAt, null);

  const exclusion = await db
    .selectFrom("blindDateExclusion")
    .select("userId")
    .where("userId", "=", await getUserId(alpha))
    .executeTakeFirst();
  assertEquals(exclusion, undefined);

  const page = await readPosts(
    betaCookie,
    writingGroupId,
    exchangeThreadId as string,
  );
  assertEquals(page.results[0].isUnderReview, false);
  // Not masked either: nothing was found, so nothing is hidden.
  assert(page.results[0].text.includes(alpha));
});

Deno.test("a decision cannot be taken twice", async () => {
  const { alphaCookie, operatorCookie, writingGroupId, exchangeThreadId } =
    await aBlindDate();

  await write(
    alphaCookie,
    writingGroupId,
    exchangeThreadId as string,
    `Bis bald, ${alpha}`,
  );

  const suspicion = await openSuspicion(operatorCookie);
  assertEquals(
    (await dismissSuspicion(operatorCookie, suspicion.id)).status,
    200,
  );

  // Two operators reaching the same one: the second loses rather than applying the
  // consequences on top of a decision already taken.
  assertEquals(
    (await confirmSuspicion(operatorCookie, suspicion.id)).status,
    409,
  );
});

Deno.test("the other person is told it ended, and not why", async () => {
  const {
    alphaCookie,
    betaCookie,
    operatorCookie,
    writingGroupId,
    exchangeThreadId,
  } = await aBlindDate();

  await write(
    alphaCookie,
    writingGroupId,
    exchangeThreadId as string,
    `Liebe Grüße, ${alpha}`,
  );

  const suspicion = await openSuspicion(operatorCookie);
  await confirmSuspicion(operatorCookie, suspicion.id);

  const feed = await (await request("QUERY", "/api/notifications", betaCookie, {
    limit: 20,
    offset: 0,
    sortAttribute: "occurredAt",
    sortOrder: "desc",
  })).json();

  const told = feed.results.find(
    (one: { type: string }) => one.type === "blind_date_ended",
  );

  assert(told !== undefined, "the other side should be told it ended");

  // The values, not the serialised object: `actorUsername` is a key containing "name".
  const said = Object.values(told)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  assertEquals(said.includes(alpha.toLowerCase()), false);
  assertEquals(said.includes("benutzername"), false);
  assertEquals(told.actorUsername, null);
});

Deno.test("the RPG thread is not watched: a character may share a member's name", async () => {
  const { alphaCookie, operatorCookie, writingGroupId, rpgThreadId } =
    await aBlindDate();

  await write(
    alphaCookie,
    writingGroupId,
    rpgThreadId as string,
    `„${alpha}“, rief sie über den Hof.`,
  );

  // Fiction is fiction. Putting that in front of moderation would be worse than the leak.
  assertEquals(await openSuspicion(operatorCookie), undefined);
});

Deno.test("whole words only: a name inside another word is not a name", async () => {
  const { alphaCookie, operatorCookie, writingGroupId, exchangeThreadId } =
    await aBlindDate();

  await write(
    alphaCookie,
    writingGroupId,
    exchangeThreadId as string,
    `Ich hänge an der Datei ${alpha}xyz.txt.`,
  );

  assertEquals(await openSuspicion(operatorCookie), undefined);
});

Deno.test("a draft is not a leak: nobody has read it yet", async () => {
  const { alphaCookie, operatorCookie, writingGroupId, exchangeThreadId } =
    await aBlindDate();

  await request(
    "POST",
    `/api/groups/${writingGroupId}/threads/${exchangeThreadId}/posts`,
    alphaCookie,
    postBody(`Entwurf von ${alpha}`, { isDraft: true }),
  );

  assertEquals(await openSuspicion(operatorCookie), undefined);
});

Deno.test("what the guard does NOT catch, recorded on purpose", () => {
  const matcher = BlindDateNameGuardService.nameMatcherFor([alpha, beta]);

  const slipsThrough = [
    "g u a r d a l p h a",
    "guard-alpha",
    "gu4rdalpha",
    "ich bin die aus der Werkstatt-Gruppe",
    "mein echter Vorname ist Anna",
  ];

  for (const text of slipsThrough) {
    assertEquals(
      BlindDateNameGuardService.nameMatcherFor([alpha, beta])?.test(text),
      false,
      `"${text}" was expected to slip through — if it no longer does, that is an improvement worth updating this list for`,
    );
  }

  assert(matcher?.test(`Liebe Grüße, ${alpha}`));
});
