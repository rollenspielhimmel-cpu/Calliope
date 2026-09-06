import { assert, assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import { registerUser, request, scopedTestData } from "@/src/test/support.ts";
import { borrowPrimordialSeat } from "@/src/test/primordial_seat.ts";

/**
 * Das Postfach der Administration.
 *
 * **Was hier festgehalten wird, ist der Zweck des Orts:** Nichts soll untergehen. Also steht darin,
 * worauf jemand reagieren muss, und nichts, was bloß zugestellt wurde — sonst zeigte die Liste den
 * Empfängerkreis jeder Rundmail und versteckte die paar echten Nachrichten darin.
 *
 * Und die Marke am Gespräch ist die Sperre: Ohne sie wäre eine Gesprächskennung ein Schlüssel zu
 * jedem privaten Chat der Plattform.
 */

const ROOT = "ai-root";
const MEMBER = "ai-member";
const SILENT = "ai-silent";
const MODERATOR = "ai-moderator";
const OUTSIDER = "ai-outsider";

const USERS = [ROOT, MEMBER, SILENT, MODERATOR, OUTSIDER];

const SUBJECT = "Postfach-Test";
const BODY = "Bitte einmal zurückschreiben.";
const REPLY = "Ich hätte da eine Frage.";
const ANSWER = "Gern — hier ist die Antwort.";

async function setRole(
  username: string,
  role: "administrator" | "moderator" | null,
) {
  await db
    .updateTable("user")
    .set({ platformRole: role })
    .where("username", "=", username)
    .execute();
}

const data = scopedTestData({
  users: USERS,
  seat: ROOT,
  remove: async (transaction) => {
    await transaction
      .deleteFrom("publication")
      .where(
        "id",
        "in",
        transaction
          .selectFrom("broadcast")
          .select("publicationId")
          .where("subject", "=", SUBJECT),
      )
      .execute();
  },
});

const cleanUp = data.cleanUp;

function fixture() {
  return data.freshly(async () => {
    const cookies = {
      root: await registerUser(ROOT),
      member: await registerUser(MEMBER),
      silent: await registerUser(SILENT),
      moderator: await registerUser(MODERATOR),
      outsider: await registerUser(OUTSIDER),
    };

    await setRole(ROOT, "administrator");
    await setRole(MEMBER, "administrator");
    await setRole(SILENT, "administrator");
    await setRole(MODERATOR, "moderator");
    await setRole(OUTSIDER, null);

    await borrowPrimordialSeat(ROOT);

    return cookies;
  });
}

/** Eine Rundmail an die Administration, nur ins Postfach. */
async function sendBroadcast(cookie: string) {
  const response = await request(
    "POST",
    "/api/moderation/broadcast/queue",
    cookie,
    {
      subject: SUBJECT,
      body: BODY,
      audienceRoles: ["administrator"],
      memberIds: [],
      includeUnverified: false,
      deliverToInbox: true,
      deliverByEmail: false,
      publishInArchive: false,
      sendAsUserId: null,
      scheduledFor: null,
    },
  );

  assertEquals(response.status, STATUS_CODE.Created);

  const broadcast = await db
    .selectFrom("broadcast")
    .select("id")
    .where("subject", "=", SUBJECT)
    .executeTakeFirstOrThrow();

  return broadcast.id;
}

async function chatOf(broadcastId: string, username: string) {
  const chat = await db
    .selectFrom("chatGroup")
    .innerJoin(
      "userInChatGroup",
      "userInChatGroup.chatGroupId",
      "chatGroup.id",
    )
    .innerJoin("user", "user.id", "userInChatGroup.userId")
    .select("chatGroup.id")
    .where("chatGroup.broadcastId", "=", broadcastId)
    .where("user.username", "=", username)
    .executeTakeFirstOrThrow();

  return chat.id;
}

/** Das Mitglied schreibt — über den gewöhnlichen Chat-Weg, denn mehr ist es nicht. */
function write(cookie: string, chatGroupId: string, text: string) {
  return request("POST", `/api/chats/${chatGroupId}/messages`, cookie, {
    text,
  });
}

/** Die Administration antwortet, über die Rundmail. */
function answer(
  cookie: string,
  broadcastId: string,
  chatGroupId: string,
  text: string,
) {
  return request(
    "POST",
    `/api/moderation/broadcast/${broadcastId}/replies/${chatGroupId}`,
    cookie,
    { text },
  );
}

function inbox(cookie: string) {
  return request("GET", "/api/moderation/inbox", cookie);
}

type Entry = {
  chatGroupId: string;
  username: string | null;
  excerpt: string;
  lastMessageAt: string;
  awaitingReply: boolean;
  broadcastId: string | null;
};

/** Nur die Gespräche dieser Datei — andere Läufe legen ihre eigenen an. */
function ours(results: Entry[]): Entry[] {
  return results.filter((row) =>
    row.username !== null && USERS.includes(row.username)
  );
}

Deno.test("was zurückkommt, liegt im Postfach", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    await write(cookies.member, await chatOf(broadcastId, MEMBER), REPLY);

    const response = await inbox(cookies.root);
    assertEquals(response.status, STATUS_CODE.OK);

    const { results } = await response.json();
    const mine = ours(results);

    assertEquals(mine.length, 1);

    const [entry] = mine;
    assertExists(entry);
    assertEquals(entry.username, MEMBER);
    assertEquals(entry.excerpt, REPLY);

    // Die Rundmail steht dabei, damit die Zeile sagt, woher das Gespräch kommt.
    assertEquals(entry.broadcastId, broadcastId);
  } finally {
    await cleanUp();
  }
});

Deno.test("bloß zugestellt ist nicht dasselbe wie gemeldet", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    await write(cookies.member, await chatOf(broadcastId, MEMBER), REPLY);

    const { results } = await (await inbox(cookies.root)).json();
    const names = ours(results).map((row) => row.username);

    // **Der Kern des Orts.** SILENT hat die Rundmail bekommen und nichts geschrieben; sein Gespräch
    // ist die Zustellung. Stünde es hier, zeigte das Postfach den Empfängerkreis jeder Rundmail und
    // versteckte darin das eine, worauf jemand antworten muss.
    assert(!names.includes(SILENT));
    assert(!names.includes(ROOT));
  } finally {
    await cleanUp();
  }
});

Deno.test("offen heißt: die letzte Nachricht ist noch vom Mitglied", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    await write(cookies.member, chatGroupId, REPLY);

    const [before] = ours((await (await inbox(cookies.root)).json()).results);
    assertExists(before);
    assertEquals(before.awaitingReply, true);

    await answer(cookies.silent, broadcastId, chatGroupId, ANSWER);

    const [after] = ours((await (await inbox(cookies.root)).json()).results);
    assertExists(after);

    // Kein Merker, den jemand pflegen müsste: Die Antwort fällt aus dem Verlauf selbst heraus.
    assertEquals(after.awaitingReply, false);

    // Und der Zeitpunkt bleibt der des Mitglieds — sonst rutschte das Gespräch nach oben, weil wir
    // selbst geschrieben haben, über einem Auszug von vorher.
    assertEquals(after.lastMessageAt, before.lastMessageAt);
    assertEquals(after.excerpt, REPLY);
  } finally {
    await cleanUp();
  }
});

Deno.test("der Verlauf zeigt beide Seiten und den Verfasser", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    await write(cookies.member, chatGroupId, REPLY);
    await answer(cookies.silent, broadcastId, chatGroupId, ANSWER);

    const response = await request(
      "GET",
      `/api/moderation/inbox/${chatGroupId}`,
      cookies.root,
    );

    assertEquals(response.status, STATUS_CODE.OK);

    const conversation = await response.json();
    assertEquals(conversation.username, MEMBER);
    assertEquals(conversation.broadcastId, broadcastId);

    const announcement = conversation.messages.find(
      (message: { text: string }) => message.text === BODY,
    );
    assertExists(announcement);
    assertEquals(announcement.fromTeam, true);
    // Ihr Verfasser steht auf der Veröffentlichung und wird unter „Gesendete" gezeigt.
    assertEquals(announcement.writtenByUsername, null);

    const fromMember = conversation.messages.find(
      (message: { text: string }) => message.text === REPLY,
    );
    assertExists(fromMember);
    assertEquals(fromMember.fromTeam, false);

    const fromTeam = conversation.messages.find(
      (message: { text: string }) => message.text === ANSWER,
    );
    assertExists(fromTeam);
    assertEquals(fromTeam.fromTeam, true);

    // Nach außen der Absender, nach innen der Mensch.
    assertEquals(fromTeam.username, ROOT);
    assertEquals(fromTeam.writtenByUsername, SILENT);
  } finally {
    await cleanUp();
  }
});

Deno.test("ein fremdes Gespräch lässt sich nicht über das Postfach aufmachen", async () => {
  const cookies = await fixture();

  try {
    const created = await request("POST", "/api/chats", cookies.outsider, {
      title: "Privat",
    });
    assertEquals(created.status, STATUS_CODE.Created);
    const privateChat = await created.json();

    const response = await request(
      "GET",
      `/api/moderation/inbox/${privateChat.id}`,
      cookies.root,
    );

    // **Die Marke ist die Sperre.** Ohne sie wäre das eine Kennung, mit der die Administration
    // jeden privaten Chat der Plattform aufmachen könnte.
    assertEquals(response.status, STATUS_CODE.NotFound);
  } finally {
    await cleanUp();
  }
});

Deno.test("die Moderation kommt nicht an das Postfach", async () => {
  const cookies = await fixture();

  try {
    assertEquals(
      (await inbox(cookies.moderator)).status,
      STATUS_CODE.Forbidden,
    );
  } finally {
    await cleanUp();
  }
});

Deno.test("ein gewöhnliches Mitglied erst recht nicht", async () => {
  const cookies = await fixture();

  try {
    assertEquals((await inbox(cookies.outsider)).status, STATUS_CODE.Forbidden);
  } finally {
    await cleanUp();
  }
});
