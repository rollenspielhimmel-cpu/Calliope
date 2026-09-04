import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import { getUserId, registerUser, request } from "@/src/test/support.ts";
import {
  borrowPrimordialSeat,
  returnPrimordialSeat,
} from "@/src/test/primordial_seat.ts";

/**
 * The level above the roles. Three rules, and the third is the one that makes the other two mean
 * something: an ordinary administrator cannot appoint a second, so the set of administrators is
 * only ever changed by the one account whose own role cannot be changed.
 */

const PRIMORDIAL = "operators-test-root";
const ADMINISTRATOR = "operators-test-admin";
const MODERATOR = "operators-test-moderator";
const MEMBER = "operators-test-member";

const USERNAMES = [PRIMORDIAL, ADMINISTRATOR, MODERATOR, MEMBER];

async function setRole(
  username: string,
  role: "administrator" | "moderator" | null,
) {
  await db
    .updateTable("user")
    .set({ platformRole: role })
    .where("username", "=", username)
    .execute();
}

async function fixture() {
  const cookies = {
    primordial: await registerUser(PRIMORDIAL),
    administrator: await registerUser(ADMINISTRATOR),
    moderator: await registerUser(MODERATOR),
    member: await registerUser(MEMBER),
  };

  await setRole(PRIMORDIAL, "administrator");
  await setRole(ADMINISTRATOR, "administrator");
  await setRole(MODERATOR, "moderator");

  // Waits for whoever else is using the one seat rather than taking it from them, which is what
  // this file used to do — and what broke every other file the moment a third one wanted it.
  await borrowPrimordialSeat(PRIMORDIAL);

  return cookies;
}

Deno.test.afterEach(async () => {
  // The seat first: the CHECK constraint refuses a row that keeps the flag without the role, and
  // handing it back before deleting anything is simpler than reasoning about the order.
  await returnPrimordialSeat();

  await db.deleteFrom("user").where("username", "in", USERNAMES).execute();
});

Deno.test("the first administrator may grant the administrator role", async () => {
  const cookies = await fixture();

  const response = await request(
    "PUT",
    `/api/moderation/operators/${await getUserId(MEMBER)}`,
    cookies.primordial,
    { platformRole: "administrator" },
  );

  assertEquals(response.status, STATUS_CODE.OK);
});

Deno.test("an ordinary administrator may still grant the moderator role", async () => {
  const cookies = await fixture();

  const response = await request(
    "PUT",
    `/api/moderation/operators/${await getUserId(MEMBER)}`,
    cookies.administrator,
    { platformRole: "moderator" },
  );

  assertEquals(response.status, STATUS_CODE.OK);
});

Deno.test("an ordinary administrator cannot appoint another administrator", async () => {
  const cookies = await fixture();

  const response = await request(
    "PUT",
    `/api/moderation/operators/${await getUserId(MEMBER)}`,
    cookies.administrator,
    { platformRole: "administrator" },
  );

  assertEquals(response.status, STATUS_CODE.Forbidden);
});

Deno.test("an ordinary administrator cannot demote another administrator", async () => {
  const cookies = await fixture();

  // The target already holds the role, so this is the revoking half of the same rule.
  await setRole(MEMBER, "administrator");

  const response = await request(
    "PUT",
    `/api/moderation/operators/${await getUserId(MEMBER)}`,
    cookies.administrator,
    { platformRole: "moderator" },
  );

  assertEquals(response.status, STATUS_CODE.Forbidden);
});

Deno.test("nobody can take the first administrator's role away", async () => {
  const cookies = await fixture();
  const primordialId = await getUserId(PRIMORDIAL);

  for (const [who, cookie] of Object.entries(cookies)) {
    // deno-lint-ignore no-await-in-loop -- one assertion per actor, and order does not matter
    const demote = await request(
      "PUT",
      `/api/moderation/operators/${primordialId}`,
      cookie,
      { platformRole: "moderator" },
    );

    // deno-lint-ignore no-await-in-loop -- as above
    const revoke = await request(
      "PUT",
      `/api/moderation/operators/${primordialId}`,
      cookie,
      { platformRole: null },
    );

    // The moderator and the member are refused for lacking the role at all, the administrator
    // and the account itself by the rules above — every one of them is refused.
    assertEquals(demote.ok, false, `${who} demoted the first administrator`);
    assertEquals(revoke.ok, false, `${who} revoked the first administrator`);
  }

  const after = await db
    .selectFrom("user")
    .select(["platformRole", "isPrimordialAdmin"])
    .where("id", "=", primordialId)
    .executeTakeFirstOrThrow();

  assertEquals(after.platformRole, "administrator");
  assertEquals(after.isPrimordialAdmin, true);
});

Deno.test("the database refuses to demote the first administrator even without a route", async () => {
  await fixture();

  // The real guarantee, tested without going through any handler: a later route that forgets
  // the rule still cannot write the row.
  for (const role of ["moderator", null] as const) {
    let refused = false;

    try {
      // deno-lint-ignore no-await-in-loop -- two statements, each expected to throw
      await db
        .updateTable("user")
        .set({ platformRole: role })
        .where("username", "=", PRIMORDIAL)
        .execute();
    } catch {
      refused = true;
    }

    assertEquals(refused, true, `the database allowed platformRole = ${role}`);
  }
});
