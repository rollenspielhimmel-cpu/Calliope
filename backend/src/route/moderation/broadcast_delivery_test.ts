import { assert, assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  type ChatEvent,
  subscribeToChatEvents,
} from "@/src/event/chat_events.ts";
import { registerUser, request, scopedTestData } from "@/src/test/support.ts";
import { borrowPrimordialSeat } from "@/src/test/primordial_seat.ts";

/**
 * Wohin eine Rundmail geht.
 *
 * **Das ist die Frage, an der das Feature einmal vorbeigebaut war:** Es verschickte E-Mails,
 * gemeint war eine Mitteilung innerhalb der Community. Die Wege sind seitdem drei, einzeln zu
 * haben — Postfach, E-Mail, Forum-Archiv —, und was diese Datei festhält, ist, dass sie
 * tatsächlich einzeln sind. Ein Haken, der stillschweigend einen zweiten mitzieht, wäre genau der
 * Fehler zurück.
 *
 * Der E-Mail-Weg wird hier nirgends ausgelöst: Ein Testlauf, der Post an erfundene Konten schickt,
 * prüft nichts und belästigt im Zweifel jemanden. Dass die Zahl stimmt, sagt die Reichweite.
 */

const ROOT = "bd-root";
const MEMBER = "bd-member";
const SECOND = "bd-second";
const UNVERIFIED = "bd-unverified";

const USERS = [ROOT, MEMBER, SECOND, UNVERIFIED];

const SUBJECT = "Zustellwege-Test";
const BODY = "Erster Absatz.\n\nZweiter Absatz.";

const BROADCAST = {
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
};

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
 * **Die Rundmails müssen mit weg, nicht nur die Konten.**
 *
 * `publication.written_by` wird beim Löschen eines Kontos auf leer gesetzt statt mitgelöscht — die
 * Rundmail überlebt ihren Verfasser mit Absicht, damit „was ging raus" eine Frage bleibt, die man
 * beantworten kann. Für diese Datei heißt das: Ohne dieses Aufräumen findet der zweite Test zwei
 * Rundmails mit demselben Betreff und geht rot, ohne dass etwas kaputt wäre.
 *
 * Der Archiv-Faden dagegen bleibt stehen: Es gibt genau einen, er gehört der Plattform und nicht
 * diesem Lauf. Weg müssen nur die Beiträge, die diese Datei hineingelegt hat — sonst wächst das
 * Archiv bei jedem Lauf um eine Test-Ankündigung.
 */
const data = scopedTestData({
  users: USERS,
  seat: ROOT,
  remove: async (transaction) => {
    await transaction
      .deleteFrom("writingPost")
      .where("text", "like", `${SUBJECT}%`)
      .execute();

    await transaction
      .deleteFrom("publication")
      .where(
        "id",
        "in",
        transaction.selectFrom("broadcast").select("publicationId").where(
          "subject",
          "=",
          SUBJECT,
        ),
      )
      .execute();
  },
});

const cleanUp = data.cleanUp;

/**
 * Drei Administratoren und ein gewöhnliches Mitglied, jedes mit einer Aufgabe.
 *
 * - **ROOT** hält den Ur-Admin-Platz, gibt also mit dem Schreiben frei und schickt im selben Zug.
 * - **SECOND** liest nach, was er bekommen hat — jemand, der die Rundmail nicht selbst verfasst
 *   hat, sonst prüfte das Nachlesen nur, dass der Verfasser seinen eigenen Text findet.
 * - **UNVERIFIED** hat eine unbestätigte Adresse und ist der ganze Unterschied zwischen den beiden
 *   Zahlen. Nachlesen kann er nichts: Ein unbestätigtes Konto kommt an die Schnittstelle gar nicht
 *   erst heran.
 * - **MEMBER** ist die Gegenprobe. Eine Rundmail an die Administration darf ihn nicht erreichen.
 *
 * **Nirgends wird eine Gesamtzahl behauptet, auch keine berechnete.** Die Datenbank enthält weitere
 * Administratoren — Saatkonten und was andere Dateien dieses Laufs gerade anlegen und wieder
 * löschen. „Genau drei" wäre falsch, und „so viele wie gerade in der Tabelle stehen" wäre nicht
 * besser: Zwischen dem Versand und dem Nachzählen kann eine andere Datei fertig geworden sein.
 * Geprüft wird deshalb, was unabhängig davon gilt — unsere vier Konten, und die Zahlen gegen sich
 * selbst.
 */
function fixture() {
  return data.freshly(async () => {
    const cookies = {
      root: await registerUser(ROOT),
      member: await registerUser(MEMBER),
      second: await registerUser(SECOND),
      unverified: await registerUser(UNVERIFIED),
    };

    await setRole(ROOT, "administrator");
    await setRole(MEMBER, null);
    await setRole(SECOND, "administrator");
    await setRole(UNVERIFIED, "administrator");

    await db
      .updateTable("user")
      .set({ emailAddressVerifiedAt: null })
      .where("username", "=", UNVERIFIED)
      .execute();

    // Der Ur-Admin gibt mit dem Schreiben frei, und nur so geht die Rundmail im selben Zug raus.
    await borrowPrimordialSeat(ROOT);

    return cookies;
  });
}

/**
 * Die Gespräche, in denen diese Rundmail liegt.
 *
 * **Die Rundmail hängt an der Nachricht, nicht mehr am Gespräch.** Ein Faden je Mitglied und
 * Absender trägt viele Ankündigungen; „welches Gespräch gehört zu dieser Rundmail" ist deshalb eine
 * Frage über die Nachrichten darin.
 */
const chatsOf = (broadcastId: string) =>
  db
    .selectFrom("chatMessage")
    .select("chatGroupId")
    .where("broadcastId", "=", broadcastId);

/** Nur die Rundmails dieser Datei — andere Läufe legen ihre eigenen an. */
async function ourBroadcasts() {
  return await db
    .selectFrom("broadcast")
    .select(["id", "archivePostId", "recipientCount", "emailRecipientCount"])
    .where("subject", "=", SUBJECT)
    .execute();
}

async function submit(cookie: string, overrides: Record<string, unknown> = {}) {
  return await request("POST", "/api/moderation/broadcast/queue", cookie, {
    ...BROADCAST,
    ...overrides,
  });
}

/** Das Gespräch, das dieses Mitglied aus der Rundmail bekommen hat. */
async function chatOf(
  broadcast: { id: string },
  username: string,
): Promise<string> {
  const chat = await db
    .selectFrom("chatGroup")
    .innerJoin(
      "userInChatGroup",
      "userInChatGroup.chatGroupId",
      "chatGroup.id",
    )
    .innerJoin("user", "user.id", "userInChatGroup.userId")
    .select("chatGroup.id")
    .where("chatGroup.id", "in", chatsOf(broadcast.id))
    .where("user.username", "=", username)
    .executeTakeFirstOrThrow();

  return chat.id;
}

/** Die eine Rundmail dieser Datei, oder ein Fehlschlag mit einem Satz statt `undefined`. */
async function theBroadcast() {
  const all = await ourBroadcasts();
  assertEquals(all.length, 1, "genau eine Rundmail dieser Datei erwartet");

  const [broadcast] = all;
  assertExists(broadcast);

  return broadcast;
}

Deno.test("ins Postfach heißt: eine Zeile für jeden Empfänger", async () => {
  const cookies = await fixture();

  try {
    assertEquals((await submit(cookies.root)).status, STATUS_CODE.Created);

    const broadcast = await theBroadcast();

    const notified = await db
      .selectFrom("chatGroup")
      .innerJoin(
        "userInChatGroup",
        "userInChatGroup.chatGroupId",
        "chatGroup.id",
      )
      .innerJoin("user", "user.id", "userInChatGroup.userId")
      .select(["user.username", "userInChatGroup.status"])
      .where("chatGroup.id", "in", chatsOf(broadcast.id))
      .execute();

    const reached = notified.map((row) => row.username);

    // **Der Betreff steht an der Nachricht, nicht mehr am Gespräch.** Ein Faden je Mitglied und
    // Absender trägt viele Ankündigungen, und einen Titel kann er nur einmal tragen; er heißt jetzt
    // nach dem Absender.
    const announcements = await db
      .selectFrom("chatMessage")
      .select("subject")
      .where("broadcastId", "=", broadcast.id)
      .execute();

    assert(announcements.length > 0);
    assert(announcements.every((row) => row.subject === SUBJECT));

    // **Beigetreten, nicht eingeladen.** Eine Rundmail nimmt man nicht an; eine Einladung, die erst
    // bestätigt werden müsste, wäre eine Hürde vor einer Mitteilung, die schon ausgesprochen ist.
    assert(notified.every((row) => row.status === "joined"));

    // Der mit der unbestätigten Adresse ist dabei: Die Bestätigung ist eine Frage an die E-Mail,
    // nicht an die Mitgliedschaft.
    assert(reached.includes(ROOT));
    assert(reached.includes(UNVERIFIED));
    assert(reached.includes(SECOND));

    // Und das gewöhnliche Mitglied nicht — die Rundmail ging an die Administration. Das ist die
    // Aussage, auf die es ankommt: dass der Empfängerkreis wirklich filtert.
    //
    // **Kein Vergleich mit der vollständigen Kontenliste**, so verlockend er wäre: Die Dateien
    // dieses Laufs legen nebenher Administratoren an und löschen sie wieder, und ein Test, der die
    // Liste nach dem Versand noch einmal abfragt, prüft am Ende nur, wer gerade sonst angemeldet
    // ist. Genau daran ging die Reichweite hier einmal rot, während sie allein grün war.
    assert(!reached.includes(MEMBER));
  } finally {
    await cleanUp();
  }
});

Deno.test("der Absender sitzt in keinem der Gespräche", async () => {
  const cookies = await fixture();

  try {
    // **Als Kunstfigur, und das ist keine Bequemlichkeit.** Schickte der Ur-Admin unter eigenem
    // Namen, wäre er zugleich Empfänger — er ist ja Administration —, und ein Gespräch in seinem
    // Postfach wäre dann völlig richtig. Der Fall, um den es geht, ist der Weihnachtsmann: ein
    // Konto, das die Rundmail trägt, ohne im Empfängerkreis zu stehen.
    const sender = await db
      .selectFrom("user")
      .select("id")
      .where("username", "=", MEMBER)
      .executeTakeFirstOrThrow();

    const releasedBy = await db
      .selectFrom("user")
      .select("id")
      .where("username", "=", ROOT)
      .executeTakeFirstOrThrow();

    await db
      .insertInto("broadcastSender")
      .values({ userId: sender.id, enabledBy: releasedBy.id })
      .onConflict((conflict) => conflict.column("userId").doNothing())
      .execute();

    await submit(cookies.root, { sendAsUserId: sender.id });

    const broadcast = await theBroadcast();

    // **Das ist der ganze Trick des Entwurfs.** Ohne Zeile in `user_in_chat_group` taucht das
    // Gespräch beim Absender nirgends auf — weder beim Ur-Admin, in dessen Postfach niemand sieht,
    // noch bei einer Kunstfigur wie dem Weihnachtsmann. Stünde er drin, hätte er nach einer
    // Rundmail an alle hundert Gespräche im eigenen Postfach.
    const senderIsIn = await db
      .selectFrom("userInChatGroup")
      .innerJoin("chatGroup", "chatGroup.id", "userInChatGroup.chatGroupId")
      .select("userInChatGroup.userId")
      .where("chatGroup.id", "in", chatsOf(broadcast.id))
      .where("userInChatGroup.userId", "=", sender.id)
      .execute();

    assertEquals(senderIsIn, []);

    // Den Namen trägt die Nachricht trotzdem — sonst käme sie von niemandem.
    const messages = await db
      .selectFrom("chatMessage")
      .innerJoin("chatGroup", "chatGroup.id", "chatMessage.chatGroupId")
      .select(["chatMessage.createdBy", "chatMessage.text"])
      .where("chatGroup.id", "in", chatsOf(broadcast.id))
      .execute();

    assert(messages.length > 0);
    assert(messages.every((row) => row.createdBy === sender.id));
    // Der ganze Text, nicht ein Verweis darauf.
    assert(messages.every((row) => row.text === BODY));
  } finally {
    await cleanUp();
  }
});

Deno.test("das Gespräch gehört dem Absender, nicht der schreibenden Person", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const broadcast = await theBroadcast();

    const author = await db
      .selectFrom("user")
      .select("id")
      .where("username", "=", ROOT)
      .executeTakeFirstOrThrow();

    const chats = await db
      .selectFrom("chatGroup")
      .select("createdBy")
      .where("id", "in", chatsOf(broadcast.id))
      .execute();

    // **Die Ecke, an die niemand denkt.** `created_by` am Gespräch sieht sich nie jemand an — und
    // genau deshalb wäre dort der echte Name die Stelle, an der die Maske fällt. Hier hält ROOT den
    // Ur-Admin-Platz, ist also zugleich Absender; der Test prüft die Regel trotzdem, weil der
    // nächste Absender eine Kunstfigur sein wird.
    assert(chats.length > 0);
    assert(chats.every((row) => row.createdBy !== null));
    assert(chats.every((row) => row.createdBy === author.id));
  } finally {
    await cleanUp();
  }
});

Deno.test("zwei Zahlen: das Postfach reicht weiter als die E-Mail", async () => {
  const cookies = await fixture();

  try {
    const response = await request(
      "GET",
      "/api/moderation/broadcast/recipients?roles=administrator&includeUnverified=false",
      cookies.root,
    );

    assertEquals(response.status, STATUS_CODE.OK);

    const reach = await response.json();

    // **Was unabhängig davon gilt, wer sonst gerade angemeldet ist.** Die anderen Dateien dieses
    // Laufs legen nebenher Administratoren an und löschen sie wieder; eine Zahl mit ihrer eigenen
    // Liste zu vergleichen prüft am Ende nur, wie schnell die andere Datei war.
    //
    // Unsere drei sind darunter, und die beiden Zahlen fallen um mindestens einen auseinander —
    // um den mit der unbestätigten Adresse, der sein Postfach liest und keine Mail bekommt. Das ist
    // die Aussage; die genauen Zahlen sind Zufall des Augenblicks.
    assert(reach.inbox >= 3);
    assert(reach.inbox - reach.email >= 1);
  } finally {
    await cleanUp();
  }
});

Deno.test("ohne Postfach-Weg entsteht keine Zeile im Postfach", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root, {
      deliverToInbox: false,
      publishInArchive: true,
    });

    const broadcast = await theBroadcast();

    const chats = await db
      .selectFrom("chatGroup")
      .select("id")
      .where("id", "in", chatsOf(broadcast.id))
      .execute();

    assertEquals(chats, []);
    // Leer statt null: Eine Null sähe aus wie „an niemanden zugestellt" statt „dieser Weg war
    // nicht gewählt".
    assertEquals(broadcast.recipientCount, null);
  } finally {
    await cleanUp();
  }
});

Deno.test("eine Rundmail ohne jeden Weg wird abgelehnt", async () => {
  const cookies = await fixture();

  try {
    const response = await submit(cookies.root, {
      deliverToInbox: false,
      deliverByEmail: false,
      publishInArchive: false,
    });

    // Die Datenbank sagt nein, nicht das Formular: Die Regel gilt für jede Zeile, gleich wer sie
    // schreibt. Welcher Statuscode dabei herauskommt, ist zweitrangig — dass nichts entsteht,
    // nicht.
    assert(response.status >= 400);
    assertEquals(await ourBroadcasts(), []);
  } finally {
    await cleanUp();
  }
});

Deno.test("die Reichweite wird beim Versand festgehalten", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const broadcast = await theBroadcast();

    const chats = await db
      .selectFrom("chatGroup")
      .select("id")
      .where("id", "in", chatsOf(broadcast.id))
      .execute();

    // **Gegen die eigenen Gespräche geprüft, nicht gegen die Kontenliste von jetzt.** Die Dateien
    // dieses Laufs legen nebenher Administratoren an und löschen sie wieder; wer die Liste nach dem
    // Versand noch einmal abfragt, zählt einen anderen Augenblick als den, in dem gesendet wurde.
    // Genau daran ging dieser Test im Parallellauf rot, während er allein grün war.
    assertEquals(broadcast.recipientCount, chats.length);
    // Leer statt null: Eine Null sähe aus wie „an niemanden zugestellt" statt „dieser Weg war nicht
    // gewählt".
    assertEquals(broadcast.emailRecipientCount, null);
  } finally {
    await cleanUp();
  }
});

Deno.test("der Archiv-Haken hängt einen Beitrag an den einen Faden", async () => {
  const cookies = await fixture();

  try {
    const before = await db
      .selectFrom("writingPost")
      .innerJoin(
        "writingThread",
        "writingThread.id",
        "writingPost.writingThreadId",
      )
      .select("writingPost.id")
      .where("writingThread.isBroadcastArchive", "=", true)
      .execute();

    await submit(cookies.root, { publishInArchive: true });

    const broadcast = await theBroadcast();
    assert(broadcast.archivePostId !== null);

    const post = await db
      .selectFrom("writingPost")
      .innerJoin(
        "writingThread",
        "writingThread.id",
        "writingPost.writingThreadId",
      )
      .select([
        "writingThread.title as threadTitle",
        "writingThread.isBroadcastArchive",
        "writingThread.writingGroupId",
        "writingPost.text",
      ])
      .where("writingPost.id", "=", broadcast.archivePostId)
      .executeTakeFirstOrThrow();

    // **Angehängt, nicht als eigener Faden.** Der Titel ist der des Archivs und nicht der Betreff;
    // wer als neues Mitglied nachliest, liest einmal von oben nach unten.
    assert(post.isBroadcastArchive);
    assertEquals(post.threadTitle, "Rundmails");
    // Ohne Schreibgruppe: Genau das macht eine Zeile zu einer des Forums.
    assertEquals(post.writingGroupId, null);

    // Der Betreff steht mit im Volltext — im Dokument als Überschrift, damit man in der Sammlung
    // sieht, wo eine Mitteilung endet und die nächste beginnt.
    assert(post.text.startsWith(SUBJECT));
    assert(post.text.includes(BODY));

    // Genau einer mehr als vorher.
    const after = await db
      .selectFrom("writingPost")
      .innerJoin(
        "writingThread",
        "writingThread.id",
        "writingPost.writingThreadId",
      )
      .select("writingPost.id")
      .where("writingThread.isBroadcastArchive", "=", true)
      .execute();

    assertEquals(after.length, before.length + 1);
  } finally {
    await cleanUp();
  }
});

Deno.test("im Archiv wird nicht geantwortet", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root, { publishInArchive: true });

    const archive = await db
      .selectFrom("writingThread")
      .innerJoin("writingFolder", "writingFolder.id", "writingThread.folderId")
      .select([
        "writingThread.memberPermission as threadPermission",
        "writingFolder.memberPermission as folderPermission",
      ])
      .where("writingThread.isBroadcastArchive", "=", true)
      .executeTakeFirstOrThrow();

    // Geantwortet wird auf die Rundmail im Postfach. Eine Antwort mitten in der Sammlung würde die
    // Reihenfolge zerreißen, die sie lesbar macht.
    assertEquals(archive.threadPermission, "read");
    assertEquals(archive.folderPermission, "read");
  } finally {
    await cleanUp();
  }
});

Deno.test("ohne Archiv-Haken bleibt das Forum unberührt", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const broadcast = await theBroadcast();
    assertEquals(broadcast.archivePostId, null);

    const posts = await db
      .selectFrom("writingPost")
      .select("id")
      .where("text", "like", `${SUBJECT}%`)
      .execute();

    assertEquals(posts, []);
  } finally {
    await cleanUp();
  }
});

Deno.test("die Rundmail meldet sich wie eine neue PN", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const broadcast = await theBroadcast();

    const notified = await db
      .selectFrom("notification")
      .innerJoin("chatGroup", "chatGroup.id", "notification.chatGroupId")
      .innerJoin("user", "user.id", "notification.recipientId")
      .select([
        "user.username",
        "notification.type",
        "notification.actorId",
        "notification.readAt",
      ])
      .where("chatGroup.id", "in", chatsOf(broadcast.id))
      .execute();

    // **Ohne sie erführe niemand, dass etwas da ist.** Eine gewöhnliche neue PN meldet sich über
    // ihre Einladung; eine Rundmail setzt das Mitglied direkt hinein und übersprang damit genau
    // diese Meldung. Wer nicht zufällig ins Postfach sieht, hätte die Ankündigung nie bemerkt.
    const reached = notified.map((row) => row.username);

    // Unsere eigenen Konten, nicht die Kontenliste der Plattform — siehe die Vorrichtung oben.
    assert(reached.includes(ROOT));
    assert(reached.includes(SECOND));
    assert(reached.includes(UNVERIFIED));
    assert(!reached.includes(MEMBER));

    // Genau eine je Empfänger: Zwei Meldungen für dieselbe Rundmail wären eine Doppelung, die man
    // erst bemerkt, wenn die Glocke zweimal dasselbe sagt.
    assertEquals(new Set(reached).size, reached.length);

    assert(notified.every((row) => row.type === "broadcast_received"));
    // Ungelesen, sonst wäre die Glocke schon still, bevor jemand hingesehen hat.
    assert(notified.every((row) => row.readAt === null));
  } finally {
    await cleanUp();
  }
});

Deno.test("niemand benachrichtigt sich selbst über die eigene Rundmail", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const broadcast = await theBroadcast();

    const own = await db
      .selectFrom("notification")
      .innerJoin("chatGroup", "chatGroup.id", "notification.chatGroupId")
      .innerJoin("user", "user.id", "notification.recipientId")
      .select("notification.actorId")
      .where("chatGroup.id", "in", chatsOf(broadcast.id))
      .where("user.username", "=", ROOT)
      .executeTakeFirstOrThrow();

    // ROOT hält den Ur-Admin-Platz, ist also Absender — und als Administration zugleich Empfänger.
    // `notification_actor_is_not_recipient` verbietet genau diese Zeile; stünde der Absender darin,
    // fiele sie um und mit ihr die ganze Anweisung, also käme die Rundmail bei niemandem an.
    assertEquals(own.actorId, null);

    // Bei allen anderen steht er sehr wohl da, sonst käme die Meldung von niemandem.
    const others = await db
      .selectFrom("notification")
      .innerJoin("chatGroup", "chatGroup.id", "notification.chatGroupId")
      .innerJoin("user", "user.id", "notification.recipientId")
      .select("notification.actorId")
      .where("chatGroup.id", "in", chatsOf(broadcast.id))
      .where("user.username", "!=", ROOT)
      .execute();

    assert(others.length > 0);
    assert(others.every((row) => row.actorId !== null));
  } finally {
    await cleanUp();
  }
});

Deno.test("die Zustellung sagt offenen Fenstern Bescheid", async () => {
  const cookies = await fixture();

  const second = await db
    .selectFrom("user")
    .select("id")
    .where("username", "=", SECOND)
    .executeTakeFirstOrThrow();

  const seen: ChatEvent[] = [];
  const unsubscribe = subscribeToChatEvents(second.id, (event) => {
    seen.push(event);
  });

  try {
    await submit(cookies.root);

    // **Ohne das blieb eine offene Seite auf ihrer alten Chatliste sitzen.** Die Zustellung schrieb
    // ihre Zeilen direkt in die Datenbank, ohne den Strom zu bedienen, den jede gewöhnliche
    // Nachricht bedient — und die Glocke führte dann auf ein Gespräch, das die Liste nicht kannte.
    assertEquals(seen.length, 1);

    const [event] = seen;
    assertExists(event);
    assertEquals(event.message.text, BODY);
    assertEquals(event.message.createdByUsername, ROOT);

    // Das Ereignis nennt dasselbe Gespräch, das auch in der Datenbank steht — sonst zeigte die
    // Oberfläche eine Nachricht in einem Faden, den es nicht gibt.
    const chat = await db
      .selectFrom("userInChatGroup")
      .select("chatGroupId")
      .where("userId", "=", second.id)
      .where("chatGroupId", "in", chatsOf((await theBroadcast()).id))
      .executeTakeFirstOrThrow();

    assertEquals(event.chatGroupId, chat.chatGroupId);
  } finally {
    unsubscribe();
    await cleanUp();
  }
});

Deno.test("der Absender bekommt kein Ereignis für die eigene Rundmail", async () => {
  const cookies = await fixture();

  const root = await db
    .selectFrom("user")
    .select("id")
    .where("username", "=", ROOT)
    .executeTakeFirstOrThrow();

  const seen: ChatEvent[] = [];
  const unsubscribe = subscribeToChatEvents(root.id, (event) => {
    seen.push(event);
  });

  try {
    await submit(cookies.root);

    // Dieselbe Regel wie beim gewöhnlichen Senden: Wer schreibt, sieht es dort, wo er geschrieben
    // hat. Ein Ereignis an ihn selbst wäre eine Nachricht, die zweimal auftaucht.
    assertEquals(seen, []);
  } finally {
    unsubscribe();
    await cleanUp();
  }
});

Deno.test("eine Rundmail lässt sich nicht verlassen", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const chat = await chatOf(await theBroadcast(), SECOND);

    const response = await request(
      "DELETE",
      `/api/chats/${chat}/memberships/me`,
      cookies.second,
    );

    // **Nicht nur unpassend, sondern zerstörend.** Im Rundmail-Gespräch sitzt nur das Mitglied;
    // ginge es hinaus, bliebe keine Mitgliedschaft übrig, und der Auslöser räumt das Gespräch dann
    // ab. Die zugestellte Rundmail wäre gelöscht, samt allem, was darunter gesagt wurde — und aus
    // der Antwortliste des Teams verschwände sie mit.
    assertEquals(response.status, STATUS_CODE.Forbidden);

    // Und es steht auch wirklich noch da.
    const still = await db
      .selectFrom("userInChatGroup")
      .select("userId")
      .where("chatGroupId", "=", chat)
      .execute();

    assertEquals(still.length, 1);
  } finally {
    await cleanUp();
  }
});

Deno.test("zu einer Rundmail lässt sich niemand einladen", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const chat = await chatOf(await theBroadcast(), SECOND);

    const outsider = await db
      .selectFrom("user")
      .select("id")
      .where("username", "=", MEMBER)
      .executeTakeFirstOrThrow();

    const response = await request(
      "POST",
      `/api/chats/${chat}/memberships`,
      cookies.second,
      { userId: outsider.id },
    );

    // Dort sitzt nur das Mitglied, und das ist die Zusage: Niemand sieht die Antwort eines anderen.
    assertEquals(response.status, STATUS_CODE.Forbidden);
  } finally {
    await cleanUp();
  }
});

Deno.test("der Archiv-Beitrag ist ein Dokument, keine Zeichenkette", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root, { publishInArchive: true });

    const broadcast = await theBroadcast();
    assertExists(broadcast.archivePostId);

    const post = await db
      .selectFrom("writingPost")
      .select((eb) => [
        "text",
        eb.fn<string>("jsonb_typeof", ["document"]).as("kind"),
      ])
      .where("id", "=", broadcast.archivePostId)
      .executeTakeFirstOrThrow();

    // **`JSON.stringify` legt in einer jsonb-Spalte eine JSON-*Zeichenkette* ab.** Der Editor
    // bekommt dann Text, wo er einen Baum erwartet, und zeichnet nichts: Der Beitrag steht da und
    // ist leer. Genau so sind die ersten Archiv-Beiträge entstanden, und auffallen kann das nur
    // hier — die Zeile sieht in jedem Diff richtig aus.
    assertEquals(post.kind, "object");

    // Und der Volltext kommt aus dem Dokument, kann ihm also nicht widersprechen.
    assert(post.text.startsWith(SUBJECT));
    assert(post.text.includes(BODY.split("\n\n")[0] ?? ""));
  } finally {
    await cleanUp();
  }
});

Deno.test("namentlich Genannte kommen zu den Rollen hinzu", async () => {
  const cookies = await fixture();

  const member = await db
    .selectFrom("user")
    .select("id")
    .where("username", "=", MEMBER)
    .executeTakeFirstOrThrow();

  try {
    // MEMBER ist gewöhnliches Mitglied und stünde über die Rolle „administrator" nicht drin.
    await submit(cookies.root, { memberIds: [member.id] });

    const broadcast = await theBroadcast();

    const reached = await db
      .selectFrom("chatGroup")
      .innerJoin(
        "userInChatGroup",
        "userInChatGroup.chatGroupId",
        "chatGroup.id",
      )
      .innerJoin("user", "user.id", "userInChatGroup.userId")
      .select("user.username")
      .where("chatGroup.id", "in", chatsOf(broadcast.id))
      .execute();

    const names = reached.map((row) => row.username);

    // **Die Vereinigung, nicht das eine oder das andere.**
    assert(names.includes(MEMBER));
    assert(names.includes(SECOND));
    assert(names.includes(ROOT));
  } finally {
    await cleanUp();
  }
});

Deno.test("wer über Rolle und Namen drinsteht, bekommt sie einmal", async () => {
  const cookies = await fixture();

  const second = await db
    .selectFrom("user")
    .select("id")
    .where("username", "=", SECOND)
    .executeTakeFirstOrThrow();

  try {
    // SECOND ist Administration — und wird zusätzlich namentlich genannt.
    await submit(cookies.root, { memberIds: [second.id] });

    const chats = await db
      .selectFrom("chatGroup")
      .innerJoin(
        "userInChatGroup",
        "userInChatGroup.chatGroupId",
        "chatGroup.id",
      )
      .innerJoin("user", "user.id", "userInChatGroup.userId")
      .select("chatGroup.id")
      .where("chatGroup.id", "in", chatsOf((await theBroadcast()).id))
      .where("user.username", "=", SECOND)
      .execute();

    // Zwei Gespräche wären zwei Rundmails im selben Postfach, für dieselbe Nachricht.
    assertEquals(chats.length, 1);
  } finally {
    await cleanUp();
  }
});

Deno.test("namentlich Genannte und das Archiv schließen sich aus", async () => {
  const cookies = await fixture();

  const member = await db
    .selectFrom("user")
    .select("id")
    .where("username", "=", MEMBER)
    .executeTakeFirstOrThrow();

  try {
    const response = await submit(cookies.root, {
      memberIds: [member.id],
      publishInArchive: true,
    });

    // Eine Rundmail an vier Leute ist keine Ankündigung. Sie im Forum abzulegen hieße, sie allen zu
    // zeigen — und das Archiv ist der Ort, an dem nachgelesen wird, was je *angekündigt* wurde.
    // Das Formular bietet den Haken dort nicht an; verbindlich ist diese Absage.
    assertEquals(response.status, STATUS_CODE.BadRequest);
  } finally {
    await cleanUp();
  }
});

Deno.test("ohne Rolle und ohne Namen wird abgelehnt", async () => {
  const cookies = await fixture();

  try {
    const response = await submit(cookies.root, {
      audienceRoles: [],
      memberIds: [],
    });

    assertEquals(response.status, STATUS_CODE.BadRequest);
  } finally {
    await cleanUp();
  }
});
