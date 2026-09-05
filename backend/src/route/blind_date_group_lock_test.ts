import { assertEquals } from "@std/assert";
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
 * The three things a running Blind-Date's group does not allow, and the fact that they come back.
 *
 * Both people are administrators of that group, so every one of these would ordinarily succeed —
 * which is exactly why it is worth a test. The refusal does not depend on rank, and a later change
 * to the group routes that reads only the role would pass its own tests and quietly reopen all
 * three.
 *
 * The second half matters as much as the first: **after the reveal the group is ordinary again.**
 * A lock that never lifts would be a different feature from the one that was asked for.
 */

const one = "bdlock-one";
const two = "bdlock-two";
const outsider = "bdlock-outsider";

const USERS = [one, two, outsider];

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  const ids = db.selectFrom("user").select("id").where("username", "in", USERS);

  const groupIds = (await db
    .selectFrom("userInWritingGroup")
    .select("writingGroupId")
    .where("userId", "in", ids)
    .execute()).map((row) => row.writingGroupId);

  await db.deleteFrom("blindDatePartner").where("userId", "in", ids).execute();

  if (groupIds.length > 0) {
    await db.deleteFrom("blindDatePair").where("writingGroupId", "in", groupIds)
      .execute();
    await db.deleteFrom("writingThread").where("writingGroupId", "in", groupIds)
      .execute();
    await db.deleteFrom("userInWritingGroup").where(
      "writingGroupId",
      "in",
      groupIds,
    ).execute();
    await db.deleteFrom("writingGroup").where("id", "in", groupIds).execute();
  }

  await deleteUsers(USERS);
});

/** A group as a match makes one: pseudonymous, both members administrators. */
async function aBlindDateGroup(): Promise<
  { groupId: string; threadId: string }
> {
  const group = await db
    .insertInto("writingGroup")
    .values({
      title: "Das Gasthaus am Moor",
      synopsis: "x",
      visibility: "private",
      authorsArePseudonymous: true,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const thread = await db
    .insertInto("writingThread")
    .values({ writingGroupId: group.id, title: "RPG-Thread" })
    .returning("id")
    .executeTakeFirstOrThrow();

  const pair = await db
    .insertInto("blindDatePair")
    .values({ writingGroupId: group.id, rpgThreadId: thread.id })
    .returning("id")
    .executeTakeFirstOrThrow();

  // Der Aufbau eines laufenden Blind-Dates: Mitgliedschaft und Partnerzeile gehören zusammen und
  // entstehen je Person nacheinander, damit die zweite nicht auf halb angelegten Zeilen der ersten
  // aufsetzt.
  for (const username of [one, two]) {
    // deno-lint-ignore no-await-in-loop -- die Kennung wird für beide Einfügungen darunter gebraucht
    const userId = await getUserId(username);
    // deno-lint-ignore no-await-in-loop -- eine Mitgliedschaft je Person
    await db
      .insertInto("userInWritingGroup")
      .values({
        writingGroupId: group.id,
        userId,
        role: "administrator",
        status: "joined",
      })
      .execute();
    // deno-lint-ignore no-await-in-loop -- und eine Partnerzeile zu derselben Person
    await db
      .insertInto("blindDatePartner")
      .values({ pairId: pair.id, userId })
      .execute();
  }

  return { groupId: group.id, threadId: thread.id };
}

Deno.test("an anonymous Blind-Date's group cannot be renamed, retitled or opened up", async () => {
  const cookie = await registerUser(one);
  await registerUser(two);
  const outsiderCookie = await registerUser(outsider);
  const { groupId, threadId } = await aBlindDateGroup();

  // All three by an administrator of the group, which is what both of them are.
  assertEquals(
    (await request("PATCH", `/api/groups/${groupId}`, cookie, {
      title: "Etwas, das mich verrät",
    })).status,
    STATUS_CODE.Forbidden,
  );

  assertEquals(
    (await request(
      "PATCH",
      `/api/groups/${groupId}/threads/${threadId}`,
      cookie,
      { title: "Auch das verrät mich" },
    )).status,
    STATUS_CODE.Forbidden,
  );

  assertEquals(
    (await request("POST", `/api/groups/${groupId}/memberships`, cookie, {
      userId: await getUserId(outsider),
      role: "writer",
    })).status,
    STATUS_CODE.Forbidden,
  );

  // And nothing happened: a refusal that half-applied would be worse than none.
  const group = await db
    .selectFrom("writingGroup")
    .select("title")
    .where("id", "=", groupId)
    .executeTakeFirstOrThrow();
  assertEquals(group.title, "Das Gasthaus am Moor");

  const members = await db
    .selectFrom("userInWritingGroup")
    .select("userId")
    .where("writingGroupId", "=", groupId)
    .execute();
  assertEquals(members.length, 2);

  // The outsider was never in it and still is not, by a different route.
  assertEquals(
    (await request("GET", `/api/groups/${groupId}`, outsiderCookie)).status,
    STATUS_CODE.NotFound,
  );
});

Deno.test("after the reveal the group is an ordinary one again", async () => {
  const cookie = await registerUser(one);
  await registerUser(two);
  await registerUser(outsider);
  const { groupId, threadId } = await aBlindDateGroup();

  // What the reveal does to the group, and the only thing this lock reads.
  await db
    .updateTable("writingGroup")
    .set({ authorsArePseudonymous: false })
    .where("id", "=", groupId)
    .execute();

  assertEquals(
    (await request("PATCH", `/api/groups/${groupId}`, cookie, {
      title: "Unsere Geschichte",
    })).status,
    STATUS_CODE.OK,
  );

  assertEquals(
    (await request(
      "PATCH",
      `/api/groups/${groupId}/threads/${threadId}`,
      cookie,
      { title: "Kapitel eins" },
    )).status,
    STATUS_CODE.OK,
  );

  assertEquals(
    (await request("POST", `/api/groups/${groupId}/memberships`, cookie, {
      userId: await getUserId(outsider),
      role: "writer",
    })).status,
    STATUS_CODE.Created,
  );
});

Deno.test("an ordinary group is untouched by this", async () => {
  const cookie = await registerUser(one);

  const group = await (await request("POST", "/api/groups", cookie, {
    title: "Ganz normale Gruppe",
    synopsis: "d",
    visibility: "private",
  })).json();

  assertEquals(
    (await request("PATCH", `/api/groups/${group.id}`, cookie, {
      title: "Umbenannt",
    })).status,
    STATUS_CODE.OK,
  );
});
