import { assert, assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
} from "@/src/test/support.ts";
import {
  borrowPrimordialSeat,
  returnPrimordialSeat,
} from "@/src/test/primordial_seat.ts";

/**
 * Antworten auf eine Rundmail, wie das Team sie liest.
 *
 * **Was hier wirklich geprüft wird, ist die Zuordnung.** Antworten hängen an der Rundmail und nicht
 * an einem Konto — sonst lägen sie im Postfach des Ur-Admins, in das niemand sieht, oder in dem
 * einer Kunstfigur, das es nur an Weihnachten gibt. Und die Rundmail steht mit in der Adresse, weil
 * eine Gesprächskennung ohne sie ein Schlüssel zu jedem privaten Chat der Plattform wäre.
 */

const ROOT = "br-root";
const MEMBER = "br-member";
const SILENT = "br-silent";
const MODERATOR = "br-moderator";
const OUTSIDER = "br-outsider";

const USERS = [ROOT, MEMBER, SILENT, MODERATOR, OUTSIDER];

const SUBJECT = "Antwort-Test";
const BODY = "Bitte einmal zurückschreiben.";
const REPLY = "Alles klar, danke für die Ankündigung.";

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

/**
 * Ein Absender, zwei Empfänger und zwei Zaungäste.
 *
 * **SILENT antwortet nicht**, und das ist die Aussage der Liste: Jeder Empfänger hat ein Gespräch,
 * denn das *ist* die Zustellung. Stünden alle darin, zeigte die Liste den Empfängerkreis noch
 * einmal und versteckte die paar Antworten darin.
 *
 * **OUTSIDER ist gewöhnliches Mitglied** und darf gar nichts davon sehen; MODERATOR darf lesen,
 * ohne antworten zu dürfen.
 */
async function fixture() {
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
}

async function cleanUp() {
  await db
    .deleteFrom("publication")
    .where(
      "id",
      "in",
      db
        .selectFrom("broadcast")
        .select("publicationId")
        .where("subject", "=", SUBJECT),
    )
    .execute();

  await returnPrimordialSeat(ROOT);
  await deleteUsers(USERS);
  await clearRateLimits();
}

/** Verschickt an die Administration, nur ins Postfach. */
async function sendBroadcast(cookie: string) {
  const response = await request(
    "POST",
    "/api/moderation/broadcast/queue",
    cookie,
    {
      subject: SUBJECT,
      body: BODY,
      audienceGroups: ["administrator"],
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

  const broadcasts = await db
    .selectFrom("broadcast")
    .select("id")
    .where("subject", "=", SUBJECT)
    .execute();

  assertEquals(broadcasts.length, 1);

  const [broadcast] = broadcasts;
  assertExists(broadcast);

  return broadcast.id;
}

/** Das Gespräch, das dieses Mitglied bekommen hat. */
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

/** Das Mitglied antwortet — über den gewöhnlichen Chat-Weg, denn mehr ist es nicht. */
async function reply(cookie: string, chatGroupId: string, text: string) {
  return await request(
    "POST",
    `/api/chats/${chatGroupId}/messages`,
    cookie,
    { text },
  );
}

Deno.test("nur wer geantwortet hat, steht in der Liste", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);

    const sent = await reply(
      cookies.member,
      await chatOf(broadcastId, MEMBER),
      REPLY,
    );
    assertEquals(sent.status, STATUS_CODE.Created);

    const response = await request(
      "GET",
      `/api/moderation/broadcast/${broadcastId}/replies`,
      cookies.root,
    );

    assertEquals(response.status, STATUS_CODE.OK);

    const { results } = await response.json();
    const names = results.map((row: { username: string }) => row.username);

    assert(names.includes(MEMBER));
    // Und SILENT nicht, obwohl er die Rundmail bekommen hat: Ein Gespräch ist die Zustellung, keine
    // Antwort.
    assert(!names.includes(SILENT));
    assert(!names.includes(ROOT));
  } finally {
    await cleanUp();
  }
});

Deno.test("die Liste zeigt den Anfang der Antwort", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);

    await reply(cookies.member, await chatOf(broadcastId, MEMBER), REPLY);

    const response = await request(
      "GET",
      `/api/moderation/broadcast/${broadcastId}/replies`,
      cookies.root,
    );

    const { results } = await response.json();
    assertEquals(results.length, 1);

    const [entry] = results;
    assertEquals(entry.excerpt, REPLY);
    // Der Text der Rundmail selbst darf hier nicht stehen — das wäre die eigene Ankündigung, als
    // Antwort ausgegeben.
    assert(entry.excerpt !== BODY);
  } finally {
    await cleanUp();
  }
});

Deno.test("die Moderation darf lesen", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    await reply(cookies.member, await chatOf(broadcastId, MEMBER), REPLY);

    const response = await request(
      "GET",
      `/api/moderation/broadcast/${broadcastId}/replies`,
      cookies.moderator,
    );

    // Wer beobachtet, wie es der Community geht, muss sehen, was zurückkommt. Antworten darf sie
    // deshalb noch lange nicht.
    assertEquals(response.status, STATUS_CODE.OK);
  } finally {
    await cleanUp();
  }
});

Deno.test("ein gewöhnliches Mitglied darf nicht", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    await reply(cookies.member, await chatOf(broadcastId, MEMBER), REPLY);

    const response = await request(
      "GET",
      `/api/moderation/broadcast/${broadcastId}/replies`,
      cookies.outsider,
    );

    assertEquals(response.status, STATUS_CODE.Forbidden);
  } finally {
    await cleanUp();
  }
});

Deno.test("das Gespräch liest sich als Verlauf, Rundmail zuerst", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);
    await reply(cookies.member, chatGroupId, REPLY);

    const response = await request(
      "GET",
      `/api/moderation/broadcast/${broadcastId}/replies/${chatGroupId}`,
      cookies.root,
    );

    assertEquals(response.status, STATUS_CODE.OK);

    const conversation = await response.json();
    assertEquals(conversation.username, MEMBER);
    assertEquals(conversation.messages.length, 2);

    const [first, second] = conversation.messages;

    // Die Rundmail selbst kommt von der Teamseite: Ihr Absender sitzt nicht im Gespräch.
    assertEquals(first.text, BODY);
    assertEquals(first.fromTeam, true);

    assertEquals(second.text, REPLY);
    assertEquals(second.fromTeam, false);
    assertEquals(second.username, MEMBER);
  } finally {
    await cleanUp();
  }
});

Deno.test("ein fremdes Gespräch lässt sich nicht über eine Rundmail aufmachen", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);

    // Ein Chat, der mit der Rundmail nichts zu tun hat.
    const created = await request("POST", "/api/chats", cookies.outsider, {
      title: "Privat",
    });
    assertEquals(created.status, STATUS_CODE.Created);
    const privateChat = await created.json();

    const response = await request(
      "GET",
      `/api/moderation/broadcast/${broadcastId}/replies/${privateChat.id}`,
      cookies.root,
    );

    // **Die Rundmail steht mit in der Adresse, und das ist keine Zierde.** Ohne sie wäre das eine
    // Kennung, mit der jedes Team-Mitglied jeden privaten Chat der Plattform aufmachen könnte.
    assertEquals(response.status, STATUS_CODE.NotFound);
  } finally {
    await cleanUp();
  }
});
