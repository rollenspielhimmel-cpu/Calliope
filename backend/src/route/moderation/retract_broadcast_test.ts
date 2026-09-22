import { assert, assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  type ChatEvent,
  subscribeToChatEvents,
} from "@/src/event/chat_events.ts";
import {
  getUserId,
  registerUser,
  request,
  scopedTestData,
} from "@/src/test/support.ts";
import { borrowPrimordialSeat } from "@/src/test/primordial_seat.ts";
import { RETRACTED_TEXT } from "@/src/service/broadcast_queue_service.ts";
import { mailsStillWanted } from "@/src/service/broadcast_service.ts";

/**
 * Eine versendete Rundmail zurückziehen.
 *
 * **Die Zusage, um die es geht:** Danach steht vom Wortlaut nichts mehr in der Datenbank — nicht im
 * Postfach, nicht im Archiv, nicht an der Rundmail selbst, auch nicht der Betreff. Was bleibt, ist,
 * wer wann zurückgezogen hat. Geprüft wird das mit einer Suche nach dem Text über die ganzen
 * Tabellen, nicht an den Stellen, an denen man ihn erwartet: Eine vergessene Stelle fände sonst
 * niemand.
 *
 * **Gesendet wird namentlich an die eigenen Konten**, nicht an eine Rolle — eine Rundmail an alle
 * Administratoren landete in den Postfächern jeder anderen Datei, die gerade läuft.
 */

const ROOT = "rb-root";
const OTHER = "rb-other";
const MEMBER = "rb-member";
const SECOND = "rb-second";

const USERS = [ROOT, OTHER, MEMBER, SECOND];

const SUBJECT = "Zurueckzieh-Test Betreff";
const BODY = "Ein Satz, der nach dem Zurückziehen nirgends mehr stehen darf.";

const data = scopedTestData({
  users: USERS,
  seat: ROOT,
  // **Über den Verfasser, nicht über den Betreff:** Nach dem Zurückziehen heißt die Rundmail
  // „Zurückgezogen", und ihr Archivbeitrag trägt den Ersatztext. Wer nach dem Betreff aufräumte,
  // ließe genau die Zeilen stehen, um die es hier geht.
  remove: async (transaction) => {
    const ours = transaction
      .selectFrom("publication")
      .select("id")
      .where(
        "writtenBy",
        "in",
        transaction.selectFrom("user").select("id").where(
          "username",
          "in",
          USERS,
        ),
      );

    await transaction
      .deleteFrom("writingPost")
      .where(
        "id",
        "in",
        transaction
          .selectFrom("broadcast")
          .select("archivePostId")
          .where("publicationId", "in", ours)
          .where("archivePostId", "is not", null)
          .$castTo<{ archivePostId: string }>(),
      )
      .execute();

    await transaction.deleteFrom("publication").where("id", "in", ours)
      .execute();
  },
});

const cleanUp = data.cleanUp;

async function setRole(username: string, role: "administrator" | null) {
  await db
    .updateTable("user")
    .set({ platformRole: role })
    .where("username", "=", username)
    .execute();
}

function fixture() {
  return data.freshly(async () => {
    const cookies = {
      root: await registerUser(ROOT),
      other: await registerUser(OTHER),
      member: await registerUser(MEMBER),
    };
    await registerUser(SECOND);

    await setRole(ROOT, "administrator");
    await setRole(OTHER, "administrator");

    // Der Ur-Admin gibt mit dem Schreiben frei — und nur er zieht zurück.
    await borrowPrimordialSeat(ROOT);

    return cookies;
  });
}

async function submit(
  cookie: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request(
    "POST",
    "/api/moderation/broadcast/queue",
    cookie,
    {
      subject: SUBJECT,
      body: BODY,
      audienceRoles: [],
      memberIds: [await getUserId(MEMBER), await getUserId(SECOND)],
      includeUnverified: false,
      deliverToInbox: true,
      deliverByEmail: false,
      publishInArchive: false,
      sendAsUserId: null,
      scheduledFor: null,
      ...overrides,
    },
  );
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json() as {
    publicationId: string;
    broadcastId: string;
  };
}

function retract(cookie: string, publicationId: string) {
  return request(
    "POST",
    `/api/moderation/broadcast/released/${publicationId}/retraction`,
    cookie,
  );
}

/**
 * Wo der Wortlaut noch steht — über alle Tabellen, in denen Text einer Rundmail je lag.
 *
 * Absichtlich breit: nicht „die Nachrichten dieser Rundmail", sondern jede Nachricht, jeder
 * Beitrag, jede Rundmail, die den Satz trägt. Gezählt wird nur, was diese Datei geschrieben hat,
 * weil Text und Betreff nur ihr gehören.
 */
async function whereTheWordingStands(): Promise<string[]> {
  const found: string[] = [];

  const messages = await db
    .selectFrom("chatMessage")
    .select("id")
    .where((eb) =>
      eb.or([
        eb("text", "like", `%${BODY}%`),
        eb("subject", "=", SUBJECT),
      ])
    )
    .execute();
  found.push(...messages.map(() => "chat_message"));

  const broadcasts = await db
    .selectFrom("broadcast")
    .select("id")
    .where((eb) =>
      eb.or([
        eb("body", "like", `%${BODY}%`),
        eb("subject", "=", SUBJECT),
      ])
    )
    .execute();
  found.push(...broadcasts.map(() => "broadcast"));

  const posts = await db
    .selectFrom("writingPost")
    .select("id")
    .where("text", "like", `%${BODY}%`)
    .execute();
  found.push(...posts.map(() => "writing_post"));

  return found;
}

Deno.test("zurückgezogen: vom Wortlaut bleibt nichts, nirgends", async () => {
  const cookies = await fixture();

  try {
    const { publicationId, broadcastId } = await submit(cookies.root);

    // Die Gegenprobe zur Gegenprobe: Vorher steht er da, sonst bewiese das Folgende nichts.
    assert((await whereTheWordingStands()).length > 0, "vorher zugestellt");

    const response = await retract(cookies.root, publicationId);
    assertEquals(response.status, STATUS_CODE.OK);
    assertEquals((await response.json()).inboxes, 2);

    assertEquals(await whereTheWordingStands(), []);

    // An seiner Stelle der Ersatz, damit Antworten darunter nicht in der Luft hängen.
    const copies = await db
      .selectFrom("chatMessage")
      .select(["text", "subject"])
      .where("broadcastId", "=", broadcastId)
      .execute();
    assertEquals(copies.length, 2);
    for (const copy of copies) {
      assertEquals(copy.text, RETRACTED_TEXT);
      assertEquals(copy.subject, null);
    }
  } finally {
    await cleanUp();
  }
});

Deno.test("zurückgezogen: im Archiv steht der Ersatz statt einer stillen Lücke", async () => {
  const cookies = await fixture();

  try {
    // Ins Archiv kommt nur eine Rundmail an alle — ohne Postfach, damit sie nicht in die
    // Postfächer jeder anderen Datei geht, die gerade läuft.
    const { publicationId } = await submit(cookies.root, {
      audienceRoles: ["administrator", "moderator", "member"],
      memberIds: [],
      deliverToInbox: false,
      publishInArchive: true,
    });

    const before = await db
      .selectFrom("broadcast")
      .select("archivePostId")
      .where("publicationId", "=", publicationId)
      .executeTakeFirstOrThrow();
    assertExists(before.archivePostId);

    assertEquals(
      (await retract(cookies.root, publicationId)).status,
      STATUS_CODE.OK,
    );

    const post = await db
      .selectFrom("writingPost")
      .select(["text", "editedBy"])
      .where("id", "=", before.archivePostId)
      .executeTakeFirstOrThrow();

    // Ersetzt, nicht gelöscht — und der Volltext mit, sonst fände die Suche ihn weiter.
    assertEquals(post.text, RETRACTED_TEXT);
    assertEquals(post.editedBy, await getUserId(ROOT));
    assertEquals(await whereTheWordingStands(), []);
  } finally {
    await cleanUp();
  }
});

Deno.test("zurückgezogen: wer, wann und wie viele bleiben stehen", async () => {
  const cookies = await fixture();

  try {
    const { publicationId } = await submit(cookies.root);
    await retract(cookies.root, publicationId);

    const released = await (await request(
      "GET",
      "/api/moderation/broadcast/released",
      cookies.root,
    )).json() as Array<Record<string, unknown>>;
    const entry = released.find((row) => row.publicationId === publicationId);
    assertExists(entry);

    // Sie *wurde* versendet — der Zustand bleibt, das Zurückziehen steht daneben.
    assertEquals(entry.status, "released");
    assertEquals(entry.retractedByUsername, ROOT);
    assertExists(entry.retractedAt);
    assertEquals(entry.recipientCount, 2);
    // Wer sie bekam, ist kein Inhalt — und man braucht es gerade danach.
    assertEquals(
      (entry.namedRecipients as Array<{ username: string }>)
        .map((recipient) => recipient.username)
        .toSorted(),
      [MEMBER, SECOND],
    );
  } finally {
    await cleanUp();
  }
});

Deno.test("nur der Ur-Admin zieht zurück", async () => {
  const cookies = await fixture();

  try {
    const { publicationId } = await submit(cookies.root);

    // Eine Administration wie jede andere — aber nicht das Konto, das ohne Freigabe sendet.
    const response = await retract(cookies.other, publicationId);
    assertEquals(response.status, STATUS_CODE.Forbidden);

    // Und abgewiesen heißt: nichts angefasst.
    assert((await whereTheWordingStands()).length > 0);
  } finally {
    await cleanUp();
  }
});

Deno.test("zweimal zurückziehen geht nicht", async () => {
  const cookies = await fixture();

  try {
    const { publicationId } = await submit(cookies.root);

    assertEquals(
      (await retract(cookies.root, publicationId)).status,
      STATUS_CODE.OK,
    );
    assertEquals(
      (await retract(cookies.root, publicationId)).status,
      STATUS_CODE.Conflict,
    );
  } finally {
    await cleanUp();
  }
});

Deno.test("was noch wartet, wird verworfen, nicht zurückgezogen", async () => {
  const cookies = await fixture();

  try {
    // Von einer gewöhnlichen Administration mit Termin eingereicht: freigegeben, aber noch nicht
    // raus. Ohne Termin ginge sie sofort, seit Administrationen mit dem Schreiben freigeben.
    const { publicationId } = await submit(cookies.other, {
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    assertEquals(
      (await retract(cookies.root, publicationId)).status,
      STATUS_CODE.Conflict,
    );
  } finally {
    await cleanUp();
  }
});

Deno.test("wer das Gespräch offen hat, sieht den Ersatz sofort", async () => {
  const cookies = await fixture();
  const received: ChatEvent[] = [];
  const unsubscribe = subscribeToChatEvents(
    await getUserId(MEMBER),
    (event) => received.push(event),
  );

  try {
    const { publicationId, broadcastId } = await submit(cookies.root);
    const delivered = await db
      .selectFrom("chatMessage")
      .innerJoin("chatGroup", "chatGroup.id", "chatMessage.chatGroupId")
      .select("chatMessage.id")
      .where("chatMessage.broadcastId", "=", broadcastId)
      .where(
        "chatGroup.administrationPartnerId",
        "=",
        await getUserId(MEMBER),
      )
      .executeTakeFirstOrThrow();

    received.length = 0;
    await retract(cookies.root, publicationId);

    // Dieselbe Kennung wie die zugestellte Nachricht: Die Oberfläche legt den Ersatz darüber.
    // Sonst sähe genau der den Text weiter, bei dem er weg soll.
    const replacement = received.find((event) =>
      event.message.id === delivered.id
    );
    assertExists(replacement);
    assertEquals(replacement.message.text, RETRACTED_TEXT);
  } finally {
    unsubscribe();
    await cleanUp();
  }
});

Deno.test("im Postfach der Administration steht, wer wann zurückgezogen hat", async () => {
  const cookies = await fixture();

  try {
    const { publicationId, broadcastId } = await submit(cookies.root);
    const thread = await db
      .selectFrom("chatMessage")
      .innerJoin("chatGroup", "chatGroup.id", "chatMessage.chatGroupId")
      .select("chatGroup.id")
      .where("chatMessage.broadcastId", "=", broadcastId)
      .where(
        "chatGroup.administrationPartnerId",
        "=",
        await getUserId(MEMBER),
      )
      .executeTakeFirstOrThrow();

    await retract(cookies.root, publicationId);

    const { messages } = await (await request(
      "GET",
      `/api/moderation/inbox/${thread.id}`,
      cookies.other,
    )).json() as {
      messages: Array<
        { text: string; retractedByUsername: string | null }
      >;
    };

    const announcement = messages.find((message) =>
      message.text === RETRACTED_TEXT
    );
    assertExists(announcement);
    assertEquals(announcement.retractedByUsername, ROOT);
  } finally {
    await cleanUp();
  }
});

/**
 * **Das Zurückziehen erreicht die Mail-Schleife dieser Rundmail.** Die Arbeiter selbst prüft
 * `broadcast_service_test.ts` mit einer Attrappe; hier geht es um die Verbindung dazwischen — ohne
 * sie hielten die Arbeiter tadellos an, nur nie, weil niemand es ihnen sagte.
 */
Deno.test("nach dem Zurückziehen gehen ihre übrigen Mails nicht mehr raus", async () => {
  const cookies = await fixture();

  try {
    const { publicationId, broadcastId } = await submit(cookies.root);
    assertEquals(mailsStillWanted(broadcastId), true);

    await retract(cookies.root, publicationId);

    assertEquals(mailsStillWanted(broadcastId), false);
  } finally {
    await cleanUp();
  }
});
