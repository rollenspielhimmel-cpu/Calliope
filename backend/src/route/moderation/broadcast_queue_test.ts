import { assert, assertEquals } from "@std/assert";
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

async function waiting(cookie: string): Promise<Row[]> {
  return await (await queue(cookie)).json() as Row[];
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

  const sent = await (await released(cookies.second)).json() as Row[];
  assertEquals(only(sent).status, "released");

  // Nach außen der gewählte Absender, intern beide echten Namen — der Sinn der ganzen Spur.
  assertEquals(only(sent).writtenByUsername, AUTHOR);
  assertEquals(only(sent).approvedByUsername, SECOND);

  // Beim Versand festgehalten, nicht später gezählt.
  const count = only(sent).recipientCount;
  assert(count !== null && count > 0, "die Empfängerzahl steht fest");
});

Deno.test("the first administrator needs no approval and it goes out at once", async () => {
  const cookies = await fixture();

  const created = await (await submit(cookies.root)).json() as Row;
  assertEquals(created.status, "released");

  assertEquals(
    (await waiting(cookies.second)).length,
    0,
    "wartet gar nicht erst",
  );

  const sent = await (await released(cookies.second)).json() as Row[];

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
  const cookies = await fixture();

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
    (await (await released(cookies.second)).json() as Row[]).length,
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
    (await (await released(cookies.second)).json() as Row[]).length,
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
