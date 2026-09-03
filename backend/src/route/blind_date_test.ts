import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import { ActivityService } from "@/src/service/activity_service.ts";
import {
  BlindDateService,
  REQUIRED_ONLINE_MINUTES,
} from "@/src/service/blind_date_service.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * Applying for a Blind-Date, and the four reasons somebody may not.
 *
 * The condition worth the most care is the online time, because it is the one that is **not in
 * force yet**: the platform has no launch date, so the grace period is running and 1000 minutes
 * are not asked of anybody. The tests below say that out loud rather than passing by accident —
 * if somebody sets the date and this file starts failing, that is the rule arriving, on purpose.
 */

const member = "blinddate-member";
const other = "blinddate-other";
const excluded = "blinddate-excluded";

const USERS = [member, other, excluded];

const OFFER_TITLE = "Blind-Date Testangebot";

const APPLICATION = {
  plotTitle: "Whispers of Eldermere",
  writingStyle: "prose",
  postLength: "medium",
  roleGender: "weiblich",
  pairing: "offen",
} as const;

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  const ids = db.selectFrom("user").select("id").where("username", "in", USERS);

  await db.deleteFrom("blindDatePartner").where("userId", "in", ids).execute();
  await db.deleteFrom("blindDateApplication").where("userId", "in", ids)
    .execute();
  await db.deleteFrom("blindDateExclusion").where("userId", "in", ids)
    .execute();
  await db.deleteFrom("blindDateOffer").where("title", "=", OFFER_TITLE)
    .execute();

  await deleteUsers(USERS);
  ActivityService.forgetRecordedActivity();
});

const eligibility = (cookie: string) =>
  request("GET", "/api/blind-date/eligibility", cookie);

const apply = (cookie: string, body: Record<string, unknown> = {}) =>
  request("POST", "/api/blind-date/applications", cookie, {
    ...APPLICATION,
    ...body,
  });

const ownApplication = (cookie: string) =>
  request("GET", "/api/blind-date/applications/mine", cookie);

const withdraw = (cookie: string) =>
  request("DELETE", "/api/blind-date/applications/mine", cookie);

Deno.test("a member with no history at all may apply, because the rule is not in force yet", async () => {
  const cookie = await registerUser(member);

  const body = await (await eligibility(cookie)).json();

  // The whole point of the grace period: at launch nobody has collected anything.
  assertEquals(body.inGracePeriod, true);
  assertEquals(body.reason, null);
  assertEquals(body.requiredOnlineMinutes, REQUIRED_ONLINE_MINUTES);

  assertEquals((await apply(cookie)).status, STATUS_CODE.OK);
});

Deno.test("the online time is reported even while it does not count", async () => {
  const cookie = await registerUser(member);

  // Registering already made a request, so there is a window. The form shows where somebody
  // stands before the rule starts applying to them.
  const body = await (await eligibility(cookie)).json();

  assertEquals(typeof body.onlineMinutes, "number");
  assertEquals(body.onlineMinutes >= 15, true);
});

Deno.test("the rule is not in force, and the service says so in one place", () => {
  // The placeholder in `blind_date_service.ts` is what this reads. When a launch date is set,
  // this flips — and it should, three months after it.
  assertEquals(BlindDateService.onlineTimeIsEnforced(new Date()), false);
});

Deno.test("a second application is refused while the first is open", async () => {
  const cookie = await registerUser(member);

  assertEquals((await apply(cookie)).status, STATUS_CODE.OK);

  const second = await apply(cookie);
  assertEquals(second.status, STATUS_CODE.Forbidden);
  assertEquals((await second.json()).reason, "already_applied");
});

Deno.test("an excluded member is told that and nothing else", async () => {
  const cookie = await registerUser(excluded);

  await db
    .insertInto("blindDateExclusion")
    .values({
      userId: await getUserId(excluded),
      reason: "Wiederholt Absprachen nicht eingehalten",
    })
    .execute();

  const body = await (await eligibility(cookie)).json();

  // Not "not enough online time" on top: that would invite them to fix the wrong thing.
  assertEquals(body.reason, "excluded");

  const refused = await apply(cookie);
  assertEquals(refused.status, STATUS_CODE.Forbidden);
  assertEquals((await refused.json()).reason, "excluded");
});

Deno.test("somebody already in a Blind-Date may not apply for a second", async () => {
  const cookie = await registerUser(member);

  const group = await db
    .insertInto("writingGroup")
    .values({
      title: "Laufendes Blind-Date",
      synopsis: "x",
      visibility: "private",
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const pair = await db
    .insertInto("blindDatePair")
    .values({ writingGroupId: group.id })
    .returning("id")
    .executeTakeFirstOrThrow();

  await db
    .insertInto("blindDatePartner")
    .values({ pairId: pair.id, userId: await getUserId(member) })
    .execute();

  try {
    const refused = await apply(cookie);
    assertEquals(refused.status, STATUS_CODE.Forbidden);
    assertEquals((await refused.json()).reason, "already_matched");
  } finally {
    await db.deleteFrom("blindDatePartner").where("pairId", "=", pair.id)
      .execute();
    await db.deleteFrom("blindDatePair").where("id", "=", pair.id).execute();
    await db.deleteFrom("writingGroup").where("id", "=", group.id).execute();
  }
});

Deno.test("an application may take up an open offer, and not a closed one", async () => {
  const cookie = await registerUser(member);

  const offer = await db
    .insertInto("blindDateOffer")
    .values({ title: OFFER_TITLE, description: "Ein Plot zum Testen." })
    .returning("id")
    .executeTakeFirstOrThrow();

  const offers = await (await request(
    "GET",
    "/api/blind-date/offers",
    cookie,
  )).json();
  assertEquals(
    offers.some((one: { id: string }) => one.id === offer.id),
    true,
  );

  assertEquals(
    (await apply(cookie, { offerId: offer.id })).status,
    STATUS_CODE.OK,
  );
  await withdraw(cookie);

  await db
    .updateTable("blindDateOffer")
    .set({ closedAt: new Date().toISOString() })
    .where("id", "=", offer.id)
    .execute();

  // A closed offer answers the same as one that never existed: the round has moved on.
  assertEquals(
    (await apply(cookie, { offerId: offer.id })).status,
    STATUS_CODE.NotFound,
  );
});

Deno.test("where an offer names its roles, only one of them may be applied for", async () => {
  const cookie = await registerUser(member);

  const offer = await db
    .insertInto("blindDateOffer")
    .values({
      title: OFFER_TITLE,
      description: "Ein Plot zum Testen.",
      roles: ["Die Wirtin", "Der Fremde"],
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  // The list reaches the member, which is what makes it a choice rather than a guess.
  const offers = await (await request(
    "GET",
    "/api/blind-date/offers",
    cookie,
  )).json();
  assertEquals(
    offers.find((one: { id: string }) => one.id === offer.id).roles,
    ["Die Wirtin", "Der Fremde"],
  );

  // Free text was the whole point of the old field, so this is what must now be refused — and a
  // conflict rather than a bad request: the form was right when it was rendered.
  assertEquals(
    (await apply(cookie, { offerId: offer.id, roleGender: "weiblich" })).status,
    STATUS_CODE.Conflict,
  );

  assertEquals(
    (await apply(cookie, { offerId: offer.id, roleGender: "Die Wirtin" }))
      .status,
    STATUS_CODE.OK,
  );
  await withdraw(cookie);

  // An offer that names none keeps the free text it always had. Proved on the same offer so the
  // roles are the only thing that changed.
  await db
    .updateTable("blindDateOffer")
    .set({ roles: [] })
    .where("id", "=", offer.id)
    .execute();

  assertEquals(
    (await apply(cookie, { offerId: offer.id, roleGender: "weiblich" })).status,
    STATUS_CODE.OK,
  );
});

Deno.test("an offer past its deadline stays on the page and takes no more applications", async () => {
  const cookie = await registerUser(member);

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const offer = await db
    .insertInto("blindDateOffer")
    .values({
      title: OFFER_TITLE,
      description: "Ein Plot zum Testen.",
      closesAt: yesterday,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  // Still listed: the clock does not close an offer, the team does. Dropping it here would be
  // closing it automatically while the moderation list still called it open.
  const offers = await (await request(
    "GET",
    "/api/blind-date/offers",
    cookie,
  )).json();
  assertEquals(
    offers.some((one: { id: string }) => one.id === offer.id),
    true,
  );

  assertEquals(
    (await apply(cookie, { offerId: offer.id })).status,
    STATUS_CODE.Conflict,
  );

  // And a deadline still ahead changes nothing.
  await db
    .updateTable("blindDateOffer")
    .set({ closesAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
    .where("id", "=", offer.id)
    .execute();

  assertEquals(
    (await apply(cookie, { offerId: offer.id })).status,
    STATUS_CODE.OK,
  );
});

Deno.test("a member reads back their own application, and withdrawing keeps the row", async () => {
  const cookie = await registerUser(member);

  await apply(cookie, { note: "Schreibe abends." });

  const mine = await (await ownApplication(cookie)).json();
  assertEquals(mine.plotTitle, APPLICATION.plotTitle);
  assertEquals(mine.note, "Schreibe abends.");

  assertEquals((await withdraw(cookie)).status, STATUS_CODE.OK);
  assertEquals((await ownApplication(cookie)).status, STATUS_CODE.NotFound);

  // Withdrawn, not deleted: the team asked to keep every application.
  const stored = await db
    .selectFrom("blindDateApplication")
    .select(["status", "decidedAt"])
    .where("userId", "=", await getUserId(member))
    .executeTakeFirst();

  assertEquals(stored?.status, "withdrawn");
  assertEquals(stored?.decidedAt !== null, true);

  // And the seat is free again.
  assertEquals((await apply(cookie)).status, STATUS_CODE.OK);
});

Deno.test("one member's application is not another's", async () => {
  const cookie = await registerUser(member);
  const otherCookie = await registerUser(other);

  await apply(cookie);

  assertEquals(
    (await ownApplication(otherCookie)).status,
    STATUS_CODE.NotFound,
  );
  // And the other may still apply: one open application is per member, not per platform.
  assertEquals((await apply(otherCookie)).status, STATUS_CODE.OK);
});

Deno.test("withdrawing when there is nothing to withdraw is a 404, not a silent success", async () => {
  const cookie = await registerUser(member);

  assertEquals((await withdraw(cookie)).status, STATUS_CODE.NotFound);
});
