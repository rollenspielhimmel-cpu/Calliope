import { assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { Hono } from "hono";
import { db } from "@/src/database/client.ts";
import { type User, UserService } from "@/src/service/user_service.ts";
import { ACCOUNT_BANNED, ACCOUNT_SUSPENDED } from "@/src/http/response.ts";
import authenticated from "./authenticated.ts";

/**
 * The order the two refusals are written in is the thing under test. A ban is final and its note
 * is written for operators, so it says nothing; a suspension ends by itself and is meant to
 * correct, so it says when and why. Swapping them would tell a banned member to wait for a date
 * that means nothing — which is exactly the mistake this file exists to catch.
 */

const username = "suspension-test-user";
const password = "a-complex-password";
const emailAddress = "suspension-test-user@example.com";

const app = new Hono<{ Variables: { user: User } }>()
  .use(authenticated)
  .get("/probe", (c) => c.json({ username: c.get("user").username }));

async function createUserWithSession() {
  const user = await UserService.insertUser(username, password, emailAddress);
  assertExists(user, "fixture user could not be created");

  await db
    .updateTable("user")
    .set({ emailAddressVerifiedAt: Temporal.Now.instant().toString() })
    .where("id", "=", user.id)
    .execute();

  const session = await UserService.insertSessionForUser(user, {
    userAgent: undefined,
    ipAddress: undefined,
  });

  return { user, session };
}

function probe(session: { id: string; token: string }) {
  return app.request("/probe", {
    headers: { cookie: `session=${session.id}.${session.token}` },
  });
}

async function suspend(userId: string, until: string, reason: string) {
  await db
    .updateTable("user")
    .set({ suspendedUntil: until, suspensionReason: reason })
    .where("id", "=", userId)
    .execute();
}

Deno.test.afterEach(async () => {
  await db.deleteFrom("user").where("username", "=", username).execute();
});

Deno.test("a suspension in force is refused, with the moment it ends and the reason", async () => {
  const { user, session } = await createUserWithSession();
  const until = Temporal.Now.instant().add({ hours: 24 }).toString();
  await suspend(user.id, until, "Wiederholt persönlich geworden");

  const response = await probe(session);
  const body = await response.json();

  assertEquals(response.status, STATUS_CODE.Forbidden);
  assertEquals(body.code, ACCOUNT_SUSPENDED);
  // Both, deliberately: a suspension is corrective, so it says what to correct and until when.
  // Compared as an instant rather than as text, because the column keeps microseconds and the
  // value written here has nanoseconds — the same moment, spelled differently.
  assertEquals(
    Temporal.Instant.from(body.suspendedUntil).epochMilliseconds,
    Temporal.Instant.from(until).epochMilliseconds,
  );
  assertEquals(body.reason, "Wiederholt persönlich geworden");
});

Deno.test("a suspension whose moment has passed lets the member back in", async () => {
  const { user, session } = await createUserWithSession();
  // Left behind on purpose rather than cleaned up: the columns are the record that there was
  // one, and the moment itself is what decides — there is no expiry job.
  await suspend(
    user.id,
    Temporal.Now.instant().subtract({ minutes: 1 }).toString(),
    "Abgelaufen",
  );

  const response = await probe(session);

  assertEquals(response.status, STATUS_CODE.OK);
  assertEquals(await response.json(), { username });
});

Deno.test("a ban answers before a suspension, and discloses nothing", async () => {
  const { user, session } = await createUserWithSession();

  // Both set at once — a third strike escalated into a ban — which is the case that decides
  // which check has to come first.
  await suspend(
    user.id,
    Temporal.Now.instant().add({ hours: 24 }).toString(),
    "Diese Begründung darf nicht ausgeliefert werden",
  );
  await db
    .updateTable("user")
    .set({
      bannedAt: Temporal.Now.instant().toString(),
      banReason: "Endgültig",
    })
    .where("id", "=", user.id)
    .execute();

  const response = await probe(session);
  const body = await response.json();

  assertEquals(response.status, STATUS_CODE.Forbidden);
  assertEquals(body.code, ACCOUNT_BANNED);
  // The ban's own rule, which the suspension must not leak around: no reason, no date.
  assertEquals(body.reason, undefined);
  assertEquals(body.suspendedUntil, undefined);
});
