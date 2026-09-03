import { assert, assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import { BlindDateService } from "@/src/service/blind_date_service.ts";
import { BlindDateAccessService } from "@/src/service/blind_date_access_service.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * Who may reach the Blind-Date desk.
 *
 * Three things are worth holding in place, and each of them is the kind that breaks quietly.
 *
 * **Every route of the area, not four of five.** The list below is the whole desk, and a route added
 * later that forgets the guard would be a hole nobody sees — the queue is the obvious one to
 * protect and the participation table is the one that gets forgotten.
 *
 * **The suspension is derived**, so it cannot be left switched on. A manager who applies goes blind
 * to the desk; when the application is settled, the access is simply there again, with nothing to
 * clear.
 *
 * **Nobody pairs themselves**, and that one has no exemption at all — not even the root
 * administrator, who is exempt from the suspension so the desk keeps working while somebody waits.
 */

const root = "bdaccess-root";
const manager = "bdaccess-manager";
const plainOperator = "bdaccess-operator";
const member = "bdaccess-member";
const other = "bdaccess-other";

const USERS = [root, manager, plainOperator, member, other];

const APPLICATION = {
  plotTitle: "Probe",
  writingStyle: "prose",
  postLength: "medium",
  roleGender: "weiblich",
  pairing: "offen",
} as const;

/** Every route the right is meant to cover. A new one belongs in here. */
const DESK: ReadonlyArray<[string, string]> = [
  ["GET", "/api/moderation/blind-date/applications"],
  ["GET", "/api/moderation/blind-date/exclusions"],
  ["GET", "/api/moderation/blind-date/offers"],
  ["GET", "/api/moderation/blind-date/suspicions"],
  ["GET", "/api/moderation/blind-date/feedback"],
  ["QUERY", "/api/moderation/blind-date/participation"],
];

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

  await db.deleteFrom("blindDatePartner").where("userId", "in", ids).execute();
  await db.deleteFrom("blindDateApplication").where("userId", "in", ids)
    .execute();
  await db.deleteFrom("notification").where("recipientId", "in", ids).execute();

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

  await deleteUsers(USERS);
});

/**
 * A session for the **real** root administrator, rather than a borrowed seat.
 *
 * A partial unique index allows exactly one primordial account, so the usual fixture trick —
 * releasing `Admin`, taking the seat, giving it back — cannot be done by two files at once, and
 * `operators_test.ts` already does it. Two files borrowing the same seat under `--parallel` is a
 * flake waiting for a busy afternoon.
 *
 * Signing in as that account is not possible either: the password lives in the deployment's
 * environment and nowhere a test may read. So the session is made directly, which is what the
 * sign-in route does anyway once the password has checked out.
 */

async function asOperator(
  username: string,
  mayManageBlindDate = false,
): Promise<string> {
  const cookie = await registerUser(username);
  await db
    .updateTable("user")
    .set({ platformRole: "moderator", mayManageBlindDate })
    .where("username", "=", username)
    .execute();
  return cookie;
}

const managers = (cookie: string) =>
  request("GET", "/api/moderation/blind-date/managers", cookie);

const holdsIt = async (userId: string) =>
  (await BlindDateAccessService.listManagers()).some((one) =>
    one.id === userId
  );

const grant = (cookie: string, userId: string, mayManage: boolean) =>
  request("PUT", `/api/moderation/blind-date/managers/${userId}`, cookie, {
    mayManage,
  });

async function reachesDesk(cookie: string): Promise<number[]> {
  const statuses: number[] = [];
  for (const [method, path] of DESK) {
    const body = method === "QUERY"
      ? {
        limit: 25,
        offset: 0,
        sortAttribute: "endedByThem",
        sortOrder: "desc",
      }
      : undefined;
    // deno-lint-ignore no-await-in-loop -- six requests, and the order does not matter
    statuses.push((await request(method, path, cookie, body)).status);
  }
  return statuses;
}

Deno.test("the whole desk is behind the right, not only the queue", async () => {
  const operatorCookie = await asOperator(plainOperator);
  const managerCookie = await asOperator(manager, true);

  // On the team, without the right: every route refuses, and says which door.
  const refused = await reachesDesk(operatorCookie);
  assertEquals(refused, DESK.map(() => STATUS_CODE.Forbidden));

  const answer = await (await request(
    "GET",
    "/api/moderation/blind-date/applications",
    operatorCookie,
  )).json();
  assertEquals(answer.reason, "not_granted");

  // With it: every route answers.
  assertEquals(
    await reachesDesk(managerCookie),
    DESK.map(() => STATUS_CODE.OK),
  );
});

Deno.test("an ordinary member reaches none of it", async () => {
  const cookie = await registerUser(member);

  assertEquals(
    await reachesDesk(cookie),
    DESK.map(() => STATUS_CODE.Forbidden),
  );
});

Deno.test("applying takes the desk away, and being matched gives it back", async () => {
  const managerCookie = await asOperator(manager, true);
  // A second person with the right, who has no application of their own and therefore keeps
  // working. In a one-manager team this is the root administrator; the rule is the same either way,
  // and phrasing the test this way keeps it clear of the single primordial account that
  // `operators_test.ts` borrows.
  const standInCookie = await asOperator(plainOperator, true);
  const otherCookie = await registerUser(other);

  assertEquals(
    (await request(
      "GET",
      "/api/moderation/blind-date/applications",
      managerCookie,
    )).status,
    STATUS_CODE.OK,
  );

  // She applies like anybody else.
  assertEquals(
    (await request(
      "POST",
      "/api/blind-date/applications",
      managerCookie,
      APPLICATION,
    )).status,
    STATUS_CODE.OK,
  );

  // And from that moment she sees none of it — not the queue, not her own application in it.
  assertEquals(
    await reachesDesk(managerCookie),
    DESK.map(() => STATUS_CODE.Forbidden),
  );

  const answer = await (await request(
    "GET",
    "/api/moderation/blind-date/applications",
    managerCookie,
  )).json();
  assertEquals(answer.reason, "own_application_open");

  // The stand-in keeps working, which is the whole point of the arrangement.
  //
  // Looked for by name rather than by counting: the queue is the whole database's, other test
  // files have applications waiting at the same moment, and a length would be a number this file
  // does not control — nor would picking the first two rows be this file's own two.
  const queue = await (await request(
    "GET",
    "/api/moderation/blind-date/applications",
    standInCookie,
  )).json();
  const hers = queue.find((row: { user: { username: string } }) =>
    row.user.username === manager
  );
  assert(hers !== undefined, "the stand-in should see her application");
  // And is told that it is from somebody who works the desk.
  assertEquals(hers.isBlindDateManager, true);

  // Somebody else applies, and the stand-in pairs the two of them.
  await request(
    "POST",
    "/api/blind-date/applications",
    otherCookie,
    APPLICATION,
  );

  const both = (await (await request(
    "GET",
    "/api/moderation/blind-date/applications",
    standInCookie,
  )).json()).filter((row: { user: { username: string } }) =>
    [manager, other].includes(row.user.username)
  );
  assertEquals(both.length, 2);

  assertEquals(
    (await request(
      "POST",
      "/api/moderation/blind-date/matches",
      standInCookie,
      {
        firstApplicationId: both[0].id,
        secondApplicationId: both[1].id,
        plotTitle: "Probe",
        synopsis: "x",
      },
    )).status,
    STATUS_CODE.OK,
  );

  // Settled, so the access is simply there again — nothing was cleared by hand.
  assertEquals(
    await reachesDesk(managerCookie),
    DESK.map(() => STATUS_CODE.OK),
  );
});

Deno.test("withdrawing gives the desk back too", async () => {
  const managerCookie = await asOperator(manager, true);

  await request(
    "POST",
    "/api/blind-date/applications",
    managerCookie,
    APPLICATION,
  );
  assertEquals(
    (await request(
      "GET",
      "/api/moderation/blind-date/applications",
      managerCookie,
    ))
      .status,
    STATUS_CODE.Forbidden,
  );

  await request("DELETE", "/api/blind-date/applications/mine", managerCookie);

  assertEquals(
    (await request(
      "GET",
      "/api/moderation/blind-date/applications",
      managerCookie,
    ))
      .status,
    STATUS_CODE.OK,
  );
});

/**
 * Whoever holds the primordial seat right now, waiting briefly if nobody does.
 *
 * There is exactly one such account, and `operators_test.ts` borrows the seat for the length of its
 * fixture — releasing it, registering users, then taking it. So „the account called Admin" is not a
 * stable thing to point at while the suite runs in parallel, and neither is „somebody holds it".
 *
 * Read rather than written, deliberately: taking the seat here would make the *other* file fail
 * instead, and trading one flake for another is not a fix. Waiting costs a few milliseconds and
 * disturbs nobody.
 */
async function whoeverIsPrimordial(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const holder = await db
      .selectFrom("user")
      .select("id")
      .where("isPrimordialAdmin", "=", true)
      .executeTakeFirst();

    if (holder !== undefined) {
      return holder.id;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("no account held the primordial seat for two seconds");
}

Deno.test("whoever holds the administration account cannot apply", async () => {
  const primordial = await whoeverIsPrimordial();

  const eligibility = await BlindDateService.eligibilityFor(primordial);
  assertEquals(eligibility.reason, "administration_account");

  // Said before every other reason, so the answer does not change with the day: the others
  // describe a moment, this one describes what the account is for.
  const refused = await BlindDateService.apply(primordial, {
    offerId: null,
    plotTitle: "Probe",
    writingStyle: "prose",
    postLength: "medium",
    roleGender: "weiblich",
    pairing: "offen",
    note: null,
  });
  assertEquals(refused, "administration_account");

  // And nothing was written.
  const applications = await db
    .selectFrom("blindDateApplication")
    .select("id")
    .where("userId", "=", primordial)
    .execute();
  assertEquals(applications.length, 0);
});

Deno.test("an ordinary member is not caught by that", async () => {
  const cookie = await registerUser(member);

  assertEquals(
    (await request("POST", "/api/blind-date/applications", cookie, APPLICATION))
      .status,
    STATUS_CODE.OK,
  );
});

Deno.test("only the root administrator gives the right out", async () => {
  const administratorCookie = await registerUser(plainOperator);
  await db
    .updateTable("user")
    .set({ platformRole: "administrator" })
    .where("username", "=", plainOperator)
    .execute();
  await registerUser(manager);
  await db
    .updateTable("user")
    .set({ platformRole: "moderator" })
    .where("username", "=", manager)
    .execute();

  const managerId = await getUserId(manager);

  // An ordinary administrator may not — this is the level above the roles. Checked through the
  // route, because that is where the rule lives.
  assertEquals(
    (await grant(administratorCookie, managerId, true)).status,
    STATUS_CODE.Forbidden,
  );
  assertEquals(
    (await managers(administratorCookie)).status,
    STATUS_CODE.Forbidden,
  );

  // The granting itself on the service, which needs no session: there is exactly one primordial
  // account and `operators_test.ts` borrows it, so a second file depending on it is a flake
  // waiting for a busy afternoon.
  assertEquals(
    await BlindDateAccessService.setManagement(managerId, true),
    undefined,
  );
  // Asked about this member rather than about the length: the list covers the whole database,
  // other test files hold the right at the same moment, and a count is a number this file does
  // not control.
  assertEquals(await holdsIt(managerId), true);

  assertEquals(
    await BlindDateAccessService.setManagement(managerId, false),
    undefined,
  );
  assertEquals(await holdsIt(managerId), false);
});

Deno.test("the right cannot be given to somebody who is not on the team", async () => {
  await registerUser(member);

  assertEquals(
    await BlindDateAccessService.setManagement(await getUserId(member), true),
    "not_an_operator",
  );
});
