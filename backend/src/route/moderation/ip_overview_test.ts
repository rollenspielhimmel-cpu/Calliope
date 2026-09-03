import { Buffer } from "node:buffer";
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
 * The address tool's first and third tabs.
 *
 * What is worth holding here is the counting. „Mögliche Nebenaccounts" is a de-duplication across
 * every address a member holds — two accounts meeting this one on two addresses are two names, not
 * four — and the third tab's `accountCount` is `count(distinct user_id)`, not a row count, or a
 * member with forty sessions from home would look like forty accounts sharing an address.
 *
 * Its own accounts and its own addresses: the suite runs `--parallel`, and the third tab is a
 * question about *every* address in the table, so a neighbouring file's rows would be in the answer
 * if the assertions were not scoped to these three.
 */

const alice = "ip-overview-alice";
const bob = "ip-overview-bob";
const carol = "ip-overview-carol";

/** Documentation range, and distinct from `RATE_LIMIT_TEST_CLIENTS` so nothing collides. */
const SHARED_ADDRESS = "203.0.113.77";
const ALICE_ONLY = "203.0.113.78";

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  await db
    .deleteFrom("userSession")
    .where("ipAddress", "in", [SHARED_ADDRESS, ALICE_ONLY])
    .execute();

  await deleteUsers([alice, bob, carol]);
});

/**
 * A session row written straight into the table: registering does create one, but not from an
 * address this file controls, and the whole question here is which address.
 */
async function seenFrom(username: string, ipAddress: string) {
  await db
    .insertInto("userSession")
    .values({
      userId: await getUserId(username),
      ipAddress,
      // The columns a session needs beyond the two under test. The token is never used to
      // authenticate anything here — these rows exist to be counted, not to be signed in with.
      hashedToken: Buffer.from(crypto.randomUUID()),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .execute();
}

const overview = (cookie: string, search?: string) =>
  request("QUERY", "/api/moderation/ip-overview", cookie, {
    limit: 100,
    offset: 0,
    sortAttribute: "username",
    sortOrder: "asc",
    ...(search === undefined ? {} : { search }),
  });

const sharedAddresses = (cookie: string) =>
  request("QUERY", "/api/moderation/shared-ip-addresses", cookie, {
    limit: 100,
    offset: 0,
    sortAttribute: "accountCount",
    sortOrder: "desc",
  });

async function asModerator(username: string): Promise<string> {
  const cookie = await registerUser(username);
  await db
    .updateTable("user")
    .set({ platformRole: "moderator" })
    .where("username", "=", username)
    .execute();
  return cookie;
}

type OverviewRow = {
  username: string;
  ipAddresses: string[];
  possibleAlts: { username: string }[];
};

type SharedRow = {
  ipAddress: string;
  accountCount: number;
  accounts: { username: string; emailAddress: string }[];
};

Deno.test("the overview names a member's addresses and who else used them", async () => {
  const cookie = await asModerator(alice);
  await registerUser(bob);

  await seenFrom(alice, SHARED_ADDRESS);
  await seenFrom(alice, ALICE_ONLY);
  await seenFrom(bob, SHARED_ADDRESS);

  const body = await (await overview(cookie, alice)).json();
  const row: OverviewRow = body.results[0];

  assertEquals(row.username, alice);
  // Sorted on both sides: .77 before .78, which is the order `toSorted` puts them in.
  assertEquals(row.ipAddresses.toSorted(), [SHARED_ADDRESS, ALICE_ONLY]);
  assertEquals(row.possibleAlts.map((alt) => alt.username), [bob]);
});

Deno.test("an account met on two addresses is named once, not twice", async () => {
  const cookie = await asModerator(alice);
  await registerUser(bob);

  // Both accounts on both addresses: the naive version counts the pairs and says "bob, bob".
  await seenFrom(alice, SHARED_ADDRESS);
  await seenFrom(alice, ALICE_ONLY);
  await seenFrom(bob, SHARED_ADDRESS);
  await seenFrom(bob, ALICE_ONLY);

  const body = await (await overview(cookie, alice)).json();
  const row: OverviewRow = body.results[0];

  assertEquals(row.possibleAlts.map((alt) => alt.username), [bob]);
});

Deno.test("a member with no session at all is still in the overview", async () => {
  const cookie = await asModerator(alice);

  // The tab is "every member". Leaving these out would quietly make it another question.
  const body = await (await overview(cookie, alice)).json();
  const row: OverviewRow = body.results[0];

  assertEquals(row.username, alice);
  assertEquals(row.ipAddresses, []);
  assertEquals(row.possibleAlts, []);
});

Deno.test("the shared-address tab shows an address two accounts used, with both of them", async () => {
  const cookie = await asModerator(alice);
  await registerUser(bob);

  await seenFrom(alice, SHARED_ADDRESS);
  await seenFrom(bob, SHARED_ADDRESS);

  const body = await (await sharedAddresses(cookie)).json();
  const row: SharedRow | undefined = body.results.find(
    (one: SharedRow) => one.ipAddress === SHARED_ADDRESS,
  );

  assert(row !== undefined, "the shared address is missing from the tab");
  assertEquals(row.accountCount, 2);
  assertEquals(row.accounts.map((account) => account.username).toSorted(), [
    alice,
    bob,
  ]);
  // The email addresses are the point of the row: two names alone are far harder to judge.
  assert(row.accounts.every((account) => account.emailAddress.includes("@")));
});

Deno.test("an address only one account used is not a match, however many sessions it holds", async () => {
  const cookie = await asModerator(alice);

  await seenFrom(alice, ALICE_ONLY);
  await seenFrom(alice, ALICE_ONLY);
  await seenFrom(alice, ALICE_ONLY);

  const body = await (await sharedAddresses(cookie)).json();

  // `count(distinct user_id)`, not a row count — three sessions from home are one account.
  assertEquals(
    body.results.some((row: SharedRow) => row.ipAddress === ALICE_ONLY),
    false,
  );
});

Deno.test("a third account on the same address raises the count to three", async () => {
  const cookie = await asModerator(alice);
  await registerUser(bob);
  await registerUser(carol);

  await seenFrom(alice, SHARED_ADDRESS);
  await seenFrom(bob, SHARED_ADDRESS);
  await seenFrom(carol, SHARED_ADDRESS);

  const body = await (await sharedAddresses(cookie)).json();
  const row: SharedRow | undefined = body.results.find(
    (one: SharedRow) => one.ipAddress === SHARED_ADDRESS,
  );

  assertEquals(row?.accountCount, 3);
  assertEquals(row?.accounts.length, 3);
});

Deno.test("an ordinary member sees neither tab", async () => {
  const cookie = await registerUser(alice);

  assertEquals((await overview(cookie)).status, STATUS_CODE.Forbidden);
  assertEquals((await sharedAddresses(cookie)).status, STATUS_CODE.Forbidden);
});
