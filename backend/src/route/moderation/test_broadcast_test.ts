import { assert, assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  getUserId,
  registerUser,
  request,
  scopedTestData,
  write,
} from "@/src/test/support.ts";
import { deleteMailFor, waitForMail } from "@/src/test/mailpit.ts";
import { AdminInboxService } from "@/src/service/admin_inbox_service.ts";
import { MAIL_TEST_MARK } from "@/src/service/broadcast_service.ts";

/**
 * Die Test-Rundmail.
 *
 * **Die eine Zusage, um die es geht:** Sie geht an die Person, die den Knopf drückt, und an niemanden
 * sonst — und sie zählt nicht als gesendet. Alles andere hier folgt daraus: ein eigener Faden, der
 * in keinem Postfach des Teams steht, in den niemand eingeladen werden kann und in dem niemand
 * antwortet.
 *
 * **Absender ist überall eine freigeschaltete Kunstfigur, nicht der Ur-Admin.** Der Ur-Admin-Absender
 * wird erst beim Versand aufgelöst, zu dem Konto, das den Platz gerade hält — in einem parallelen
 * Lauf oft das einer anderen Datei. Eine Kunstfigur dieser Datei gehört nur ihr.
 */

const TESTER = "bt-tester";
const OTHER = "bt-other";
const MODERATOR = "bt-moderator";
const PERSONA = "bt-persona";
const SECOND_PERSONA = "bt-persona-two";
const MEMBER = "bt-member";

const USERS = [TESTER, OTHER, MODERATOR, PERSONA, SECOND_PERSONA, MEMBER];

const SUBJECT = "Test-Rundmail-Test";
const BODY = "So sähe sie aus.";

const data = scopedTestData({
  users: USERS,
  // Nichts weiter: Die Test-Rundmail legt keine Veröffentlichung an, und ihre Fäden gehen mit den
  // Konten. Bliebe doch etwas stehen, fände es „eine Test-Rundmail zählt nicht als gesendet" im
  // nächsten Lauf.
  remove: async () => {},
});

async function setRole(
  username: string,
  role: "administrator" | "moderator" | null,
) {
  await write((transaction) =>
    transaction
      .updateTable("user")
      .set({ platformRole: role })
      .where("username", "=", username)
      .execute()
  );
}

function fixture() {
  return data.freshly(async () => {
    const cookies = {
      tester: await registerUser(TESTER),
      other: await registerUser(OTHER),
      moderator: await registerUser(MODERATOR),
      member: await registerUser(MEMBER),
    };

    await registerUser(PERSONA);
    await registerUser(SECOND_PERSONA);

    await setRole(TESTER, "administrator");
    await setRole(OTHER, "administrator");
    await setRole(MODERATOR, "moderator");

    await write(async (transaction) =>
      transaction
        .insertInto("broadcastSender")
        .values([
          { userId: await getUserId(PERSONA) },
          { userId: await getUserId(SECOND_PERSONA) },
        ])
        .execute()
    );

    await deleteMailFor([`${TESTER}@example.com`, `${OTHER}@example.com`]);

    return cookies;
  });
}

const cleanUp = data.cleanUp;

async function sendTest(
  cookie: string,
  overrides: Record<string, unknown> = {},
) {
  return await request("POST", "/api/moderation/broadcast/test", cookie, {
    subject: SUBJECT,
    body: BODY,
    sendAsUserId: await getUserId(PERSONA),
    deliverByEmail: false,
    ...overrides,
  });
}

/** Jede Nachricht mit dem Betreff dieser Datei, wo immer sie liegt — der Betreff gehört nur ihr. */
async function everyCopy() {
  return await db
    .selectFrom("chatMessage")
    .innerJoin("chatGroup", "chatGroup.id", "chatMessage.chatGroupId")
    .leftJoin("user as sender", "sender.id", "chatMessage.createdBy")
    .select([
      "chatMessage.chatGroupId",
      "chatMessage.text",
      "chatMessage.subject",
      "chatMessage.broadcastId",
      "sender.username as senderUsername",
      "chatGroup.isTestBroadcast",
      "chatGroup.addressedToAdministration",
    ])
    .where("chatMessage.subject", "=", SUBJECT)
    .execute();
}

async function membersOf(chatGroupId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("userInChatGroup")
    .innerJoin("user", "user.id", "userInChatGroup.userId")
    .select("user.username")
    .where("userInChatGroup.chatGroupId", "=", chatGroupId)
    .execute();

  return rows.map((row) => row.username).toSorted();
}

Deno.test("eine Test-Rundmail kommt nur bei der Person an, die testet", async () => {
  const cookies = await fixture();

  try {
    const response = await sendTest(cookies.tester);
    assertEquals(response.status, STATUS_CODE.OK);
    const { chatGroupId } = await response.json();

    // **Die Zusage, gezählt über die ganze Datenbank.** Der Betreff gehört nur dieser Datei, also
    // ist „jede Kopie" hier wirklich jede — nicht bloß die, die man zu suchen dachte.
    const copies = await everyCopy();
    assertEquals(copies.length, 1);

    const [copy] = copies;
    assertExists(copy);
    assertEquals(copy.chatGroupId, chatGroupId);
    assertEquals(await membersOf(chatGroupId), [TESTER]);

    // So, wie sie ankäme: derselbe Absender, derselbe Text. **Ohne Markierung im Text** — die
    // zeichnet die Oberfläche am Test-Faden, fett und gesperrt; gespeichert stünde sie doppelt.
    assertEquals(copy.senderUsername, PERSONA);
    assertEquals(copy.text, BODY);
    assert(copy.isTestBroadcast);
  } finally {
    await cleanUp();
  }
});

Deno.test("eine Test-Rundmail zählt nicht als gesendet", async () => {
  const cookies = await fixture();

  try {
    await sendTest(cookies.tester);

    // Keine Veröffentlichung und keine Rundmail: nichts, was freigegeben, gezählt oder unter
    // „Gesendete" stehen könnte.
    const broadcasts = await db
      .selectFrom("broadcast")
      .select("id")
      .where("subject", "=", SUBJECT)
      .execute();
    assertEquals(broadcasts, []);

    const [copy] = await everyCopy();
    assertExists(copy);
    assertEquals(copy.broadcastId, null);
  } finally {
    await cleanUp();
  }
});

/**
 * **Der Grund für den eigenen Faden.** Im echten Faden zwischen dieser Person und dem Absender kann
 * eine offene Frage stehen. Eine Nachricht dort würde sie still schließen — und alle Admins läsen
 * die Test-Rundmail im Verlauf mit.
 */
Deno.test("eine Test-Rundmail lässt den echten Faden und seine offene Frage in Ruhe", async () => {
  const cookies = await fixture();

  try {
    const tester = await getUserId(TESTER);
    const persona = await getUserId(PERSONA);

    const real = await db.transaction().execute(async (transaction) =>
      (await AdminInboxService.findOrCreateThreads(
        transaction,
        { id: persona, username: PERSONA },
        [tester],
      )).get(tester)
    );
    assertExists(real);

    await write((transaction) =>
      transaction
        .insertInto("chatMessage")
        .values({
          chatGroupId: real,
          text: "Eine echte Frage.",
          createdBy: tester,
        })
        .execute()
    );

    const response = await sendTest(cookies.tester);
    const { chatGroupId } = await response.json();

    assert(chatGroupId !== real, "ein eigener Faden, nicht der echte");

    const inbox =
      await (await request("GET", "/api/moderation/inbox", cookies.other))
        .json();
    const entry = inbox.results.find(
      (row: { chatGroupId: string }) => row.chatGroupId === real,
    );
    assertExists(entry);
    assertEquals(entry.awaitingReply, true);

    // Und der Test-Faden steht in keinem Postfach des Teams.
    assert(
      !inbox.results.some((row: { chatGroupId: string }) =>
        row.chatGroupId === chatGroupId
      ),
    );
  } finally {
    await cleanUp();
  }
});

Deno.test("wiederholtes Testen füllt denselben Faden, je Absender einen", async () => {
  const cookies = await fixture();

  try {
    const first = await (await sendTest(cookies.tester)).json();
    const again = await (await sendTest(cookies.tester)).json();
    const other = await (await sendTest(cookies.tester, {
      sendAsUserId: await getUserId(SECOND_PERSONA),
    })).json();

    assertEquals(again.chatGroupId, first.chatGroupId);
    assert(other.chatGroupId !== first.chatGroupId);
  } finally {
    await cleanUp();
  }
});

Deno.test("in den Test-Faden lässt sich niemand einladen, und niemand antwortet darin", async () => {
  const cookies = await fixture();

  try {
    const { chatGroupId } = await (await sendTest(cookies.tester)).json();

    const invited = await request(
      "POST",
      `/api/chats/${chatGroupId}/memberships`,
      cookies.tester,
      { userId: await getUserId(OTHER) },
    );
    assertEquals(invited.status, STATUS_CODE.Forbidden);

    const written = await request(
      "POST",
      `/api/chats/${chatGroupId}/messages`,
      cookies.tester,
      { text: "Eine Antwort, die an niemanden ginge." },
    );
    assertEquals(written.status, STATUS_CODE.Forbidden);

    assertEquals(await membersOf(chatGroupId), [TESTER]);
  } finally {
    await cleanUp();
  }
});

Deno.test("den Test-Faden darf man verlassen", async () => {
  const cookies = await fixture();

  try {
    const { chatGroupId } = await (await sendTest(cookies.tester)).json();

    const left = await request(
      "DELETE",
      `/api/chats/${chatGroupId}/memberships/me`,
      cookies.tester,
    );
    assert(left.ok, `verlassen: ${left.status}`);

    // Wer als Letzter geht, nimmt den Faden mit — er sammelt sich nicht an.
    const still = await db
      .selectFrom("chatGroup")
      .select("id")
      .where("id", "=", chatGroupId)
      .execute();
    assertEquals(still, []);
  } finally {
    await cleanUp();
  }
});

Deno.test("mit E-Mail geht die Test-Mail an die eigene Adresse, markiert im Betreff", async () => {
  const cookies = await fixture();

  try {
    const response = await sendTest(cookies.tester, { deliverByEmail: true });
    assertEquals((await response.json()).email, "sent");

    // Gemessen an Mailpit, nicht angenommen: Die Mail ist wirklich angekommen, und so sieht sie aus.
    const mail = await waitForMail(`${TESTER}@example.com`);
    // So nah an der Markierung im Postfach, wie es in einer Betreffzeile geht: Großbuchstaben,
    // aber keine Leerzeichen zwischen den Buchstaben — sonst läse ein Vorleseprogramm sie einzeln.
    assertEquals(mail.subject, `${MAIL_TEST_MARK} ${SUBJECT}`);
    assertEquals(MAIL_TEST_MARK, "— TEST-RUNDMAIL —");
    assert(
      mail.text.startsWith(MAIL_TEST_MARK),
      "die Marke steht auch vor dem Mailtext",
    );
    assert(mail.text.includes(BODY));
  } finally {
    await deleteMailFor([`${TESTER}@example.com`]);
    await cleanUp();
  }
});

Deno.test("unter einem nicht freigeschalteten Namen wird nicht getestet", async () => {
  const cookies = await fixture();

  try {
    const response = await sendTest(cookies.tester, {
      sendAsUserId: await getUserId(OTHER),
    });

    // Sonst ließe sich über den Test ausprobieren, wie eine Nachricht unter einem beliebigen Namen
    // aussähe.
    assertEquals(response.status, STATUS_CODE.Forbidden);
    assertEquals(await everyCopy(), []);
  } finally {
    await cleanUp();
  }
});

/** Wer vorbereiten darf, darf testen — und auch beim Mod kommt sie nur bei ihm selbst an. */
Deno.test("ein Mod testet, und nur er bekommt sie", async () => {
  const cookies = await fixture();

  try {
    // Als „Admin": Den hat die Moderation seit der Migration, die Absender dieser Datei nicht.
    const response = await sendTest(cookies.moderator, { sendAsUserId: null });
    assertEquals(response.status, STATUS_CODE.OK);
    const { chatGroupId } = await response.json();

    const copies = await everyCopy();
    assertEquals(copies.length, 1);
    assertEquals(await membersOf(chatGroupId), [MODERATOR]);
  } finally {
    await cleanUp();
  }
});

Deno.test("ein Mitglied ohne Rolle erreicht die Test-Rundmail nicht", async () => {
  const cookies = await fixture();

  try {
    assertEquals(
      (await sendTest(cookies.member)).status,
      STATUS_CODE.Forbidden,
    );
    assertEquals(await everyCopy(), []);
  } finally {
    await cleanUp();
  }
});
