import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import app from "@/src/app.ts";
import { EMAIL_DOMAIN_BLOCKED } from "@/src/http/response.ts";

/**
 * The seeded list is what makes this worth a test: the migration ships the block already
 * populated, so a registration through a known throwaway provider has to be refused on a fresh
 * database with nobody having configured anything.
 */

const username = "blocked-domain-test-user";
const password = "a-complex-password";

function register(emailAddress: string) {
  return app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password, emailAddress }),
  });
}

Deno.test.afterEach(async () => {
  await db.deleteFrom("user").where("username", "=", username).execute();
});

Deno.test("a seeded throwaway domain cannot register", async () => {
  const response = await register("someone@mailinator.com");

  assertEquals(response.status, STATUS_CODE.UnprocessableEntity);
  assertEquals((await response.json()).code, EMAIL_DOMAIN_BLOCKED);
});

Deno.test("the check is on the domain, not the whole address", async () => {
  // `notmailinator.com` merely contains a blocked domain: matching by suffix or substring would
  // refuse it, and the same mistake would make blocking `mail.com` take `gmail.com` with it.
  const response = await register("someone@notmailinator.com");

  assertEquals(response.status, STATUS_CODE.OK);
});
