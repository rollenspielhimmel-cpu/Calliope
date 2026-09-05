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
  audienceGroups: ["administrator"],
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
 * **Nirgends wird mit festen Zahlen gerechnet.** Die Datenbank enthält weitere Administratoren —
 * Saatkonten und was andere Läufe hinterlassen —, und ein Test, der „genau drei" behauptet, prüft
 * am Ende nur, wer sonst noch angemeldet ist. Die Erwartung wird deshalb aus derselben Regel
 * abgeleitet, die auch der Dienst anwendet.
 */
async function fixture() {
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
}

/** Der Empfängerkreis „Administration", wie der Dienst ihn auch bildet. */
async function administrators() {
  return await db
    .selectFrom("user")
    .select(["username", "emailAddressVerifiedAt"])
    .where("platformRole", "=", "administrator")
    .where("bannedAt", "is", null)
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
 * Der Faden im Forum hängt nur lose an der Veröffentlichung (`ON DELETE SET NULL`), also wird er
 * eigens gelöscht — sonst sammelt das Archiv bei jedem Lauf einen Test-Faden mehr.
 */
async function cleanUp() {
  await db
    .deleteFrom("writingThread")
    .where("title", "=", SUBJECT)
    .execute();

  await db
    .deleteFrom("publication")
    .where(
      "id",
      "in",
      db.selectFrom("broadcast").select("publicationId").where(
        "subject",
        "=",
        SUBJECT,
      ),
    )
    .execute();

  await returnPrimordialSeat(ROOT);
  await deleteUsers(USERS);
  await clearRateLimits();
}

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
      .selectFrom("notification")
      .innerJoin("user", "user.id", "notification.recipientId")
      .select("user.username")
      .where("notification.broadcastId", "=", broadcast.id)
      .execute();

    const reached = notified.map((row) => row.username);

    // Der mit der unbestätigten Adresse ist dabei: Die Bestätigung ist eine Frage an die E-Mail,
    // nicht an die Mitgliedschaft.
    assert(reached.includes(ROOT));
    assert(reached.includes(UNVERIFIED));
    assert(reached.includes(SECOND));

    // Und das gewöhnliche Mitglied nicht — die Rundmail ging an die Administration.
    assert(!reached.includes(MEMBER));

    // Genau der Kreis und niemand sonst, gegen dieselbe Regel geprüft, die der Dienst anwendet.
    assertEquals(
      reached.toSorted(),
      (await administrators()).map((row) => row.username).toSorted(),
    );
  } finally {
    await cleanUp();
  }
});

Deno.test("die Benachrichtigung nennt keinen Verursacher", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const broadcast = await theBroadcast();

    const actors = await db
      .selectFrom("notification")
      .select("actorId")
      .where("broadcastId", "=", broadcast.id)
      .execute();

    // Nicht kosmetisch: `notification_actor_is_not_recipient` verbietet, dass jemand sich selbst
    // benachrichtigt — und wer an alle schreibt, ist fast immer selbst unter „alle". Stünde der
    // Absender hier, fiele genau seine Zeile um und mit ihr die ganze Anweisung.
    assert(actors.length > 0);
    assert(actors.every((row) => row.actorId === null));
  } finally {
    await cleanUp();
  }
});

Deno.test("zwei Zahlen: das Postfach reicht weiter als die E-Mail", async () => {
  const cookies = await fixture();

  try {
    const response = await request(
      "GET",
      "/api/moderation/broadcast/recipients?groups=administrator&includeUnverified=false",
      cookies.root,
    );

    assertEquals(response.status, STATUS_CODE.OK);

    const reach = await response.json();
    const admins = await administrators();

    assertEquals(reach.inbox, admins.length);
    assertEquals(
      reach.email,
      admins.filter((row) => row.emailAddressVerifiedAt !== null).length,
    );

    // Und die beiden Zahlen fallen wirklich auseinander — sonst prüfte das Obige nur, dass zweimal
    // dasselbe gezählt wurde. Der mit der unbestätigten Adresse liest sein Postfach und bekommt
    // keine Mail.
    assert(reach.inbox > reach.email);
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

    const notifications = await db
      .selectFrom("notification")
      .select("id")
      .where("broadcastId", "=", broadcast.id)
      .execute();

    assertEquals(notifications, []);
    // Leer statt null: Eine Null sähe aus wie „an niemanden zugestellt" statt „dieser Weg war
    // nicht gewählt".
    assertEquals(broadcast.recipientCount, null);
  } finally {
    await cleanUp();
  }
});

Deno.test("der Archiv-Haken legt einen Faden im Forum an", async () => {
  const cookies = await fixture();

  try {
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
      .innerJoin("writingFolder", "writingFolder.id", "writingThread.folderId")
      .select([
        "writingThread.title",
        "writingThread.writingGroupId",
        "writingFolder.isBroadcastArchive",
        "writingPost.text",
      ])
      .where("writingPost.id", "=", broadcast.archivePostId)
      .executeTakeFirstOrThrow();

    assertEquals(post.title, SUBJECT);
    // Ohne Schreibgruppe: Genau das macht eine Zeile zu einer des Forums.
    assertEquals(post.writingGroupId, null);
    assert(post.isBroadcastArchive);
    assertEquals(post.text, BODY);
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

    const threads = await db
      .selectFrom("writingThread")
      .select("id")
      .where("title", "=", SUBJECT)
      .execute();

    assertEquals(threads, []);
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

Deno.test("gelesen wird nur, was im eigenen Postfach liegt", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root, { audienceGroups: ["moderator"] });

    const broadcast = await theBroadcast();

    // An die Moderation gerichtet, und niemand hier ist Moderation: Auch die Administration, die
    // sie geschrieben hat, liest sie nicht über diesen Weg. Ihre eigene Liste zeigt ihr mehr.
    const response = await request(
      "GET",
      `/api/notifications/broadcast/${broadcast.id}`,
      cookies.root,
    );

    assertEquals(response.status, STATUS_CODE.NotFound);
  } finally {
    await cleanUp();
  }
});

Deno.test("wer sie bekommen hat, liest sie nach", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const broadcast = await theBroadcast();

    const response = await request(
      "GET",
      `/api/notifications/broadcast/${broadcast.id}`,
      cookies.second,
    );

    assertEquals(response.status, STATUS_CODE.OK);

    const read = await response.json();
    assertEquals(read.subject, SUBJECT);
    assertEquals(read.body, BODY);
    // Kein Archiv-Haken, also kein Faden — und dann ist dieser Eintrag die eine Stelle mit dem Text.
    assertEquals(read.archiveThreadId, null);
  } finally {
    await cleanUp();
  }
});

Deno.test("steht sie im Forum, verweist das Nachlesen dorthin", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root, { publishInArchive: true });

    const broadcast = await theBroadcast();

    const response = await request(
      "GET",
      `/api/notifications/broadcast/${broadcast.id}`,
      cookies.second,
    );

    assertEquals(response.status, STATUS_CODE.OK);
    assert((await response.json()).archiveThreadId !== null);
  } finally {
    await cleanUp();
  }
});

Deno.test("die Reichweite wird beim Versand festgehalten", async () => {
  const cookies = await fixture();

  try {
    await submit(cookies.root);

    const broadcast = await theBroadcast();

    assertEquals(broadcast.recipientCount, (await administrators()).length);
    // Leer statt null: Eine Null sähe aus wie „an niemanden zugestellt" statt „dieser Weg war nicht
    // gewählt".
    assertEquals(broadcast.emailRecipientCount, null);
  } finally {
    await cleanUp();
  }
});
