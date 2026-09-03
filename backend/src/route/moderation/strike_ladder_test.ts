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
 * The overview the three-strikes area is grouped by.
 *
 * Two things are worth pinning down. A **lapsed** suspension must not read as a current one — the
 * column keeps its date rather than being cleared, because the suspension expires on its own, so
 * "is this member suspended right now" is a comparison and not a null check. And a member with a
 * clean record must be **absent**: the page is the ladder, and listing the whole membership under
 * that heading would read as an accusation of everybody.
 */

const warned = "ladder-warned";
const struck = "ladder-struck";
const clean = "ladder-clean";
const operator = "ladder-operator";

const USERS = [warned, struck, clean, operator];

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  const ids = db.selectFrom("user").select("id").where("username", "in", USERS);
  await db.deleteFrom("strike").where("userId", "in", ids).execute();
  await db.deleteFrom("watchlistEntry").where("userId", "in", ids).execute();
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

async function strike(
  username: string,
  action: "warning" | "suspension",
  suspendedUntil: string | null = null,
) {
  await db
    .insertInto("strike")
    .values({
      userId: await getUserId(username),
      action,
      severity: "borderline",
      reason: "Testgrund",
      suspendedUntil,
    })
    .execute();
}

type Standing = {
  username: string;
  warnings: number;
  suspensions: number;
  suspendedUntil: string | null;
  watchlistNote: string | null;
};

const ladder = (cookie: string) =>
  request("GET", "/api/moderation/strike-ladder", cookie);

const standingOf = async (cookie: string, username: string) =>
  ((await (await ladder(cookie)).json()) as Standing[]).find(
    (one) => one.username === username,
  );

Deno.test("a member's rung is their two counts", async () => {
  const cookie = await asOperator();
  await registerUser(warned);

  await strike(warned, "warning");
  await strike(warned, "warning");

  const standing = await standingOf(cookie, warned);

  assertEquals(standing?.warnings, 2);
  assertEquals(standing?.suspensions, 0);
});

Deno.test("a clean record is absent from the ladder entirely", async () => {
  const cookie = await asOperator();
  await registerUser(clean);

  assertEquals(await standingOf(cookie, clean), undefined);
});

Deno.test("a running suspension is named; a lapsed one is not", async () => {
  const cookie = await asOperator();
  await registerUser(struck);

  const until = new Date(Date.now() + 86_400_000).toISOString();
  await strike(struck, "suspension", until);
  await db
    .updateTable("user")
    .set({ suspendedUntil: until, suspensionReason: "Testgrund" })
    .where("username", "=", struck)
    .execute();

  assert((await standingOf(cookie, struck))?.suspendedUntil !== null);

  // The date stays on the row after it passes — the suspension lapses on its own rather than
  // being cleared — so a null check here would call every past suspension a current one.
  await db
    .updateTable("user")
    .set({ suspendedUntil: new Date(Date.now() - 1_000).toISOString() })
    .where("username", "=", struck)
    .execute();

  const lapsed = await standingOf(cookie, struck);

  assertEquals(lapsed?.suspendedUntil, null);
  // Still on the ladder, and still counted: the strike happened.
  assertEquals(lapsed?.suspensions, 1);
});

Deno.test("the worst standing comes first", async () => {
  const cookie = await asOperator();
  await registerUser(warned);
  await registerUser(struck);

  await strike(warned, "warning");
  await strike(struck, "warning");
  await strike(struck, "warning");
  await strike(struck, "suspension");

  const rows = (await (await ladder(cookie)).json()) as Standing[];
  const names = rows.map((row) => row.username);

  const warnedAt = names.indexOf(warned);
  const struckAt = names.indexOf(struck);

  assert(
    warnedAt >= 0 && struckAt >= 0,
    "both members should be on the ladder",
  );
  assert(
    struckAt < warnedAt,
    "the suspended member should sort above the warned one",
  );
});

Deno.test("the watchlist note travels with the standing", async () => {
  const cookie = await asOperator();
  await registerUser(warned);

  await strike(warned, "warning");
  await db
    .insertInto("watchlistEntry")
    .values({ userId: await getUserId(warned), note: "Im Auge behalten" })
    .execute();

  // The two lists are read together, which is the whole point of putting them on one page.
  assertEquals(
    (await standingOf(cookie, warned))?.watchlistNote,
    "Im Auge behalten",
  );
});

Deno.test("an ordinary member cannot read the ladder", async () => {
  const cookie = await registerUser(clean);

  assertEquals((await ladder(cookie)).status, STATUS_CODE.Forbidden);
});
