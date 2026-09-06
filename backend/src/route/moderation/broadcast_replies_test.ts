import { assert, assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  cleanUpRetryingOnDeadlock,
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
const ANSWER = "Gern — melde dich, wenn noch etwas offen ist.";
const AGAIN = "Doch, eine Sache noch.";

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
  // Auch vorher, nicht nur nachher: Ein abgebrochener Lauf lässt diese Konten stehen, und der
  // nächste scheitert dann schon am vergebenen Namen. Siehe `broadcast_delivery_test.ts`.
  await cleanUp();

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
  // Wiederholt, weil dieses Löschen über die Gespräche in `user_in_chat_group` landet und sich
  // dort mit dem `deleteUsers` einer anderen Datei verklemmen kann — siehe die Erklärung dort.
  await cleanUpRetryingOnDeadlock(async () => {
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
  });

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

/** Die Administration antwortet — über die Rundmail, nicht über den Chat. */
async function replyAsTeam(
  cookie: string,
  broadcastId: string,
  chatGroupId: string,
  text: string,
) {
  return await request(
    "POST",
    `/api/moderation/broadcast/${broadcastId}/replies/${chatGroupId}`,
    cookie,
    { text },
  );
}

Deno.test("die Antwort trägt den Absender, festgehalten wird der Mensch", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    await reply(cookies.member, chatGroupId, REPLY);

    // **SILENT tippt, nicht ROOT.** Die Rundmail lief unter ROOT als Absender; wer aus der
    // Administration antwortet, ist eine andere Frage, und nur so sind die beiden Namen
    // unterscheidbar. Antwortete hier der Absender selbst, prüfte der Test nichts.
    const response = await replyAsTeam(
      cookies.silent,
      broadcastId,
      chatGroupId,
      ANSWER,
    );

    assertEquals(response.status, STATUS_CODE.Created);

    const stored = await db
      .selectFrom("chatMessage")
      .leftJoin("user as author", "author.id", "chatMessage.createdBy")
      .leftJoin("user as writer", "writer.id", "chatMessage.writtenBy")
      .select([
        "author.username as authorName",
        "writer.username as writerName",
      ])
      .where("chatMessage.text", "=", ANSWER)
      .executeTakeFirstOrThrow();

    assertEquals(stored.authorName, ROOT);
    assertEquals(stored.writerName, SILENT);
  } finally {
    await cleanUp();
  }
});

Deno.test("das Mitglied liest ein gewöhnliches Gespräch", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    await reply(cookies.member, chatGroupId, REPLY);
    await replyAsTeam(cookies.silent, broadcastId, chatGroupId, ANSWER);

    const response = await request(
      "QUERY",
      `/api/chats/${chatGroupId}/messages`,
      cookies.member,
      {},
    );

    assertEquals(response.status, STATUS_CODE.OK);

    const { results } = await response.json();
    const answer = results.find(
      (message: { text: string }) => message.text === ANSWER,
    );
    assertExists(answer);

    // **Der Name, der auf der Rundmail stand — und nirgends der Mensch dahinter.** Das ist der
    // ganze Sinn der Kunstfigur: Wer antwortet, erfährt nicht, wer wirklich getippt hat.
    assertEquals(answer.createdByUsername, ROOT);
    assert(!JSON.stringify(results).includes(SILENT));
  } finally {
    await cleanUp();
  }
});

Deno.test("die Antwort des Teams gilt nicht als Antwort des Mitglieds", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    await reply(cookies.member, chatGroupId, REPLY);
    await replyAsTeam(cookies.silent, broadcastId, chatGroupId, ANSWER);

    const response = await request(
      "GET",
      `/api/moderation/broadcast/${broadcastId}/replies`,
      cookies.root,
    );

    const { results } = await response.json();
    assertEquals(results.length, 1);

    const [entry] = results;
    // Sonst stünde in der Liste „wer hat geantwortet" die eigene Antwort des Teams, und die Liste
    // beantwortete ihre eigene Frage nicht mehr.
    assertEquals(entry.excerpt, REPLY);
    assertEquals(entry.username, MEMBER);
  } finally {
    await cleanUp();
  }
});

Deno.test("im Verlauf steht sie auf der Teamseite", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    await reply(cookies.member, chatGroupId, REPLY);
    await replyAsTeam(cookies.silent, broadcastId, chatGroupId, ANSWER);

    const response = await request(
      "GET",
      `/api/moderation/broadcast/${broadcastId}/replies/${chatGroupId}`,
      cookies.moderator,
    );

    assertEquals(response.status, STATUS_CODE.OK);

    const { messages } = await response.json();
    const answer = messages.find(
      (message: { text: string }) => message.text === ANSWER,
    );
    assertExists(answer);
    assertEquals(answer.fromTeam, true);
  } finally {
    await cleanUp();
  }
});

Deno.test("die Moderation darf lesen, aber nicht antworten", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    const response = await replyAsTeam(
      cookies.moderator,
      broadcastId,
      chatGroupId,
      ANSWER,
    );

    // Wer beobachtet, wie es der Community geht, spricht deshalb noch nicht für die Plattform.
    assertEquals(response.status, STATUS_CODE.Forbidden);
  } finally {
    await cleanUp();
  }
});

Deno.test("ein gewöhnliches Mitglied darf erst recht nicht antworten", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    const response = await replyAsTeam(
      cookies.outsider,
      broadcastId,
      chatGroupId,
      ANSWER,
    );

    assertEquals(response.status, STATUS_CODE.Forbidden);
  } finally {
    await cleanUp();
  }
});

Deno.test("in ein fremdes Gespräch lässt sich nicht hineinschreiben", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);

    const created = await request("POST", "/api/chats", cookies.outsider, {
      title: "Privat",
    });
    assertEquals(created.status, STATUS_CODE.Created);
    const privateChat = await created.json();

    const response = await replyAsTeam(
      cookies.root,
      broadcastId,
      privateChat.id,
      ANSWER,
    );

    // **Dieselbe Sperre wie beim Lesen, und sie wiegt hier schwerer.** Ohne die Rundmail in der
    // Adresse wäre das eine Kennung, mit der die Administration in jeden privaten Chat der
    // Plattform hineinschreiben könnte — unter einem Namen, den sie sich aussucht.
    assertEquals(response.status, STATUS_CODE.NotFound);
  } finally {
    await cleanUp();
  }
});

Deno.test("schreibt das Mitglied noch einmal, steht es wieder da", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    await reply(cookies.member, chatGroupId, REPLY);
    await replyAsTeam(cookies.silent, broadcastId, chatGroupId, ANSWER);
    await reply(cookies.member, chatGroupId, AGAIN);

    const response = await request(
      "GET",
      `/api/moderation/broadcast/${broadcastId}/replies`,
      cookies.root,
    );

    const { results } = await response.json();

    // **Ein Gespräch bleibt ein Eintrag, gleich wie oft hin und her geschrieben wird.** Die Liste
    // beantwortet „wer hat geantwortet", nicht „wie viele Nachrichten gibt es" — sonst stünde
    // dasselbe Mitglied nach drei Runden dreimal darin.
    assertEquals(results.length, 1);

    const [entry] = results;
    assertEquals(entry.username, MEMBER);

    // Der neueste Text des Mitglieds, nicht der erste und nicht der des Teams.
    assertEquals(entry.excerpt, AGAIN);
  } finally {
    await cleanUp();
  }
});
