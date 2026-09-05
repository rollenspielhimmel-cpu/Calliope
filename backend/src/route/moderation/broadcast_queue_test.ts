import { assert, assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  registerUser,
  request,
} from "@/src/test/support.ts";
import {
  borrowPrimordialSeat,
  returnPrimordialSeat,
} from "@/src/test/primordial_seat.ts";
import { BroadcastQueueService } from "@/src/service/broadcast_queue_service.ts";

/**
 * Die Warteschlange der Rundmails.
 *
 * **Was hier wirklich geprüft wird, ist eine Regel und keine Maske:** Eine Rundmail geht an alle,
 * ist nicht zurückzuholen, und trägt außen einen anderen Namen als die Person, die sie geschrieben
 * hat. Alles, was diese Datei festhält, ist die eine Sicherung, die davor greift — dass jemand
 * anderes hingesehen hat.
 */

const ROOT = "bq-root";
const AUTHOR = "bq-author";
const SECOND = "bq-second";
const MODERATOR = "bq-moderator";

const USERS = [ROOT, AUTHOR, SECOND, MODERATOR];

const SUBJECT = "Warteschlangen-Test";

const BROADCAST = {
  subject: SUBJECT,
  body: "Ein Text, der an alle ginge.",
  // Nur die Administration: Der Testlauf soll keine Post an erfundene Saatkonten auslösen.
  audienceGroups: ["administrator"],
  includeUnverified: false,
  sendAsUserId: null,
  scheduledFor: null,
} as const;

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

async function fixture() {
  const cookies = {
    root: await registerUser(ROOT),
    author: await registerUser(AUTHOR),
    second: await registerUser(SECOND),
    moderator: await registerUser(MODERATOR),
  };

  await setRole(ROOT, "administrator");
  await setRole(AUTHOR, "administrator");
  await setRole(SECOND, "administrator");
  await setRole(MODERATOR, "moderator");

  return cookies;
}

/**
 * Derselbe Aufbau, aber mit dem Ur-Admin-Platz.
 *
 * **Getrennt, weil es genau vier Tests hier sind.** Den Platz gibt es einmal, und wer ihn hält,
 * hält ihn für alle anderen Dateien mit. Ihn in jedem Aufbau zu leihen hieß, fünfzehn Tests warten
 * zu lassen für etwas, das sie nicht anfassen — und das ließ die Suite von zwei auf über drei
 * Minuten wachsen, bevor es auffiel.
 */
async function fixtureAsRoot() {
  const cookies = await fixture();

  await borrowPrimordialSeat(ROOT);

  return cookies;
}

Deno.test.beforeEach(clearRateLimits);

Deno.test.afterEach(async () => {
  await returnPrimordialSeat(ROOT);

  const ids = db.selectFrom("user").select("id").where("username", "in", USERS);

  await db.deleteFrom("publication").where("writtenBy", "in", ids).execute();

  await deleteUsers(USERS);
});

const submit = (cookie: string, body: Record<string, unknown> = {}) =>
  request("POST", "/api/moderation/broadcast/queue", cookie, {
    ...BROADCAST,
    ...body,
  });

const queue = (cookie: string) =>
  request("GET", "/api/moderation/broadcast/queue", cookie);

const released = (cookie: string) =>
  request("GET", "/api/moderation/broadcast/released", cookie);

const approve = (cookie: string, id: string) =>
  request(
    "POST",
    `/api/moderation/broadcast/queue/${id}/approval`,
    cookie,
  );

type Row = {
  publicationId: string;
  status: string;
  subject: string;
  writtenByUsername: string | null;
  approvedByUsername: string | null;
  sendAsUsername: string | null;
  recipientCount: number | null;
  releasedAt: string | null;
  includeUnverified: boolean;
  audienceGroups: string[];
};

/**
 * Nur die Einträge dieser Datei.
 *
 * Die Endpunkte geben alles zurück, was es gibt — und `only` verlangt genau einen. Ohne diesen
 * Filter zerbricht jeder Test an einer Rundmail, die irgendwer nebenher angelegt hat: einmal
 * durchgeklickt und nicht aufgeräumt, und die Datei ist rot.
 */
function ours(all: Row[]): Row[] {
  return all.filter((row) => row.subject === SUBJECT);
}

async function waiting(cookie: string): Promise<Row[]> {
  return ours(await (await queue(cookie)).json() as Row[]);
}

async function wentOut(cookie: string): Promise<Row[]> {
  return ours(await (await released(cookie)).json() as Row[]);
}

/** Genau eine — und sagt es, wenn es nicht so ist, statt am Feldzugriff zu scheitern. */
function only(rows: Row[]): Row {
  assertEquals(rows.length, 1, "genau ein Eintrag erwartet");
  return rows[0] as Row;
}

Deno.test("an ordinary administrator's broadcast waits rather than going out", async () => {
  const cookies = await fixture();

  const response = await submit(cookies.author);
  assertEquals(response.status, STATUS_CODE.Created);

  const created = await response.json() as Row;
  assertEquals(created.status, "awaiting_approval");
  assertEquals(created.releasedAt, null, "noch nichts raus");

  const inQueue = await waiting(cookies.second);
  assertEquals(only(inQueue).subject, SUBJECT);
  assertEquals(only(inQueue).writtenByUsername, AUTHOR);
  assertEquals(only(inQueue).approvedByUsername, null);
});

/**
 * Die Regel, die die Warteschlange zu mehr als einer Formalität macht. Sie steht so nicht in der
 * Anforderung — siehe die Herleitung in `broadcast_queue_service.ts`.
 */
Deno.test("nobody approves their own submission", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author)).json() as Row;

  const refused = await approve(cookies.author, created.publicationId);
  assertEquals(refused.status, STATUS_CODE.Forbidden);

  // Und sie wartet weiter, statt still verbraucht zu sein.
  assertEquals((await waiting(cookies.second)).length, 1);
});

Deno.test("a second administrator approves, and that sends it", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author)).json() as Row;

  assertEquals(
    (await approve(cookies.second, created.publicationId)).status,
    STATUS_CODE.OK,
  );

  assertEquals(
    (await waiting(cookies.second)).length,
    0,
    "raus aus der Schlange",
  );

  const sent = await wentOut(cookies.second);
  assertEquals(only(sent).status, "released");

  // Nach außen der gewählte Absender, intern beide echten Namen — der Sinn der ganzen Spur.
  assertEquals(only(sent).writtenByUsername, AUTHOR);
  assertEquals(only(sent).approvedByUsername, SECOND);

  // Beim Versand festgehalten, nicht später gezählt.
  const count = only(sent).recipientCount;
  assert(count !== null && count > 0, "die Empfängerzahl steht fest");
});

Deno.test("the first administrator needs no approval and it goes out at once", async () => {
  const cookies = await fixtureAsRoot();

  const created = await (await submit(cookies.root)).json() as Row;
  assertEquals(created.status, "released");

  assertEquals(
    (await waiting(cookies.second)).length,
    0,
    "wartet gar nicht erst",
  );

  const sent = await wentOut(cookies.second);

  // Auch hier steht, wer es verantwortet: kein Sonderfall mit leeren Feldern.
  assertEquals(only(sent).writtenByUsername, ROOT);
  assertEquals(only(sent).approvedByUsername, ROOT);
});

Deno.test("a moderator reaches none of this", async () => {
  const cookies = await fixture();

  assertEquals((await queue(cookies.moderator)).status, STATUS_CODE.Forbidden);
  assertEquals(
    (await released(cookies.moderator)).status,
    STATUS_CODE.Forbidden,
  );
  assertEquals((await submit(cookies.moderator)).status, STATUS_CODE.Forbidden);
});

/**
 * **Jede Bearbeitung nimmt die Freigabe zurück** — und zwar nicht nur die am Text. Der
 * Empfängerkreis zu tauschen ist dasselbe wie eine andere Mail zu senden, und genau darauf zielt
 * der Missbrauch, den die Freigabe verhindern soll.
 */
Deno.test("changing the audience takes back an approval", async () => {
  const cookies = await fixture();

  // Vom Ur-Admin, damit sie überhaupt in den freigegebenen Zustand kommt — und dann eingefangen,
  // bevor sie durch ist: hier wird die Bearbeitung einer bereits verschickten geprüft.
  const created = await (await submit(cookies.author)).json() as Row;

  const changed = await request(
    "PUT",
    `/api/moderation/broadcast/queue/${created.publicationId}`,
    cookies.author,
    { ...BROADCAST, audienceGroups: ["administrator", "member"] },
  );
  assertEquals(changed.status, STATUS_CODE.OK);

  const stillWaiting = await waiting(cookies.second);
  assertEquals(only(stillWaiting).status, "awaiting_approval");
  assertEquals(only(stillWaiting).approvedByUsername, null);
  assertEquals(only(stillWaiting).audienceGroups, ["administrator", "member"]);
});

Deno.test("what has gone out cannot be edited or discarded", async () => {
  const cookies = await fixtureAsRoot();

  const created = await (await submit(cookies.root)).json() as Row;

  assertEquals(
    (await request(
      "PUT",
      `/api/moderation/broadcast/queue/${created.publicationId}`,
      cookies.root,
      { ...BROADCAST, subject: "Nachträglich anders" },
    )).status,
    STATUS_CODE.Conflict,
  );

  assertEquals(
    (await request(
      "DELETE",
      `/api/moderation/broadcast/queue/${created.publicationId}`,
      cookies.root,
    )).status,
    STATUS_CODE.Conflict,
  );
});

Deno.test("approving twice sends once", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author)).json() as Row;

  assertEquals(
    (await approve(cookies.second, created.publicationId)).status,
    STATUS_CODE.OK,
  );
  assertEquals(
    (await approve(cookies.second, created.publicationId)).status,
    STATUS_CODE.Conflict,
  );

  assertEquals(
    (await wentOut(cookies.second)).length,
    1,
  );
});

Deno.test("a discarded broadcast leaves the queue and is never sent", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author)).json() as Row;

  assertEquals(
    (await request(
      "DELETE",
      `/api/moderation/broadcast/queue/${created.publicationId}`,
      cookies.author,
    )).status,
    STATUS_CODE.OK,
  );

  assertEquals((await waiting(cookies.second)).length, 0);
  assertEquals(
    (await wentOut(cookies.second)).length,
    0,
  );

  // Verworfen, nicht gelöscht: Was eingereicht wurde, bleibt als Spur stehen.
  const row = await db
    .selectFrom("publication")
    .select("status")
    .where("id", "=", created.publicationId)
    .executeTakeFirstOrThrow();

  assertEquals(row.status, "discarded");
});

// ── Zeitsteuerung ──────────────────────────────────────────────────────────────────────────────

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

/**
 * **Freigabe und Termin sind zwei Bedingungen, nicht eine.** Das ist die Regel, an der ein
 * Missverständnis teuer wäre: Ein Termin, der von selbst sendet, würde Ungeprüftes rausschicken;
 * eine Freigabe, die den Termin übergeht, würde die Ankündigung verfrühen.
 */
Deno.test("an approval with a date does not send yet", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author, {
    scheduledFor: inAnHour(),
  })).json() as Row;

  assertEquals(
    (await approve(cookies.second, created.publicationId)).status,
    STATUS_CODE.OK,
  );

  // Freigegeben, aber nicht raus — und deshalb weiterhin sichtbar, mit dem Zustand daneben. Eine
  // Rundmail, die an alle geht und in keiner Liste steht, wäre das Falsche.
  assertEquals(only(await waiting(cookies.second)).status, "approved");
  assertEquals(
    (await wentOut(cookies.second)).length,
    0,
  );

  const row = await db
    .selectFrom("publication")
    .select(["status", "approvedBy"])
    .where("id", "=", created.publicationId)
    .executeTakeFirstOrThrow();

  assertEquals(row.status, "approved");
  assert(row.approvedBy !== null, "die Freigabe steht");
});

Deno.test("the ticker sends what is approved and due", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author, {
    scheduledFor: anHourAgo(),
  })).json() as Row;

  await approve(cookies.second, created.publicationId);
  assertEquals(
    (await wentOut(cookies.second)).length,
    0,
  );

  assertEquals(await BroadcastQueueService.releaseDue(), 1);

  const sent = await wentOut(cookies.second);
  assertEquals(only(sent).status, "released");
  assertEquals(only(sent).approvedByUsername, SECOND);
});

/** Der Termin allein sendet nichts. Was niemand freigegeben hat, bleibt liegen. */
Deno.test("the ticker leaves an unapproved broadcast alone, however overdue", async () => {
  const cookies = await fixture();

  await submit(cookies.author, { scheduledFor: anHourAgo() });

  assertEquals(await BroadcastQueueService.releaseDue(), 0);
  assertEquals((await waiting(cookies.second)).length, 1, "wartet weiter");
});

Deno.test("the ticker leaves an approved broadcast alone until its time", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author, {
    scheduledFor: inAnHour(),
  })).json() as Row;

  await approve(cookies.second, created.publicationId);

  assertEquals(await BroadcastQueueService.releaseDue(), 0);
  assertEquals(
    (await wentOut(cookies.second)).length,
    0,
  );
});

/**
 * Die Stelle, an der ein doppelter Versand entstünde: Freigabe von Hand und Taktgeber greifen
 * beide nach derselben Zeile. `release` nimmt den Zustand, bevor es sendet — wer keine Zeile
 * trifft, sendet nicht.
 */
Deno.test("two runs of the ticker send once", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author, {
    scheduledFor: anHourAgo(),
  })).json() as Row;

  await approve(cookies.second, created.publicationId);

  assertEquals(await BroadcastQueueService.releaseDue(), 1);
  assertEquals(
    await BroadcastQueueService.releaseDue(),
    0,
    "beim zweiten Lauf nichts mehr",
  );

  assertEquals(
    (await wentOut(cookies.second)).length,
    1,
  );
});

/** Auch der Ur-Admin wartet auf die Uhr: Seine Freigabe ist erteilt, der Termin steht daneben. */
Deno.test("even the first administrator waits for the clock", async () => {
  const cookies = await fixtureAsRoot();

  const created = await (await submit(cookies.root, {
    scheduledFor: inAnHour(),
  })).json() as Row;

  assertEquals(created.status, "approved", "freigegeben, aber nicht raus");
  assertEquals(
    (await wentOut(cookies.second)).length,
    0,
  );
});

/** Eine Bearbeitung nimmt auch die Freigabe einer terminierten Rundmail zurück. */
Deno.test("editing a scheduled broadcast takes its approval back", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author, {
    scheduledFor: inAnHour(),
  })).json() as Row;

  await approve(cookies.second, created.publicationId);

  assertEquals(
    (await request(
      "PUT",
      `/api/moderation/broadcast/queue/${created.publicationId}`,
      cookies.author,
      { ...BROADCAST, scheduledFor: anHourAgo() },
    )).status,
    STATUS_CODE.OK,
  );

  // Fällig, aber nicht mehr freigegeben — also bleibt sie liegen.
  assertEquals(await BroadcastQueueService.releaseDue(), 0);
  assertEquals(only(await waiting(cookies.second)).status, "awaiting_approval");
});

/**
 * **Die Absenderliste ist eine Regel, kein Vorschlag.**
 *
 * Das Formular bietet nur Freigeschaltetes an — aber es hindert niemanden daran, eine andere
 * Kennung zu schicken. Ohne diese Prüfung könnte jede Administration eine Rundmail an alle unter
 * dem Namen eines beliebigen Mitglieds verschicken, und die Freigabe des Ur-Admins wäre eine
 * Empfehlung.
 */
Deno.test("a broadcast cannot be sent as an account that was never released", async () => {
  const cookies = await fixture();

  const refused = await submit(cookies.author, {
    sendAsUserId: await getUserId(MODERATOR),
  });

  assertEquals(refused.status, STATUS_CODE.Forbidden);
  assertEquals((await waiting(cookies.second)).length, 0, "nichts eingereicht");
});

Deno.test("a released account may be used as the sender", async () => {
  const cookies = await fixtureAsRoot();

  assertEquals(
    (await request(
      "POST",
      "/api/moderation/broadcast/senders",
      cookies.root,
      { username: MODERATOR },
    )).status,
    STATUS_CODE.OK,
  );

  const created = await (await submit(cookies.author, {
    sendAsUserId: await getUserId(MODERATOR),
  })).json() as Row;

  assertEquals(only(await waiting(cookies.second)).sendAsUsername, MODERATOR);
  assertEquals(created.status, "awaiting_approval");
});

/** Und eine Bearbeitung kann den Absender nicht nachträglich auf ein fremdes Konto drehen. */
Deno.test("editing cannot smuggle in an unreleased sender", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.author)).json() as Row;

  assertEquals(
    (await request(
      "PUT",
      `/api/moderation/broadcast/queue/${created.publicationId}`,
      cookies.author,
      { ...BROADCAST, sendAsUserId: await getUserId(MODERATOR) },
    )).status,
    STATUS_CODE.Forbidden,
  );

  assertEquals(only(await waiting(cookies.second)).sendAsUsername, null);
});
