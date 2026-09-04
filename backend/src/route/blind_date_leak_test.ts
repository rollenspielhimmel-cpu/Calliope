import { assert, assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  postBody,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * **The safeguard the whole feature rests on.**
 *
 * Pseudonymity is a display concern spread over every surface that names an author, and one that
 * forgets prints a real name that cannot be taken back. Concentrating the masking in
 * `pseudonym_service.ts` is necessary and not sufficient — what makes it trustworthy is this file,
 * which asks the *outside* question: given a Blind-Date group, does either real username appear in
 * any response a client can get?
 *
 * It asserts on response **bodies**, not on implementation. A new endpoint that returns anything
 * about such a group and forgets to mask is a failing test here rather than a disclosure, and
 * adding it to `EVERY_READ` below is the one thing anybody building on this has to remember.
 *
 * The usernames are deliberately unmistakable: a substring search for „zzz" cannot collide with a
 * fixture, a label, or a word in a German sentence.
 */

const first = "zzzalpha-blinddate";
const second = "zzzbeta-blinddate";
const outsider = "zzzgamma-blinddate";

/** What must never appear. Checked as substrings of the raw body. */
const REAL_NAMES = [first, second];

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  const ids = db
    .selectFrom("user")
    .select("id")
    .where("username", "in", [first, second, outsider]);

  await db.deleteFrom("blindDatePartner").where("userId", "in", ids).execute();
  await db
    .deleteFrom("blindDatePair")
    .where(
      "writingGroupId",
      "in",
      db.selectFrom("writingGroup").select("id").where(
        "title",
        "=",
        BLIND_DATE_TITLE,
      ),
    )
    .execute();
  await db
    .deleteFrom("writingGroup")
    .where("title", "=", BLIND_DATE_TITLE)
    .execute();

  await deleteUsers([first, second, outsider]);
});

const BLIND_DATE_TITLE = "Blind-Date Leck-Test";

/**
 * A Blind-Date as the matching tool will make one: a private group, both members joined with
 * their real accounts, a thread, a post from each, and the group marked pseudonymous.
 */
async function aBlindDate() {
  const firstCookie = await registerUser(first);
  const secondCookie = await registerUser(second);

  const firstId = await getUserId(first);
  const secondId = await getUserId(second);

  const group = await db
    .insertInto("writingGroup")
    .values({
      title: BLIND_DATE_TITLE,
      synopsis: "Zwei schreiben, ohne zu wissen, wer der andere ist.",
      visibility: "private",
      authorsArePseudonymous: true,
      createdBy: firstId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  for (
    const [userId, role] of [[firstId, "administrator"], [
      secondId,
      "writer",
    ]] as const
  ) {
    // deno-lint-ignore no-await-in-loop -- two rows, and the roles differ
    await db
      .insertInto("userInWritingGroup")
      .values({ writingGroupId: group.id, userId, role, status: "joined" })
      .execute();
  }

  const pair = await db
    .insertInto("blindDatePair")
    .values({ writingGroupId: group.id })
    .returning("id")
    .executeTakeFirstOrThrow();

  for (const userId of [firstId, secondId]) {
    // deno-lint-ignore no-await-in-loop -- two rows
    await db
      .insertInto("blindDatePartner")
      .values({ pairId: pair.id, userId })
      .execute();
  }

  const thread = await (await request(
    "POST",
    `/api/groups/${group.id}/threads`,
    firstCookie,
    { title: "Erster Thread" },
  )).json();

  for (const cookie of [firstCookie, secondCookie]) {
    // deno-lint-ignore no-await-in-loop -- one post each, in order
    await request(
      "POST",
      `/api/groups/${group.id}/threads/${thread.id}/posts`,
      cookie,
      postBody("Ein Absatz."),
    );
  }

  // A page, written by the *second* partner. Its service contains no masking at all: it came
  // from upstream, where there are no Blind-Dates, and it printed both real names until the
  // middleware in front of the subtree started masking it. It is here because a feature that
  // never heard of pseudonymity is the case worth testing.
  await request(
    "POST",
    `/api/groups/${group.id}/pages`,
    secondCookie,
    { title: "Ein Personenblatt", document: postBody("Notizen.").document },
  );

  return { groupId: group.id, threadId: thread.id, firstCookie, secondCookie };
}

/**
 * Every read that can return something about the group. **Adding an endpoint that touches a
 * writing group means adding it here** — that is what keeps this test honest as the product grows.
 */
function everyRead(groupId: string, threadId: string) {
  return [
    ["the group itself", "GET", `/api/groups/${groupId}`, undefined],
    ["its pages", "GET", `/api/groups/${groupId}/pages`, undefined],
    ["its members", "GET", `/api/groups/${groupId}/memberships`, undefined],
    ["its threads", "GET", `/api/groups/${groupId}/threads`, undefined],
    [
      "the thread",
      "GET",
      `/api/groups/${groupId}/threads/${threadId}`,
      undefined,
    ],
    [
      "its posts",
      "QUERY",
      `/api/groups/${groupId}/threads/${threadId}/posts`,
      { limit: 50, offset: 0, sortAttribute: "createdAt", sortOrder: "asc" },
    ],
    [
      "the group list",
      "QUERY",
      "/api/groups",
      {
        limit: 50,
        offset: 0,
        sortAttribute: "lastActivityAt",
        sortOrder: "desc",
      },
    ],
    ["the notifications", "QUERY", "/api/notifications", {
      limit: 50,
      offset: 0,
    }],
    ["the search", "QUERY", "/api/search", { search: "Blind-Date Leck" }],
  ] as const;
}

Deno.test("no read of a Blind-Date names either partner", async () => {
  const { groupId, threadId, firstCookie } = await aBlindDate();

  for (const [what, method, path, body] of everyRead(groupId, threadId)) {
    // deno-lint-ignore no-await-in-loop -- one request per surface, and the failure names which
    const response = await request(method, path, firstCookie, body);
    // deno-lint-ignore no-await-in-loop -- the body is what is under test
    const text = await response.text();

    for (const name of REAL_NAMES) {
      assert(
        !text.includes(name),
        `${what} (${method} ${path}) named "${name}" in its response`,
      );
    }
  }
});

Deno.test("the posts carry the pseudonym rather than nothing at all", async () => {
  const { groupId, threadId, firstCookie } = await aBlindDate();

  const posts = await (await request(
    "QUERY",
    `/api/groups/${groupId}/threads/${threadId}/posts`,
    firstCookie,
    { limit: 50, offset: 0, sortAttribute: "createdAt", sortOrder: "asc" },
  )).json();

  const names: string[] = posts.results.map((
    post: { createdByUsername: string },
  ) => post.createdByUsername);

  assertEquals(names.length, 2);
  // Two posts by two people must read as two people, or the group is unreadable.
  assertEquals(new Set(names).size, 2);
  assert(
    names.every((name) => name.startsWith("Blind-Date-Partner")),
    `expected pseudonyms, got ${JSON.stringify(names)}`,
  );
});

Deno.test("the member list hides the pictures too, and sorts by the pseudonym", async () => {
  const { groupId, firstCookie } = await aBlindDate();

  const { results: members } = await (await request(
    "GET",
    `/api/groups/${groupId}/memberships`,
    firstCookie,
  )).json();

  assertEquals(members.length, 2);
  // A picture identifies somebody at least as well as a name does.
  assert(
    members.every((member: { avatarUrl: string | null }) =>
      member.avatarUrl === null
    ),
    "a masked member still had an avatar",
  );
  assertEquals(
    members.map((member: { username: string }) => member.username),
    ["Blind-Date-Partner 1", "Blind-Date-Partner 2"],
  );
});

Deno.test("the reveal gives both names back without anything being migrated", async () => {
  const { groupId, threadId, firstCookie } = await aBlindDate();

  // What the reveal button will do: one flag, and the partner rows freed for a next Blind-Date.
  await db
    .updateTable("writingGroup")
    .set({ authorsArePseudonymous: false })
    .where("id", "=", groupId)
    .execute();

  const posts = await (await request(
    "QUERY",
    `/api/groups/${groupId}/threads/${threadId}/posts`,
    firstCookie,
    { limit: 50, offset: 0, sortAttribute: "createdAt", sortOrder: "asc" },
  )).json();

  const names: string[] = posts.results.map((
    post: { createdByUsername: string },
  ) => post.createdByUsername);

  // The same posts, the same rows, now under the names that wrote them.
  assertEquals(names.toSorted(), [first, second].toSorted());
});

Deno.test("an ordinary group is untouched by any of this", async () => {
  const cookie = await registerUser(outsider);

  const group = await (await request("POST", "/api/groups", cookie, {
    title: "Ganz gewöhnliche Gruppe",
    synopsis: "Nichts Besonderes.",
  })).json();

  const read = await request("GET", `/api/groups/${group.id}`, cookie);
  assertEquals(read.status, STATUS_CODE.OK);

  const body = await read.json();
  assertEquals(body.authorsArePseudonymous, false);
  assertEquals(body.createdByUsername, outsider);
});
