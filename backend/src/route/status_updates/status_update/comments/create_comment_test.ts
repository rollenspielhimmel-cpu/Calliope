import { assertEquals, assertFalse } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
} from "@/src/test/support.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";

const author = "status-comments-create-author";
const commenter = "status-comments-create-commenter";

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(() => deleteUsers([author, commenter]));

async function createStatusUpdate(cookie: string) {
  const response = await request("POST", "/api/status-updates", cookie, {
    body: "Ein Status",
  });
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json();
}

Deno.test("POST /api/status-updates/{id}/comments adds a comment", async () => {
  const cookie = await registerUser(author);
  const commenterCookie = await registerUser(commenter);
  const statusUpdate = await createStatusUpdate(cookie);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    commenterCookie,
    { body: "Schön geschrieben!" },
  );

  assertEquals(response.status, STATUS_CODE.Created);
  const created = await response.json();
  assertEquals(created.body, "Schön geschrieben!");
  assertEquals(created.statusUpdateId, statusUpdate.id);
  assertEquals(created.createdByUsername, commenter);
});

Deno.test("POST /api/status-updates/{id}/comments trims the body", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body: "  Danke!  " },
  );

  assertEquals(response.status, STATUS_CODE.Created);
  assertEquals((await response.json()).body, "Danke!");
});

Deno.test("POST /api/status-updates/{id}/comments refuses a body of only whitespace", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body: "   " },
  );

  assertEquals(response.status, STATUS_CODE.BadRequest);
});

Deno.test("POST /api/status-updates/{id}/comments accepts a body at the limit", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);
  const body = "a".repeat(TEXT_LIMIT.statusUpdateCommentBody);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body },
  );

  assertEquals(response.status, STATUS_CODE.Created);
  assertEquals(
    (await response.json()).body.length,
    TEXT_LIMIT.statusUpdateCommentBody,
  );
});

Deno.test("POST /api/status-updates/{id}/comments refuses a body past the limit", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);
  const body = "a".repeat(TEXT_LIMIT.statusUpdateCommentBody + 1);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body },
  );

  assertEquals(response.status, STATUS_CODE.BadRequest);
});

Deno.test("POST /api/status-updates/{id}/comments answers 404 for a status update that does not exist", async () => {
  const cookie = await registerUser(author);

  const response = await request(
    "POST",
    "/api/status-updates/01a00000-0000-7000-8000-00000000ffff/comments",
    cookie,
    { body: "Hallo" },
  );

  assertEquals(response.status, STATUS_CODE.NotFound);
});

Deno.test("POST /api/status-updates/{id}/comments needs a session", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    "",
    { body: "Hallo" },
  );

  assertEquals(response.status, STATUS_CODE.Unauthorized);
  assertFalse(response.headers.has("set-cookie"));
});
