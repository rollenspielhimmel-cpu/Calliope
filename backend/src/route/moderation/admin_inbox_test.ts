import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "@std/assert";
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
    // Die Ordner dieser Datei: Sie gehören keinem Konto, also gehen sie nicht mit den Konten.
    await transaction
      .deleteFrom("inboxFolder")
      .where("title", "like", "ai-ordner-%")
      .execute();
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

/**
 * **Eine Rundmail ist keine Antwort.**
 *
 * „Offen" hieß: Die jüngste Nachricht des Mitglieds ist die letzte im Faden. Gezählt wurde dabei
 * jede Nachricht, auch eine Rundmail — und die landet im selben Faden. Eine offene Frage stand
 * deshalb still als beantwortet da, sobald dieselbe Person die nächste Ankündigung bekam, ohne dass
 * je jemand geantwortet hätte. Auf der Beta mit echten Rundmails so gemessen. Genau die Frage wäre
 * untergegangen, für die es das Postfach gibt.
 */
Deno.test("eine Rundmail beantwortet keine offene Frage", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    await write(cookies.member, await chatOf(broadcastId, MEMBER), REPLY);

    const [before] = ours((await (await inbox(cookies.root)).json()).results);
    assertExists(before);
    assertEquals(before.awaitingReply, true);

    await sendBroadcast(cookies.root, SECOND_SUBJECT);

    const [after] = ours((await (await inbox(cookies.root)).json()).results);
    assertExists(after);
    assertEquals(after.awaitingReply, true);
  } finally {
    await cleanUp();
  }
});

/**
 * Die Gegenseite: Eine echte Antwort schließt die Frage weiterhin, auch wenn danach eine Rundmail
 * kommt. Sonst erfüllte auch eine Korrektur den Test darüber, die gar nichts mehr als beantwortet
 * gelten ließe.
 */
Deno.test("eine Antwort bleibt eine Antwort, auch wenn danach eine Rundmail kommt", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);
    const chatGroupId = await chatOf(broadcastId, MEMBER);

    await write(cookies.member, chatGroupId, REPLY);
    await answer(cookies.silent, chatGroupId, ANSWER);
    await sendBroadcast(cookies.root, SECOND_SUBJECT);

    const [after] = ours((await (await inbox(cookies.root)).json()).results);
    assertExists(after);
    assertEquals(after.awaitingReply, false);
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

    // **Nur die beiden eigenen Absender, nicht alle Fäden des Mitglieds.**
    //
    // Hier stand einmal ein Vergleich mit der vollständigen Liste, und der wurde rot, ohne dass an
    // der Regel etwas falsch war: `ai-member` ist in dieser Vorrichtung Administrator, und eine
    // Rundmail an die Administration aus einer nebenher laufenden Datei landet deshalb ebenfalls in
    // seinem Postfach. Deren Absenderkonto wird danach gelöscht, `created_by` fällt auf null — und
    // die Liste hat einen dritten Eintrag, den dieser Test nie angelegt hat.
    const threadOf = (sender: string) =>
      db
        .selectFrom("chatGroup")
        .select("chatGroup.id")
        .where("chatGroup.addressedToAdministration", "=", true)
        .where(
          "chatGroup.administrationPartnerId",
          "=",
          db.selectFrom("user").select("id").where("username", "=", MEMBER),
        )
        .where(
          "chatGroup.createdBy",
          "=",
          db.selectFrom("user").select("id").where("username", "=", sender),
        )
        .executeTakeFirst();

    const fromRoot = await threadOf(ROOT);
    const fromPersona = await threadOf(PERSONA);

    // **Nicht alles in einen Topf.** Liefe die Kunstfigur in denselben Faden, wechselte für das
    // Mitglied mitten im Verlauf der Gesprächspartner — und die Regel „der Absender wird vom
    // Gespräch abgelesen" wäre nicht mehr haltbar.
    assertExists(fromRoot);
    assertExists(fromPersona);
    assertNotEquals(fromRoot.id, fromPersona.id);
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

/** Das Mitglied legt ein Gespräch an und benennt Admin — wie bei jedem anderen Konto. */
async function writeToTheAdministration(cookie: string) {
  const created = await request("POST", "/api/chats", cookie, {
    title: "Frage an das Team",
  });
  assertEquals(created.status, STATUS_CODE.Created);
  const husk = await created.json();

  const invited = await request(
    "POST",
    `/api/chats/${husk.id}/memberships`,
    cookie,
    { userId: await getUserId(ROOT) },
  );

  return { huskId: husk.id as string, response: invited };
}

Deno.test("wer Admin benennt, bekommt den Faden statt einer Einladung", async () => {
  const cookies = await fixture();

  try {
    const { huskId, response } = await writeToTheAdministration(cookies.member);

    // **Keine Einladung, sondern der Faden.** Bei Admin nimmt niemand an — eine Einladung bliebe
    // für immer offen, und die Nachricht käme nie an.
    assertEquals(response.status, STATUS_CODE.OK);

    const { chatGroupId } = await response.json();
    assertNotEquals(chatGroupId, huskId);

    // Keine Annahme nötig: Das Mitglied sitzt von Anfang an drin, also trägt die gewöhnliche
    // Nachrichtenroute.
    const sent = await write(cookies.member, chatGroupId, REPLY);
    assertEquals(sent.status, STATUS_CODE.Created);

    const { results } = await (await inbox(cookies.root)).json();
    const mine = ours(results).filter((row) => row.username === MEMBER);

    assertEquals(mine.length, 1);
    assertEquals(mine[0]?.chatGroupId, chatGroupId);
    assertEquals(mine[0]?.awaitingReply, true);
  } finally {
    await cleanUp();
  }
});

Deno.test("die leere Hülle bleibt nicht liegen", async () => {
  const cookies = await fixture();

  try {
    const { huskId } = await writeToTheAdministration(cookies.member);

    const husk = await db
      .selectFrom("chatGroup")
      .select("id")
      .where("id", "=", huskId)
      .executeTakeFirst();

    // Sonst hätte das Mitglied einen leeren Faden mit einem Titel, der nirgends hinführt.
    assertEquals(husk, undefined);
  } finally {
    await cleanUp();
  }
});

Deno.test("wer erst schreibt und dann eine Rundmail bekommt, hat einen Faden", async () => {
  const cookies = await fixture();

  try {
    const { response } = await writeToTheAdministration(cookies.member);
    const { chatGroupId } = await response.json();
    await write(cookies.member, chatGroupId, REPLY);

    const broadcastId = await sendBroadcast(cookies.root);

    // **Die Reihenfolge darf keine Rolle spielen.** Die Rundmail findet den Faden, den das
    // Mitglied angelegt hat, statt einen zweiten anzulegen — dieselbe Funktion entscheidet das
    // für beide Wege.
    assertEquals(await chatOf(broadcastId, MEMBER), chatGroupId);

    const { messages } = await (await request(
      "GET",
      `/api/moderation/inbox/${chatGroupId}`,
      cookies.root,
    )).json();

    assertEquals(
      messages.map((message: { text: string }) => message.text),
      [REPLY, BODY],
    );
  } finally {
    await cleanUp();
  }
});

Deno.test("in einen Raum, in dem schon jemand sitzt, kommt Admin nicht", async () => {
  const cookies = await fixture();

  try {
    const created = await request("POST", "/api/chats", cookies.member, {
      title: "Zu dritt",
    });
    const room = await created.json();

    assertEquals(
      (await request(
        "POST",
        `/api/chats/${room.id}/memberships`,
        cookies.member,
        { userId: await getUserId(SILENT) },
      )).status,
      STATUS_CODE.Created,
    );

    // **Wer den Platz gerade hält, wird gefragt, nicht angenommen.** ROOT leiht ihn sich in der
    // Vorrichtung — aber unter `--parallel` repariert die Platz-Vorrichtung ihn manchmal
    // zwischendurch, und dann stand hier ein Konto, das die Administration gerade nicht ist. Der
    // Test wurde rot, obwohl die Regel hielt. Sie gilt für den Platz, also fragt er den Platz.
    const administration = await db
      .selectFrom("user")
      .select("id")
      .where("isPrimordialAdmin", "=", true)
      .executeTakeFirstOrThrow();

    const invited = await request(
      "POST",
      `/api/chats/${room.id}/memberships`,
      cookies.member,
      { userId: administration.id },
    );

    // **Admin ist eine Adresse, kein Teilnehmer.** Die anderen im Raum haben der Administration
    // nichts geschrieben; ihre Worte würden für jeden Administrator lesbar, ohne dass sie es
    // wissen.
    assertEquals(invited.status, STATUS_CODE.Forbidden);
  } finally {
    await cleanUp();
  }
});

Deno.test("ein gewöhnlicher Administrator wird ganz normal eingeladen", async () => {
  const cookies = await fixture();

  try {
    const created = await request("POST", "/api/chats", cookies.member, {
      title: "Zu zweit",
    });
    const room = await created.json();

    const invited = await request(
      "POST",
      `/api/chats/${room.id}/memberships`,
      cookies.member,
      { userId: await getUserId(SILENT) },
    );

    // **Die Sperre hängt am Konto, nicht an der Rolle.** SILENT ist Administrator wie der Ur-Admin
    // auch — nur hält er den Platz nicht. Hinge sie an der Rolle, wäre die halbe Administration aus
    // den Gesprächen der Mitglieder ausgesperrt, ohne dass es jemandem auffiele: Die Absage sähe aus
    // wie die richtige.
    assertEquals(invited.status, STATUS_CODE.Created);
  } finally {
    await cleanUp();
  }
});

// ── Erledigt ─────────────────────────────────────────────────────────────────────────────────

type OpenEntry = Entry & {
  isOpen: boolean;
  markedDoneByUsername: string | null;
  markedDoneAt: string | null;
};

async function entryOf(cookie: string, chatGroupId: string) {
  const { results } = await (await inbox(cookie)).json() as {
    results: OpenEntry[];
  };
  return results.find((row) => row.chatGroupId === chatGroupId);
}

function markDone(cookie: string, chatGroupId: string) {
  return request("PUT", `/api/moderation/inbox/${chatGroupId}/done`, cookie);
}

function reopen(cookie: string, chatGroupId: string) {
  return request("DELETE", `/api/moderation/inbox/${chatGroupId}/done`, cookie);
}

/**
 * **Erledigt, ohne zu antworten — bis das Mitglied wieder schreibt.** Ein „Danke" braucht keine
 * Antwort; was danach kommt, darf aber nicht unter der alten Marke verschwinden.
 */
Deno.test("erledigt ohne Antwort, und von selbst wieder offen, wenn das Mitglied schreibt", async () => {
  const cookies = await fixture();

  try {
    const chatId = await chatOf(await sendBroadcast(cookies.root), MEMBER);
    await write(cookies.member, chatId, "Danke!");

    assertEquals((await entryOf(cookies.root, chatId))?.isOpen, true);

    assertEquals((await markDone(cookies.root, chatId)).status, STATUS_CODE.OK);

    const done = await entryOf(cookies.root, chatId);
    assertEquals(done?.isOpen, false);
    assertEquals(done?.awaitingReply, true, "geantwortet hat niemand");
    assertEquals(done?.markedDoneByUsername, ROOT);
    assertExists(done?.markedDoneAt);

    await write(cookies.member, chatId, "Ach, noch eine Frage.");

    const again = await entryOf(cookies.root, chatId);
    assertEquals(again?.isOpen, true, "wieder offen");
    assertEquals(
      again?.markedDoneByUsername,
      null,
      "die alte Marke gilt nicht mehr",
    );
  } finally {
    await cleanUp();
  }
});

Deno.test("„erledigt“ lässt sich zurücknehmen", async () => {
  const cookies = await fixture();

  try {
    const chatId = await chatOf(await sendBroadcast(cookies.root), MEMBER);
    await write(cookies.member, chatId, REPLY);
    await markDone(cookies.root, chatId);

    assertEquals((await reopen(cookies.root, chatId)).status, STATUS_CODE.OK);
    assertEquals((await entryOf(cookies.root, chatId))?.isOpen, true);
  } finally {
    await cleanUp();
  }
});

Deno.test("erledigt nennt ein Gespräch nur die Administration", async () => {
  const cookies = await fixture();

  try {
    const chatId = await chatOf(await sendBroadcast(cookies.root), MEMBER);
    await write(cookies.member, chatId, REPLY);

    assertEquals(
      (await markDone(cookies.moderator, chatId)).status,
      STATUS_CODE.Forbidden,
    );
    assertEquals(
      (await reopen(cookies.moderator, chatId)).status,
      STATUS_CODE.Forbidden,
    );
    assertEquals((await entryOf(cookies.root, chatId))?.isOpen, true);
  } finally {
    await cleanUp();
  }
});

/** Ein privates Gespräch zweier Mitglieder, am Postfach vorbei — mit einer Nachricht darin. */
async function privateChat(): Promise<{ chatId: string; messageId: string }> {
  const chat = await db
    .insertInto("chatGroup")
    .values({ title: "ai-privat", createdBy: await getUserId(OUTSIDER) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const message = await db
    .insertInto("chatMessage")
    .values({
      chatGroupId: chat.id,
      text: "Nur unter uns.",
      createdBy: await getUserId(OUTSIDER),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { chatId: chat.id, messageId: message.id };
}

Deno.test("erledigt nur, was im Postfach liegt und worin das Mitglied geschrieben hat", async () => {
  const cookies = await fixture();

  try {
    const broadcastId = await sendBroadcast(cookies.root);

    assertEquals(
      (await markDone(cookies.root, await chatOf(broadcastId, SILENT))).status,
      STATUS_CODE.Conflict,
      "bloß zugestellt",
    );

    const { chatId } = await privateChat();
    try {
      assertEquals(
        (await markDone(cookies.root, chatId)).status,
        STATUS_CODE.NotFound,
        "ein privates Gespräch",
      );
      assertEquals(
        await db.selectFrom("chatGroup").select("inboxDoneAt")
          .where("id", "=", chatId).executeTakeFirst(),
        { inboxDoneAt: null },
      );
    } finally {
      await db.deleteFrom("chatGroup").where("id", "=", chatId).execute();
    }
  } finally {
    await cleanUp();
  }
});

/** Dass sein „Danke" abgehakt wurde, und von wem, liest das Mitglied nirgends. */
Deno.test("das Mitglied sieht nicht, dass und von wem erledigt wurde", async () => {
  const cookies = await fixture();

  try {
    const chatId = await chatOf(await sendBroadcast(cookies.root), MEMBER);
    await write(cookies.member, chatId, "Danke!");
    await markDone(cookies.root, chatId);

    const chats = await (await request("QUERY", "/api/chats", cookies.member, {
      limit: 100,
    }))
      .text();
    assert(chats.includes(chatId), "das Gespräch ist in der Antwort");
    assert(
      !chats.includes("Done"),
      "weder die Marke noch, wer sie gesetzt hat",
    );
  } finally {
    await cleanUp();
  }
});

// ── Ordner ───────────────────────────────────────────────────────────────────────────────────

type Folder = {
  id: string;
  title: string;
  conversationCount: number;
  messageCount: number;
};

async function createFolder(cookie: string, title: string) {
  const response = await request(
    "POST",
    "/api/moderation/inbox/folders",
    cookie,
    { title },
  );
  assertEquals(response.status, STATUS_CODE.Created);
  return (await response.json() as { id: string }).id;
}

async function folders(cookie: string): Promise<Folder[]> {
  return await (await request("GET", "/api/moderation/inbox/folders", cookie))
    .json();
}

function putIn(
  cookie: string,
  folderId: string,
  target: { chatGroupId: string } | { chatMessageId: string },
) {
  return request(
    "POST",
    `/api/moderation/inbox/folders/${folderId}/items`,
    cookie,
    target,
  );
}

/** Die Nachrichten eines Gesprächs, wie die Administration sie liest. */
async function messagesOf(cookie: string, chatGroupId: string) {
  return (await (await request(
    "GET",
    `/api/moderation/inbox/${chatGroupId}`,
    cookie,
  )).json() as { messages: Array<{ id: string; text: string }> }).messages;
}

Deno.test("Ordner: ganze Gespräche und einzelne Nachrichten, und beides wieder heraus", async () => {
  const cookies = await fixture();

  try {
    const chatId = await chatOf(await sendBroadcast(cookies.root), MEMBER);
    await write(cookies.member, chatId, "Erste wichtige Nachricht.");
    await write(cookies.member, chatId, "Unwichtiges dazwischen.");
    await write(cookies.member, chatId, "Zweite wichtige Nachricht.");

    const messages = await messagesOf(cookies.root, chatId);
    const important = messages.filter((message) =>
      message.text.includes("wichtige Nachricht")
    );
    assertEquals(important.length, 2);

    const folderId = await createFolder(cookies.root, "ai-ordner-wichtig");

    // Eine andere Administration sortiert ein — jeder Admin darf das.
    assertEquals(
      (await putIn(cookies.member, folderId, { chatGroupId: chatId })).status,
      STATUS_CODE.Created,
    );
    for (const message of important) {
      // deno-lint-ignore no-await-in-loop -- zwei, nacheinander
      const added = await putIn(cookies.root, folderId, {
        chatMessageId: message.id,
      });
      assertEquals(added.status, STATUS_CODE.Created);
    }
    assertEquals(
      (await putIn(cookies.root, folderId, { chatGroupId: chatId })).status,
      STATUS_CODE.Conflict,
      "zweimal dasselbe nicht",
    );

    const folder = (await folders(cookies.root)).find((one) =>
      one.id === folderId
    );
    assertEquals(folder?.conversationCount, 1);
    assertEquals(folder?.messageCount, 2);

    const items = await (await request(
      "GET",
      `/api/moderation/inbox/folders/${folderId}/items`,
      cookies.root,
    )).json() as Array<
      {
        id: string;
        kind: string;
        chatGroupId: string;
        username: string;
        addedByUsername: string;
        message?: { text: string };
      }
    >;
    assertEquals(items.length, 3);
    assertEquals(
      items.filter((item) => item.kind === "message").map((item) =>
        item.message?.text
      ).sort(),
      important.map((message) => message.text).sort(),
    );
    assert(items.every((item) => item.chatGroupId === chatId));
    assert(items.every((item) => item.username === MEMBER));
    assertEquals(
      items.find((item) => item.kind === "conversation")?.addedByUsername,
      MEMBER,
    );

    // Der Verlauf weiß, was wo liegt.
    const detail = await (await request(
      "GET",
      `/api/moderation/inbox/${chatId}`,
      cookies.root,
    )).json() as {
      folderPlaces: {
        conversation: Array<{ folderId: string }>;
        messages: Array<{ messageId: string }>;
      };
    };
    assertEquals(detail.folderPlaces.conversation[0]?.folderId, folderId);
    assertEquals(
      detail.folderPlaces.messages.map((place) => place.messageId).sort(),
      important.map((message) => message.id).sort(),
    );

    // Heraus: nur die Einsortierung geht.
    const one = items.find((item) => item.kind === "message");
    assertEquals(
      (await request(
        "DELETE",
        `/api/moderation/inbox/folder-items/${one?.id}`,
        cookies.root,
      )).status,
      STATUS_CODE.OK,
    );
    assertEquals(
      (await messagesOf(cookies.root, chatId)).length,
      messages.length,
    );
  } finally {
    await cleanUp();
  }
});

/**
 * **Nur, was im Postfach liegt.** Sonst zöge ein Ordner einen privaten Chat zweier Mitglieder in
 * die Administration — und machte ihn dort lesbar.
 */
Deno.test("Ordner nehmen nichts auf, was nicht im Postfach liegt", async () => {
  const cookies = await fixture();

  try {
    const folderId = await createFolder(cookies.root, "ai-ordner-privat");
    const { chatId, messageId } = await privateChat();

    try {
      assertEquals(
        (await putIn(cookies.root, folderId, { chatGroupId: chatId })).status,
        STATUS_CODE.NotFound,
      );
      assertEquals(
        (await putIn(cookies.root, folderId, { chatMessageId: messageId }))
          .status,
        STATUS_CODE.NotFound,
      );
      assertEquals(
        (await folders(cookies.root)).find((one) => one.id === folderId)
          ?.messageCount,
        0,
      );
    } finally {
      await db.deleteFrom("chatGroup").where("id", "=", chatId).execute();
    }
  } finally {
    await cleanUp();
  }
});

Deno.test("Ordner umbenennen, und keine zwei mit demselben Namen", async () => {
  const cookies = await fixture();

  try {
    const first = await createFolder(cookies.root, "ai-ordner-bewerbungen");
    const second = await createFolder(cookies.root, "ai-ordner-beschwerden");

    assertEquals(
      (await request("POST", "/api/moderation/inbox/folders", cookies.root, {
        title: "  AI-Ordner-Bewerbungen ",
      })).status,
      STATUS_CODE.Conflict,
      "anders geschrieben, derselbe Name",
    );
    assertEquals(
      (await request(
        "PATCH",
        `/api/moderation/inbox/folders/${second}`,
        cookies.root,
        { title: "ai-ordner-bewerbungen" },
      )).status,
      STATUS_CODE.Conflict,
    );
    assertEquals(
      (await request(
        "PATCH",
        `/api/moderation/inbox/folders/${first}`,
        cookies.member,
        { title: "ai-ordner-bewerbungen-2026" },
      )).status,
      STATUS_CODE.OK,
    );
    assertEquals(
      (await folders(cookies.root)).find((one) => one.id === first)?.title,
      "ai-ordner-bewerbungen-2026",
    );
  } finally {
    await cleanUp();
  }
});

/** Löschen nimmt die Einsortierung weg, nicht die Gespräche und Nachrichten darin. */
Deno.test("einen Ordner löschen lässt Gespräche und Nachrichten im Postfach", async () => {
  const cookies = await fixture();

  try {
    const chatId = await chatOf(await sendBroadcast(cookies.root), MEMBER);
    await write(cookies.member, chatId, REPLY);
    const [message] = (await messagesOf(cookies.root, chatId)).filter((one) =>
      one.text === REPLY
    );
    assertExists(message);

    const folderId = await createFolder(cookies.root, "ai-ordner-weg");
    await putIn(cookies.root, folderId, { chatGroupId: chatId });
    await putIn(cookies.root, folderId, { chatMessageId: message.id });

    assertEquals(
      (await request(
        "DELETE",
        `/api/moderation/inbox/folders/${folderId}`,
        cookies.root,
      )).status,
      STATUS_CODE.OK,
    );

    assert(!(await folders(cookies.root)).some((one) => one.id === folderId));
    assertEquals(
      (await db.selectFrom("inboxFolderItem").select("id")
        .where("inboxFolderId", "=", folderId).execute()).length,
      0,
    );
    assertExists(await entryOf(cookies.root, chatId), "das Gespräch bleibt");
    assert(
      (await messagesOf(cookies.root, chatId)).some((one) =>
        one.id === message.id
      ),
      "die Nachricht auch",
    );
  } finally {
    await cleanUp();
  }
});

/** Eine Reihenfolge für alle Admins — und keine, die zu einem anderen Stand gehört. */
Deno.test("die Reihenfolge der Ordner gilt für alle Admins, und eine veraltete wird abgelehnt", async () => {
  const cookies = await fixture();

  try {
    const a = await createFolder(cookies.root, "ai-ordner-a");
    const b = await createFolder(cookies.root, "ai-ordner-b");
    const c = await createFolder(cookies.root, "ai-ordner-c");

    const order = (await folders(cookies.root)).map((one) => one.id);
    // Neue stehen unten.
    assertEquals(order.slice(-3), [a, b, c]);

    // Den letzten nach ganz oben.
    const wanted = [c, ...order.filter((id) => id !== c)];
    assertEquals(
      (await request(
        "PUT",
        "/api/moderation/inbox/folders/order",
        cookies.root,
        { folderIds: wanted },
      )).status,
      STATUS_CODE.OK,
    );

    // Eine andere Administration sieht dieselbe Reihenfolge.
    assertEquals((await folders(cookies.member)).map((one) => one.id), wanted);

    // Veraltet: ein Ordner fehlt in der Liste.
    assertEquals(
      (await request(
        "PUT",
        "/api/moderation/inbox/folders/order",
        cookies.root,
        { folderIds: wanted.filter((id) => id !== b) },
      )).status,
      STATUS_CODE.Conflict,
    );
    assertEquals(
      (await request(
        "PUT",
        "/api/moderation/inbox/folders/order",
        cookies.root,
        { folderIds: [...wanted.filter((id) => id !== b), a] },
      )).status,
      STATUS_CODE.Conflict,
      "einer doppelt statt eines anderen",
    );
    assertEquals((await folders(cookies.root)).map((one) => one.id), wanted);
  } finally {
    await cleanUp();
  }
});

Deno.test("Ordner sind nur für die Administration", async () => {
  const cookies = await fixture();

  try {
    const folderId = await createFolder(cookies.root, "ai-ordner-geheim");

    for (const cookie of [cookies.moderator, cookies.outsider]) {
      // deno-lint-ignore no-await-in-loop -- zwei, nacheinander
      const listed = await request(
        "GET",
        "/api/moderation/inbox/folders",
        cookie,
      );
      assertEquals(listed.status, STATUS_CODE.Forbidden);
      // deno-lint-ignore no-await-in-loop -- dasselbe
      const items = await request(
        "GET",
        `/api/moderation/inbox/folders/${folderId}/items`,
        cookie,
      );
      assertEquals(items.status, STATUS_CODE.Forbidden);
      // deno-lint-ignore no-await-in-loop -- dasselbe
      const created = await request(
        "POST",
        "/api/moderation/inbox/folders",
        cookie,
        { title: "ai-ordner-vom-mod" },
      );
      assertEquals(created.status, STATUS_CODE.Forbidden);
    }
    assertNotEquals(
      (await folders(cookies.root)).find((one) => one.id === folderId),
      undefined,
    );
  } finally {
    await cleanUp();
  }
});

/** Die Datenbank selbst: genau eines von beidem, und nichts ohne Namen. */
Deno.test("die Datenbank hält Ordner und Einsortierung sauber", async () => {
  const cookies = await fixture();

  try {
    const folderId = await createFolder(cookies.root, "ai-ordner-db");
    const chatId = await chatOf(await sendBroadcast(cookies.root), MEMBER);

    let refused = 0;
    for (
      const attempt of [
        () =>
          db.insertInto("inboxFolderItem").values({ inboxFolderId: folderId })
            .execute(),
        () =>
          db.insertInto("inboxFolder").values({ title: "  ", position: 9999 })
            .execute(),
        () =>
          db.updateTable("chatGroup").set({
            inboxDoneThrough: chatId,
            inboxDoneAt: null,
          }).where("id", "=", chatId).execute(),
      ]
    ) {
      try {
        // deno-lint-ignore no-await-in-loop -- jeder für sich
        await attempt();
      } catch {
        refused++;
      }
    }
    assertEquals(refused, 3);
  } finally {
    await cleanUp();
  }
});
