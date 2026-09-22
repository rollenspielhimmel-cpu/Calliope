import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import app from "@/src/app.ts";
import { db } from "@/src/database/client.ts";
import { clearRateLimits, deleteUsers } from "@/src/test/support.ts";
import { authFixture, sessionCookie } from "@/src/test/auth.ts";

// Its own account, so a file running beside this one cannot register or delete it.
const { emailAddress, register, username } = authFixture("me");

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(() => deleteUsers([username]));

Deno.test("GET /api/auth/me reports the signed-in user", async () => {
  const cookie = sessionCookie(await register());

  const response = await app.request("/api/auth/me", { headers: { cookie } });

  assertEquals(response.status, STATUS_CODE.OK);
  const body = await response.json();
  assertEquals(body.username, username);
  assertEquals(body.emailAddress, emailAddress);
  // The password hash must not leak through the response schema.
  assertEquals(Object.keys(body).toSorted(), [
    "avatarUrl",
    "emailAddress",
    "emailAddressVerifiedAt",
    "id",
    "isPrimordialAdmin",
    "mayPreparePublications",
    "platformRole",
    "unreadNotifications",
    "username",
  ]);
  assertEquals(body.unreadNotifications, 0);
  // Null for an ordinary member, which is what a freshly registered account is.
  assertEquals(body.platformRole, null);
  assertEquals(body.mayPreparePublications, false);
});

Deno.test("GET /api/auth/me rejects a request without a session", async () => {
  const response = await app.request("/api/auth/me");

  assertEquals(response.status, STATUS_CODE.Unauthorized);
  assertEquals(await response.json(), { error: "Unauthorized" });
});

Deno.test("GET /api/auth/me treats a malformed session cookie as no session", async () => {
  // The id half reaches a uuid column. Passing it through unchecked made every request with
  // a corrupted cookie answer 500 rather than simply being unauthenticated.
  for (
    const cookie of [
      "session=abc",
      "session=abc.def",
      "session=.only-a-secret",
      "session=01a019ee-ab02-7a82-9796-3767b50ed584",
    ]
  ) {
    // deno-lint-ignore no-await-in-loop -- sequential on purpose, one case per iteration
    const response = await app.request("/api/auth/me", { headers: { cookie } });

    assertEquals(
      response.status,
      STATUS_CODE.Unauthorized,
      `expected ${cookie} to be unauthorised`,
    );
    // deno-lint-ignore no-await-in-loop -- sequential on purpose, one case per iteration
    await response.body?.cancel();
  }
});

/**
 * **Die Berechtigung kommt aus der Tabelle, nicht aus dem Rollennamen.** Ein Mod hat sie, weil die
 * Migration `moderator` die Zeile gegeben hat — gelesen mit der Sitzung, auf dem Weg, den jede
 * Prüfung nimmt. Die Gegenprobe ist das Mitglied im ersten Test.
 */
Deno.test("GET /api/auth/me tells a moderator they may prepare publications", async () => {
  const cookie = sessionCookie(await register());
  await db
    .updateTable("user")
    .set({ platformRole: "moderator" })
    .where("username", "=", username)
    .execute();

  const response = await app.request("/api/auth/me", { headers: { cookie } });
  const body = await response.json();

  assertEquals(body.platformRole, "moderator");
  assertEquals(body.mayPreparePublications, true);
});
