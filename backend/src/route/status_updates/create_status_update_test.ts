import { assertEquals, assertFalse } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
} from "@/src/test/support.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";

const author = "status-create-author";

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(() => deleteUsers([author]));

Deno.test("POST /api/status-updates posts a status update", async () => {
  const cookie = await registerUser(author);

  const response = await request("POST", "/api/status-updates", cookie, {
    body: "Heute viel geschrieben.",
  });

  assertEquals(response.status, STATUS_CODE.Created);
  const created = await response.json();
  assertEquals(created.body, "Heute viel geschrieben.");
  assertEquals(created.createdByUsername, author);
  // Zero by construction: a status update cannot have a comment before it exists.
  assertEquals(created.commentCount, 0);
});

Deno.test("POST /api/status-updates trims the body", async () => {
  const cookie = await registerUser(author);

  const response = await request("POST", "/api/status-updates", cookie, {
    body: "  Pause bis morgen.  ",
  });

  assertEquals(response.status, STATUS_CODE.Created);
  assertEquals((await response.json()).body, "Pause bis morgen.");
});

Deno.test("POST /api/status-updates refuses a body of only whitespace", async () => {
  const cookie = await registerUser(author);

  const response = await request("POST", "/api/status-updates", cookie, {
    body: "   ",
  });

  assertEquals(response.status, STATUS_CODE.BadRequest);
});

Deno.test("POST /api/status-updates accepts a body at the limit", async () => {
  const cookie = await registerUser(author);
  const body = "a".repeat(TEXT_LIMIT.statusUpdateBody);

  const response = await request("POST", "/api/status-updates", cookie, {
    body,
  });

  assertEquals(response.status, STATUS_CODE.Created);
  assertEquals(
    (await response.json()).body.length,
    TEXT_LIMIT.statusUpdateBody,
  );
});

Deno.test("POST /api/status-updates refuses a body past the limit", async () => {
  const cookie = await registerUser(author);
  const body = "a".repeat(TEXT_LIMIT.statusUpdateBody + 1);

  const response = await request("POST", "/api/status-updates", cookie, {
    body,
  });

  assertEquals(response.status, STATUS_CODE.BadRequest);
});

Deno.test("POST /api/status-updates needs a session", async () => {
  const response = await request("POST", "/api/status-updates", "", {
    body: "Hallo",
  });

  assertEquals(response.status, STATUS_CODE.Unauthorized);
  assertFalse(response.headers.has("set-cookie"));
});
