import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import { getUserId, registerUser, request } from "@/src/test/support.ts";
import {
  borrowPrimordialSeat,
  returnPrimordialSeat,
} from "@/src/test/primordial_seat.ts";

/**
 * Which accounts a broadcast may be sent as.
 *
 * Two rules that pull in opposite directions and are both the point: **every administrator reads
 * this list**, because it is what a sender is chosen from, and **only the first administrator
 * changes it**, because sending under another name is the thing worth guarding. A test that only
 * checked the guard would pass with the list locked to one person, which is the bug this feature
 * would most plausibly grow.
 */

const PRIMORDIAL = "senders-test-root";
const ADMINISTRATOR = "senders-test-admin";
const MODERATOR = "senders-test-moderator";
const PERSONA = "senders-test-persona";

const USERNAMES = [PRIMORDIAL, ADMINISTRATOR, MODERATOR, PERSONA];

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
  };

  // The persona is a plain account and stays one: nobody signs in as it, and it holds no role.
  // That it can become a sender anyway is the difference from the Blind-Date desk next door.
  await registerUser(PERSONA);

  await setRole(PRIMORDIAL, "administrator");
  await setRole(ADMINISTRATOR, "administrator");
  await setRole(MODERATOR, "moderator");

  // Last, and only once the account exists to hold it: every other file that wants the seat waits
  // for it while this test runs, so it is held for as little of the fixture as possible.
  await borrowPrimordialSeat(PRIMORDIAL);

  return cookies;
}

Deno.test.afterEach(async () => {
  // The seat first: the CHECK constraint refuses a row that keeps the flag without the role, and
  // handing it back before deleting anything is simpler than reasoning about the order.
  await returnPrimordialSeat();

  await db.deleteFrom("user").where("username", "in", USERNAMES).execute();
});

Deno.test("the first administrator may release an account that is on no team", async () => {
  const cookies = await fixture();

  const response = await request(
    "POST",
    "/api/moderation/broadcast/senders",
    cookies.primordial,
    { username: PERSONA },
  );

  assertEquals(response.status, STATUS_CODE.OK);
});

Deno.test("the name is matched however it is capitalised", async () => {
  const cookies = await fixture();

  const response = await request(
    "POST",
    "/api/moderation/broadcast/senders",
    cookies.primordial,
    { username: PERSONA.toUpperCase() },
  );

  assertEquals(response.status, STATUS_CODE.OK);
});

Deno.test("a name that belongs to nobody is refused as not found", async () => {
  const cookies = await fixture();

  const response = await request(
    "POST",
    "/api/moderation/broadcast/senders",
    cookies.primordial,
    { username: "senders-test-nobody" },
  );

  assertEquals(response.status, STATUS_CODE.NotFound);
});

Deno.test("an ordinary administrator cannot release a sender", async () => {
  const cookies = await fixture();

  const response = await request(
    "POST",
    "/api/moderation/broadcast/senders",
    cookies.administrator,
    { username: PERSONA },
  );

  assertEquals(response.status, STATUS_CODE.Forbidden);
});

Deno.test("a moderator cannot reach this at all", async () => {
  const cookies = await fixture();

  const response = await request(
    "GET",
    "/api/moderation/broadcast/senders",
    cookies.moderator,
  );

  assertEquals(response.status, STATUS_CODE.Forbidden);
});

/**
 * The rule that would be lost first. Locking the list to the root administrator looks like
 * consistency with the granting next to it, and it would leave every other administrator unable to
 * choose a sender for the mail they are writing.
 */
Deno.test("an ordinary administrator may read the list", async () => {
  const cookies = await fixture();

  await request(
    "POST",
    "/api/moderation/broadcast/senders",
    cookies.primordial,
    { username: PERSONA },
  );

  const response = await request(
    "GET",
    "/api/moderation/broadcast/senders",
    cookies.administrator,
  );

  assertEquals(response.status, STATUS_CODE.OK);

  const senders = await response.json() as { username: string }[];

  assertEquals(
    senders.map((sender) => sender.username),
    [PRIMORDIAL, PERSONA],
    "the first administrator leads the list without having been released into it",
  );
});

Deno.test("releasing the same account twice is not an error", async () => {
  const cookies = await fixture();

  for (const _ of [1, 2]) {
    // deno-lint-ignore no-await-in-loop -- twice in a row is the thing being tested
    const response = await request(
      "POST",
      "/api/moderation/broadcast/senders",
      cookies.primordial,
      { username: PERSONA },
    );

    assertEquals(response.status, STATUS_CODE.OK);
  }

  const response = await request(
    "GET",
    "/api/moderation/broadcast/senders",
    cookies.primordial,
  );

  const senders = await response.json() as unknown[];

  assertEquals(senders.length, 2, "released once, listed once");
});

Deno.test("the first administrator cannot be released into the list", async () => {
  const cookies = await fixture();

  const response = await request(
    "POST",
    "/api/moderation/broadcast/senders",
    cookies.primordial,
    { username: PRIMORDIAL },
  );

  assertEquals(response.status, STATUS_CODE.Forbidden);
});

Deno.test("the first administrator cannot be withdrawn from the list", async () => {
  const cookies = await fixture();

  const response = await request(
    "DELETE",
    `/api/moderation/broadcast/senders/${await getUserId(PRIMORDIAL)}`,
    cookies.primordial,
  );

  assertEquals(response.status, STATUS_CODE.Forbidden);
});

Deno.test("a released account can be withdrawn again", async () => {
  const cookies = await fixture();

  await request(
    "POST",
    "/api/moderation/broadcast/senders",
    cookies.primordial,
    { username: PERSONA },
  );

  const response = await request(
    "DELETE",
    `/api/moderation/broadcast/senders/${await getUserId(PERSONA)}`,
    cookies.primordial,
  );

  assertEquals(response.status, STATUS_CODE.OK);

  const listing = await request(
    "GET",
    "/api/moderation/broadcast/senders",
    cookies.primordial,
  );

  const senders = await listing.json() as { username: string }[];

  assertEquals(
    senders.map((sender) => sender.username),
    [PRIMORDIAL],
    "the persona is gone and the permanent one remains",
  );
});

Deno.test("an ordinary administrator cannot withdraw a sender", async () => {
  const cookies = await fixture();

  await request(
    "POST",
    "/api/moderation/broadcast/senders",
    cookies.primordial,
    { username: PERSONA },
  );

  const response = await request(
    "DELETE",
    `/api/moderation/broadcast/senders/${await getUserId(PERSONA)}`,
    cookies.administrator,
  );

  assertEquals(response.status, STATUS_CODE.Forbidden);
});
