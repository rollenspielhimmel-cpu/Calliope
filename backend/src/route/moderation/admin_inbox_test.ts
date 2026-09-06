import { assert, assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  getUserId,
  registerUser,
  request,
  scopedTestData,
} from "@/src/test/support.ts";
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
const PERSONA = "ai-persona";

const USERS = [ROOT, MEMBER, SILENT, MODERATOR, OUTSIDER, PERSONA];

const SUBJECT = "Postfach-Test";
const BODY = "Bitte einmal zurückschreiben.";
const REPLY = "Ich hätte da eine Frage.";
const ANSWER = "Gern — hier ist die Antwort.";
const SECOND_SUBJECT = "Postfach-Test, zweite Runde";

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

// **Beide Betreffs, nicht nur einer.** Sonst bleibt eine Veröffentlichung stehen und wächst dem
// nächsten Lauf als zweite Rundmail mit demselben Betreff zu.
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
          .where("subject", "in", [SUBJECT, SECOND_SUBJECT]),
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

    // Ein Konto, unter dem eine Rundmail laufen kann, ohne dass jemand sich damit anmeldet.
    await registerUser(PERSONA);

    await setRole(ROOT, "administrator");
    await setRole(MEMBER, "administrator");
    await setRole(SILENT, "administrator");
    await setRole(MODERATOR, "moderator");
    await setRole(OUTSIDER, null);

    await db
      .insertInto("broadcastSender")
      .values({ userId: await getUserId(PERSONA) })
      .execute();

    await borrowPrimordialSeat(ROOT);

    return cookies;
  });
}

/** Eine Rundmail an die Administration, nur ins Postfach. */
async function sendBroadcast(
  cookie: string,
  subject: string = SUBJECT,
  sendAsUserId: string | null = null,
) {
  const response = await request(
    "POST",
    "/api/moderation/broadcast/queue",
    cookie,
    {
      subject,
      body: BODY,
      audienceRoles: ["administrator"],
      memberIds: [],
      includeUnverified: false,
      deliverToInbox: true,
      deliverByEmail: false,
      publishInArchive: false,
      sendAsUserId,
      scheduledFor: null,
    },
  );

  assertEquals(response.status, STATUS_CODE.Created);

  const broadcast = await db
    .selectFrom("broadcast")
    .select("id")
    .where("subject", "=", subject)
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
    .where(
      "chatGroup.id",
      "in",
      db.selectFrom("chatMessage").select("chatGroupId").where(
        "broadcastId",
        "=",
        broadcastId,
      ),
    )
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

/** Die Administration antwortet — über das Gespräch, nicht mehr über die Rundmail. */
function answer(cookie: string, chatGroupId: string, text: string) {
  return request(
    "POST",
    `/api/moderation/inbox/${chatGroupId}`,
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
  senderUsername: string | null;
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
    // Der Name, unter dem die Plattform in diesem Faden spricht.
    assertEquals(entry.senderUsername, ROOT);
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

    await answer(cookies.silent, chatGroupId, ANSWER);

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
    await answer(cookies.silent, chatGroupId, ANSWER);

    const response = await request(
      "GET",
      `/api/moderation/inbox/${chatGroupId}`,
      cookies.root,
    );

    assertEquals(response.status, STATUS_CODE.OK);

    const conversation = await response.json();
    assertEquals(conversation.username, MEMBER);
    assertEquals(conversation.senderUsername, ROOT);

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

Deno.test("die Rundmail heißt Rundmail, nicht Team", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    await write(cookies.member, chatGroupId, REPLY);
    await answer(cookies.silent, chatGroupId, ANSWER);

    const { messages } = await (await request(
      "GET",
      `/api/moderation/inbox/${chatGroupId}`,
      cookies.root,
    )).json();

    const announcement = messages.find(
      (message: { text: string }) => message.text === BODY,
    );
    assertExists(announcement);

    // **Sonst liest sich der Verlauf verkehrt herum.** Stand die Rundmail als „Team" da wie eine
    // Antwort, war sie eine Antwort vor der Frage — und der fehlte obendrein der Verfasser. Genau so
    // ist es beim Durchklicken gelesen worden, und der Schluss war folgerichtig.
    assertEquals(announcement.isAnnouncement, true);

    const fromTeam = messages.find(
      (message: { text: string }) => message.text === ANSWER,
    );
    assertExists(fromTeam);
    assertEquals(fromTeam.isAnnouncement, false);

    const fromMember = messages.find(
      (message: { text: string }) => message.text === REPLY,
    );
    assertExists(fromMember);
    assertEquals(fromMember.isAnnouncement, false);
  } finally {
    await cleanUp();
  }
});

Deno.test("zwei Rundmails landen im selben Faden", async () => {
  const cookies = await fixture();

  try {
    const first = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(first, MEMBER);

    await write(cookies.member, chatGroupId, REPLY);
    await sendBroadcast(cookies.root, SECOND_SUBJECT);

    // **Der Kern des Umbaus.** Vorher war jede Ankündigung ein eigener Faden mit einer Nachricht;
    // für das Mitglied ein Stapel statt eines Gesprächs, und für die Administration „was hat diese
    // Person geschrieben" über zehn Orte verteilt.
    // **Nur unser Absender.** Ein Lauf mit `--parallel` schickt nebenher eigene Rundmails an die
    // Administration, und MEMBER steht in deren Empfängerkreis: Deren Fäden zu zählen hieße, die
    // Geschwindigkeit anderer Dateien zu messen.
    const chats = await db
      .selectFrom("chatGroup")
      .select("id")
      .where("addressedToAdministration", "=", true)
      .where(
        "administrationPartnerId",
        "=",
        db.selectFrom("user").select("id").where("username", "=", MEMBER),
      )
      .where(
        "createdBy",
        "=",
        db.selectFrom("user").select("id").where("username", "=", ROOT),
      )
      .execute();

    assertEquals(chats.length, 1);
    assertEquals(chats[0]?.id, chatGroupId);

    const { messages } = await (await request(
      "GET",
      `/api/moderation/inbox/${chatGroupId}`,
      cookies.root,
    )).json();

    // Beide Ankündigungen und die Antwort dazwischen, in der Reihenfolge, in der sie entstanden.
    assertEquals(
      messages.map((message: { text: string }) => message.text),
      [BODY, REPLY, BODY],
    );

    const subjects = messages.map(
      (message: { subject: string | null }) => message.subject,
    );
    assertEquals(subjects, [SUBJECT, null, SECOND_SUBJECT]);
  } finally {
    await cleanUp();
  }
});

Deno.test("eine Kunstfigur bekommt ihren eigenen Faden", async () => {
  const cookies = await fixture();

  try {
    await sendBroadcast(cookies.root);
    await sendBroadcast(cookies.root, SECOND_SUBJECT, await getUserId(PERSONA));

    const chats = await db
      .selectFrom("chatGroup")
      .leftJoin("user as sender", "sender.id", "chatGroup.createdBy")
      .select("sender.username as senderUsername")
      .where("chatGroup.addressedToAdministration", "=", true)
      .where(
        "chatGroup.administrationPartnerId",
        "=",
        db.selectFrom("user").select("id").where("username", "=", MEMBER),
      )
      .execute();

    // **Nicht alles in einen Topf.** Liefe die Kunstfigur in denselben Faden, wechselte für das
    // Mitglied mitten im Verlauf der Gesprächspartner — und die Regel „der Absender wird vom
    // Gespräch abgelesen" wäre nicht mehr haltbar.
    assertEquals(
      chats.map((chat) => chat.senderUsername).toSorted(),
      [PERSONA, ROOT].toSorted(),
    );
  } finally {
    await cleanUp();
  }
});

Deno.test("was die Administration sich selbst schreibt, ist keine Arbeit", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);

    // ROOT hält den Ur-Admin-Platz und steht selbst im Empfängerkreis — er bekommt seine eigene
    // Rundmail wie jeder andere. Schreibt er in seinem eigenen Faden, ist das keine Frage an
    // jemanden.
    await write(cookies.root, await chatOf(broadcastId, ROOT), "Notiz an mich");

    const { results } = await (await inbox(cookies.root)).json();
    const names = ours(results).map((row) => row.username);

    assert(!names.includes(ROOT));
  } finally {
    await cleanUp();
  }
});
