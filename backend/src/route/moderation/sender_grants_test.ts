import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  deleteUsers,
  getUserId,
  registerUser,
  request,
  scopedTestData,
} from "@/src/test/support.ts";
import { borrowPrimordialSeat } from "@/src/test/primordial_seat.ts";

/**
 * Wer unter welchem Absender vorbereiten darf.
 *
 * **Die Geschichte, für die das gebaut ist:** Rogue hat keine Teamrolle. Der Ur-Admin gibt Rogue den
 * Absender „Infoflamingo". Rogue schreibt vor, wählt „erscheint als Infoflamingo", reicht ein — und
 * kann nichts anderes wählen, nicht „Admin" und keinen anderen Absender. Freigeben tut eine
 * Administration.
 *
 * Alle Absender hier sind Konten dieser Datei: Eine Freigabe für die Rolle `moderator` auf einem
 * davon wirkt auf niemanden außerhalb, und mit den Konten gehen auch die Freigaben.
 */

const ROOT = "sg-root";
const ADMIN = "sg-admin";
const MOD = "sg-mod";
const ROGUE = "sg-rogue";
const FLAMINGO = "sg-flamingo";
const OTHER_PERSONA = "sg-other";

const USERS = [ROOT, ADMIN, MOD, ROGUE, FLAMINGO, OTHER_PERSONA];

const SUBJECT = "Absender-Test";

const data = scopedTestData({
  users: USERS,
  seat: ROOT,
  remove: async (transaction) => {
    const ids = transaction
      .selectFrom("user")
      .select("id")
      .where("username", "in", USERS);

    await transaction.deleteFrom("publication").where("writtenBy", "in", ids)
      .execute();
  },
});

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

function fixture() {
  return data.freshly(async () => {
    const cookies = {
      root: await registerUser(ROOT),
      admin: await registerUser(ADMIN),
      mod: await registerUser(MOD),
      rogue: await registerUser(ROGUE),
    };
    await registerUser(FLAMINGO);
    await registerUser(OTHER_PERSONA);

    await setRole(ROOT, "administrator");
    await setRole(ADMIN, "administrator");
    await setRole(MOD, "moderator");

    // Beide freigeschaltet, nach der Migration — also zunächst nur für Administrationen.
    await db
      .insertInto("broadcastSender")
      .values([
        { userId: await getUserId(FLAMINGO) },
        { userId: await getUserId(OTHER_PERSONA) },
      ])
      .execute();

    return cookies;
  });
}

async function fixtureAsRoot() {
  const cookies = await fixture();
  await borrowPrimordialSeat(ROOT);
  return cookies;
}

Deno.test.afterEach(data.cleanUp);

async function submitAs(cookie: string, sendAsUserId: string | null) {
  return await request("POST", "/api/moderation/broadcast/queue", cookie, {
    subject: SUBJECT,
    body: "Ein Text.",
    audienceRoles: [],
    memberIds: [await getUserId(ADMIN)],
    includeUnverified: false,
    deliverToInbox: true,
    deliverByEmail: false,
    publishInArchive: false,
    sendAsUserId,
    scheduledFor: null,
  });
}

async function mayPrepare(cookie: string): Promise<boolean> {
  const body = await (await request("GET", "/api/auth/me", cookie)).json();
  return body.mayPreparePublications;
}

async function sendersSeenBy(cookie: string): Promise<string[]> {
  const response = await request(
    "GET",
    "/api/moderation/broadcast/senders",
    cookie,
  );
  assertEquals(response.status, STATUS_CODE.OK);
  const senders = await response.json() as Array<{ username: string }>;
  return senders.map((sender) => sender.username).filter((name) =>
    USERS.includes(name)
  );
}

const toPerson = async (sender: string, person: string) =>
  `/api/moderation/broadcast/senders/${await getUserId(
    sender,
  )}/people/${await getUserId(person)}`;

const toModerators = async (sender: string) =>
  `/api/moderation/broadcast/senders/${await getUserId(
    sender,
  )}/roles/moderator`;

Deno.test("ohne Rolle und ohne Absender bereitet niemand etwas vor", async () => {
  const cookies = await fixture();

  assertEquals(await mayPrepare(cookies.rogue), false);
  assertEquals(
    (await submitAs(cookies.rogue, await getUserId(FLAMINGO))).status,
    STATUS_CODE.Forbidden,
  );
});

/** Die Geschichte von Rogue, von der Freigabe bis zur Einreichung. */
Deno.test("ein persönlicher Absender lässt vorbereiten, und nur unter ihm", async () => {
  const cookies = await fixtureAsRoot();

  assertEquals(
    (await request("PUT", await toPerson(FLAMINGO, ROGUE), cookies.root))
      .status,
    STATUS_CODE.OK,
  );

  assertEquals(await mayPrepare(cookies.rogue), true, "darf jetzt vorbereiten");
  assertEquals(await sendersSeenBy(cookies.rogue), [FLAMINGO], "sieht nur ihn");

  const submitted = await submitAs(cookies.rogue, await getUserId(FLAMINGO));
  assertEquals(submitted.status, STATUS_CODE.Created);
  assertEquals((await submitted.json()).status, "awaiting_approval");

  assertEquals(
    (await submitAs(cookies.rogue, null)).status,
    STATUS_CODE.Forbidden,
    "nicht als Admin",
  );
  assertEquals(
    (await submitAs(cookies.rogue, await getUserId(OTHER_PERSONA))).status,
    STATUS_CODE.Forbidden,
    "nicht als anderer Absender",
  );
});

/** Auch die Test-Rundmail fragt: Sonst ließe sich ausprobieren, wie man als Admin aussähe. */
Deno.test("die Test-Rundmail prüft denselben Absender", async () => {
  const cookies = await fixtureAsRoot();
  await request("PUT", await toPerson(FLAMINGO, ROGUE), cookies.root);

  const test = (sendAsUserId: string | null) =>
    request("POST", "/api/moderation/broadcast/test", cookies.rogue, {
      subject: SUBJECT,
      body: "Ein Text.",
      sendAsUserId,
      deliverByEmail: false,
    });

  assertEquals((await test(null)).status, STATUS_CODE.Forbidden);
  assertEquals(
    (await test(await getUserId(FLAMINGO))).status,
    STATUS_CODE.OK,
  );
});

/**
 * **Neue Absender gelten zunächst nur für Administrationen.** Die Moderation hat zum Start „Admin"
 * und alles, was damals freigeschaltet war — ein danach freigeschalteter braucht eine Freigabe.
 */
Deno.test("ein neu freigeschalteter Absender gilt für die Moderation erst nach der Freigabe", async () => {
  const cookies = await fixtureAsRoot();

  assertEquals(await sendersSeenBy(cookies.mod), [ROOT], "nur Admin");
  assertEquals(
    (await submitAs(cookies.mod, await getUserId(FLAMINGO))).status,
    STATUS_CODE.Forbidden,
  );
  assertEquals(
    (await submitAs(cookies.mod, null)).status,
    STATUS_CODE.Created,
    "als Admin, wie bisher",
  );

  assertEquals(
    (await request("PUT", await toModerators(FLAMINGO), cookies.root)).status,
    STATUS_CODE.OK,
  );

  assertEquals(
    (await submitAs(cookies.mod, await getUserId(FLAMINGO))).status,
    STATUS_CODE.Created,
  );
});

Deno.test("eine Administration darf jeden freigeschalteten Absender, ohne Freigabe", async () => {
  const cookies = await fixture();

  assertEquals(await sendersSeenBy(cookies.admin), [FLAMINGO, OTHER_PERSONA]);
  assertEquals(
    (await submitAs(cookies.admin, await getUserId(OTHER_PERSONA))).status,
    STATUS_CODE.Created,
  );
});

Deno.test("nur der Ur-Admin vergibt und entzieht", async () => {
  const cookies = await fixture();

  assertEquals(
    (await request("PUT", await toPerson(FLAMINGO, ROGUE), cookies.admin))
      .status,
    STATUS_CODE.Forbidden,
  );
  assertEquals(
    (await request("PUT", await toModerators(FLAMINGO), cookies.admin)).status,
    STATUS_CODE.Forbidden,
  );
  assertEquals(await mayPrepare(cookies.rogue), false, "nichts vergeben");

  // Entziehen genauso: Die Zeile der Moderation für „Admin" gibt es seit der Migration.
  const admin = await request(
    "GET",
    "/api/moderation/broadcast/senders",
    cookies.admin,
  );
  const [permanent] =
    (await admin.json() as Array<{ id: string; isPermanent: boolean }>)
      .filter((sender) => sender.isPermanent);
  if (permanent !== undefined) {
    assertEquals(
      (await request(
        "DELETE",
        `/api/moderation/broadcast/senders/${permanent.id}/roles/moderator`,
        cookies.admin,
      )).status,
      STATUS_CODE.Forbidden,
    );
  }
  assertEquals(
    (await request("DELETE", await toPerson(FLAMINGO, ROGUE), cookies.admin))
      .status,
    STATUS_CODE.Forbidden,
  );

  // Lesen darf jede Administration, keine andere Rolle.
  assertEquals(
    (await request(
      "GET",
      "/api/moderation/broadcast/sender-grants",
      cookies.admin,
    )).status,
    STATUS_CODE.OK,
  );
  assertEquals(
    (await request(
      "GET",
      "/api/moderation/broadcast/sender-grants",
      cookies.mod,
    )).status,
    STATUS_CODE.Forbidden,
  );
});

/** Die persönliche Freigabe hängt am Konto, nicht an der Rolle. */
Deno.test("eine persönliche Freigabe übersteht einen Rollenwechsel", async () => {
  const cookies = await fixtureAsRoot();
  await request("PUT", await toPerson(FLAMINGO, ROGUE), cookies.root);

  await setRole(ROGUE, "moderator");
  await setRole(ROGUE, null);

  assertEquals(
    (await submitAs(cookies.rogue, await getUserId(FLAMINGO))).status,
    STATUS_CODE.Created,
  );
});

/** Die Übersicht des Ur-Admins: wer welchen Absender persönlich hat. */
Deno.test("die Übersicht nennt persönliche Freigaben mit Namen", async () => {
  const cookies = await fixtureAsRoot();
  await request("PUT", await toPerson(FLAMINGO, ROGUE), cookies.root);

  const grants = await (await request(
    "GET",
    "/api/moderation/broadcast/sender-grants",
    cookies.root,
  )).json() as Array<{ senderId: string; username: string | null }>;

  const flamingo = await getUserId(FLAMINGO);
  assertEquals(
    grants.filter((row) => row.senderId === flamingo).map((row) =>
      row.username
    ),
    [ROGUE],
  );
});

/** Wird der Absender zurückgenommen, gehen seine Freigaben mit — und damit Rogues Zugang. */
Deno.test("ein zurückgenommener Absender nimmt seine Freigaben mit", async () => {
  const cookies = await fixtureAsRoot();
  await request("PUT", await toPerson(FLAMINGO, ROGUE), cookies.root);
  assertEquals(await mayPrepare(cookies.rogue), true);

  assertEquals(
    (await request(
      "DELETE",
      `/api/moderation/broadcast/senders/${await getUserId(FLAMINGO)}`,
      cookies.root,
    )).status,
    STATUS_CODE.OK,
  );

  assertEquals(await mayPrepare(cookies.rogue), false);
});

/** Und beim Bearbeiten lässt sich der Absender nicht auf einen fremden drehen. */
Deno.test("beim Bearbeiten gilt dieselbe Prüfung", async () => {
  const cookies = await fixtureAsRoot();
  await request("PUT", await toPerson(FLAMINGO, ROGUE), cookies.root);

  const { publicationId } = await (await submitAs(
    cookies.rogue,
    await getUserId(FLAMINGO),
  )).json();

  const edited = await request(
    "PUT",
    `/api/moderation/broadcast/queue/${publicationId}`,
    cookies.rogue,
    {
      subject: SUBJECT,
      body: "Jetzt als Admin.",
      audienceRoles: [],
      memberIds: [await getUserId(ADMIN)],
      includeUnverified: false,
      deliverToInbox: true,
      deliverByEmail: false,
      publishInArchive: false,
      sendAsUserId: null,
      scheduledFor: null,
    },
  );
  assertEquals(edited.status, STATUS_CODE.Forbidden);
});

/** Wer sein Konto löscht, nimmt seine persönlichen Freigaben mit. */
Deno.test("mit dem Konto gehen die persönlichen Freigaben", async () => {
  const cookies = await fixtureAsRoot();
  await request("PUT", await toPerson(FLAMINGO, ROGUE), cookies.root);
  const rogue = await getUserId(ROGUE);

  await deleteUsers([ROGUE]);

  const left = await db
    .selectFrom("senderGrant")
    .select("id")
    .where("userId", "=", rogue)
    .execute();
  assertEquals(left, []);
});
