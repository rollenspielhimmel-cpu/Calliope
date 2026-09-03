import { assertEquals, assertFalse } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
} from "@/src/test/support.ts";

const author = "status-comments-list-author";
const other = "status-comments-list-other";

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(() => deleteUsers([author, other]));

async function createStatusUpdate(cookie: string) {
  const response = await request("POST", "/api/status-updates", cookie, {
    body: "Ein Status",
  });
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json();
}

Deno.test("GET /api/status-updates/{id}/comments lists oldest first", async () => {
  const cookie = await registerUser(author);
  const otherCookie = await registerUser(other);
  const statusUpdate = await createStatusUpdate(cookie);

  for (
    const [commenterCookie, body] of [
      [cookie, "eins"],
      [otherCookie, "zwei"],
      [cookie, "drei"],
    ] as const
  ) {
    // deno-lint-ignore no-await-in-loop -- sequential on purpose, one case per iteration
    const posted = await request(
      "POST",
      `/api/status-updates/${statusUpdate.id}/comments`,
      commenterCookie,
      { body },
    );
    assertEquals(posted.status, STATUS_CODE.Created);
  }

  const response = await request(
    "GET",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
  );

  assertEquals(response.status, STATUS_CODE.OK);
  const page = await response.json();
  assertEquals(
    page.results.map((comment: { body: string }) => comment.body),
    ["eins", "zwei", "drei"],
  );
  assertEquals(page.results[1].createdByUsername, other);
});

Deno.test("GET /api/status-updates/{id}/comments answers 404 for a status update that does not exist", async () => {
  const cookie = await registerUser(author);

  const response = await request(
    "GET",
    "/api/status-updates/01a00000-0000-7000-8000-00000000ffff/comments",
    cookie,
  );

  assertEquals(response.status, STATUS_CODE.NotFound);
});

Deno.test("GET /api/status-updates/{id}/comments needs a session", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);

  const response = await request(
    "GET",
    `/api/status-updates/${statusUpdate.id}/comments`,
    "",
  );

  assertEquals(response.status, STATUS_CODE.Unauthorized);
  assertFalse(response.headers.has("set-cookie"));
});
