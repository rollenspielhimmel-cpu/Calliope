import { assert, assertEquals } from "@std/assert";
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
 * Wer was in Warteschlange und „Gesendete" sieht.
 *
 * - Die Administration sieht alles.
 * - Die Moderation sieht alles, was nicht „nur für die Administration" ist — weil ihre Rolle
 *   `see_whole_queue` hat.
 * - Rogue, ohne Rolle, mit dem persönlichen Absender Infoflamingo, sieht nur, was unter
 *   Infoflamingo läuft — auch das von Buddy, der denselben Absender hat —, und das Eigene.
 *
 * **Der wichtigste Test hier sucht die Betreffe im rohen Text der Antworten**, nicht in den
 * erwarteten Feldern: Was Rogue nicht sehen soll, darf in keiner Antwort stehen, die Rogue bekommt.
 */

const ROOT = "qv-root";
const ADMIN = "qv-admin";
const MOD = "qv-mod";
const ROGUE = "qv-rogue";
const BUDDY = "qv-buddy";
const FLAMINGO = "qv-flamingo";
const OTHER_PERSONA = "qv-other";

const USERS = [ROOT, ADMIN, MOD, ROGUE, BUDDY, FLAMINGO, OTHER_PERSONA];

// Jeder Betreff kommt nur in dieser Datei vor, damit die Suche im rohen Text nichts Fremdes findet.
const AS_OTHER = "qv-als-anderer-absender";
const AS_FLAMINGO = "qv-als-infoflamingo";
const HIDDEN = "qv-nur-fuer-die-administration";
const BUDDYS = "qv-von-buddy";
const ROGUES = "qv-von-rogue-und-dann-verborgen";

const SUBJECTS = [AS_OTHER, AS_FLAMINGO, HIDDEN, BUDDYS, ROGUES];

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

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function body(
  subject: string,
  sendAs: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    subject,
    body: "Ein Text.",
    audienceRoles: [],
    // An das eigene Konto der Administration dieser Datei, damit niemand sonst etwas bekommt.
    memberIds: [await getUserId(ADMIN)],
    includeUnverified: false,
    deliverToInbox: true,
    deliverByEmail: false,
    publishInArchive: false,
    sendAsUserId: await getUserId(sendAs),
    scheduledFor: inAnHour(),
    ...overrides,
  };
}

async function submit(
  cookie: string,
  subject: string,
  sendAs: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request(
    "POST",
    "/api/moderation/broadcast/queue",
    cookie,
    await body(subject, sendAs, overrides),
  );
  assertEquals(response.status, STATUS_CODE.Created, subject);
  return await response.json() as { publicationId: string };
}

async function giveFlamingoTo(person: string, rootCookie: string) {
  const granted = await request(
    "PUT",
    `/api/moderation/broadcast/senders/${await getUserId(
      FLAMINGO,
    )}/people/${await getUserId(person)}`,
    rootCookie,
  );
  assertEquals(granted.status, STATUS_CODE.OK);
}

/**
 * Fünf Einträge in der Warteschlange: zwei der Administration unter verschiedenen Absendern, einer
 * davon verborgen, einer von Buddy, einer von Rogue, den die Administration danach verbirgt.
 */
function fixture() {
  return data.freshly(async () => {
    const cookies = {
      root: await registerUser(ROOT),
      admin: await registerUser(ADMIN),
      mod: await registerUser(MOD),
      rogue: await registerUser(ROGUE),
      buddy: await registerUser(BUDDY),
    };
    await registerUser(FLAMINGO);
    await registerUser(OTHER_PERSONA);

    await setRole(ROOT, "administrator");
    await setRole(ADMIN, "administrator");
    await setRole(MOD, "moderator");

    await db
      .insertInto("broadcastSender")
      .values([
        { userId: await getUserId(FLAMINGO) },
        { userId: await getUserId(OTHER_PERSONA) },
      ])
      .execute();

    await borrowPrimordialSeat(ROOT);
    await giveFlamingoTo(ROGUE, cookies.root);
    await giveFlamingoTo(BUDDY, cookies.root);

    await submit(cookies.admin, AS_OTHER, OTHER_PERSONA);
    await submit(cookies.admin, AS_FLAMINGO, FLAMINGO);
    await submit(cookies.admin, HIDDEN, FLAMINGO, { administrationOnly: true });
    await submit(cookies.buddy, BUDDYS, FLAMINGO);
    const rogues = await submit(cookies.rogue, ROGUES, FLAMINGO);

    // Die Administration verbirgt Rogues Entwurf nachträglich.
    const hidden = await request(
      "PUT",
      `/api/moderation/broadcast/queue/${rogues.publicationId}`,
      cookies.admin,
      await body(ROGUES, FLAMINGO, { administrationOnly: true }),
    );
    assertEquals(hidden.status, STATUS_CODE.OK);

    return { ...cookies, rogues: rogues.publicationId };
  });
}

Deno.test.afterEach(data.cleanUp);

/** Die Betreffe dieser Datei, die in der rohen Antwort vorkommen — sortiert. */
async function subjectsIn(
  cookie: string,
  path:
    | "/api/moderation/broadcast/queue"
    | "/api/moderation/broadcast/released",
): Promise<string[]> {
  const response = await request("GET", path, cookie);
  assertEquals(response.status, STATUS_CODE.OK);
  const raw = await response.text();
  return SUBJECTS.filter((subject) => raw.includes(subject)).sort();
}

Deno.test("die Administration sieht die ganze Warteschlange", async () => {
  const cookies = await fixture();

  assertEquals(
    await subjectsIn(cookies.admin, "/api/moderation/broadcast/queue"),
    [...SUBJECTS].sort(),
  );
});

Deno.test("die Moderation sieht alles außer dem, was nur für die Administration ist", async () => {
  const cookies = await fixture();

  assertEquals(
    await subjectsIn(cookies.mod, "/api/moderation/broadcast/queue"),
    [AS_FLAMINGO, AS_OTHER, BUDDYS].sort(),
  );
});

/**
 * Rogue: was unter Infoflamingo läuft, auch Buddys, und das Eigene — auch nachdem die
 * Administration es verborgen hat. Nicht, was unter einem anderen Absender läuft, und nicht das
 * Verborgene der Administration.
 */
Deno.test("wer einen persönlichen Absender hat, sieht nur, was darunter läuft, und das Eigene", async () => {
  const cookies = await fixture();

  assertEquals(
    await subjectsIn(cookies.rogue, "/api/moderation/broadcast/queue"),
    [AS_FLAMINGO, BUDDYS, ROGUES].sort(),
  );
});

/** Dieselbe Regel für „Gesendete": gesendet wird hier ohne Termin, von der Administration. */
Deno.test("in „Gesendete“ gilt dieselbe Sichtbarkeit", async () => {
  const cookies = await fixture();

  await submit(cookies.admin, `${AS_OTHER}-raus`, OTHER_PERSONA, {
    scheduledFor: null,
  });
  await submit(cookies.admin, `${AS_FLAMINGO}-raus`, FLAMINGO, {
    scheduledFor: null,
  });
  await submit(cookies.admin, `${HIDDEN}-raus`, FLAMINGO, {
    scheduledFor: null,
    administrationOnly: true,
  });

  const released = async (cookie: string) => {
    const raw = await (await request(
      "GET",
      "/api/moderation/broadcast/released",
      cookie,
    )).text();
    return SUBJECTS.map((subject) => `${subject}-raus`).filter((subject) =>
      raw.includes(subject)
    ).sort();
  };

  assertEquals(await released(cookies.rogue), [`${AS_FLAMINGO}-raus`]);
  assertEquals(
    await released(cookies.mod),
    [`${AS_FLAMINGO}-raus`, `${AS_OTHER}-raus`].sort(),
  );
  assertEquals((await released(cookies.admin)).length, 3);
});

/** Den Haken setzt und ändert nur eine Administration. */
Deno.test("ohne Administration lässt sich der Haken weder setzen noch ändern", async () => {
  const cookies = await fixture();

  const refused = await request(
    "POST",
    "/api/moderation/broadcast/queue",
    cookies.rogue,
    await body("qv-versucht-zu-verbergen", FLAMINGO, {
      administrationOnly: true,
    }),
  );
  assertEquals(refused.status, STATUS_CODE.Forbidden);

  // Rogues eigener, von der Administration verborgener Entwurf: Bearbeiten mit dem Haken wie er
  // ist, geht; ihn dabei abzunehmen, nicht.
  const keeping = await request(
    "PUT",
    `/api/moderation/broadcast/queue/${cookies.rogues}`,
    cookies.rogue,
    await body(ROGUES, FLAMINGO, { administrationOnly: true }),
  );
  assertEquals(keeping.status, STATUS_CODE.OK);

  const unhiding = await request(
    "PUT",
    `/api/moderation/broadcast/queue/${cookies.rogues}`,
    cookies.rogue,
    await body(ROGUES, FLAMINGO, { administrationOnly: false }),
  );
  assertEquals(unhiding.status, STATUS_CODE.Forbidden);

  const row = await db
    .selectFrom("publication")
    .select("administrationOnly")
    .where("id", "=", cookies.rogues)
    .executeTakeFirstOrThrow();
  assert(row.administrationOnly, "bleibt verborgen");
});

/** Nimmt der Ur-Admin der Moderation die Berechtigung, sieht sie nur noch ihre Absender. */
Deno.test("ohne `see_whole_queue` sieht auch ein Mod nur seine Absender", async () => {
  const cookies = await fixture();

  // Nicht über die Route, sondern als Konto ohne diese Berechtigung: Die Zeile der Moderation gilt
  // für den ganzen Lauf, und ihr Entziehen träfe jede Datei, die gerade läuft. Also wird der Mod
  // hier zu einer Rolle ohne Zeile — keiner — und bekommt Infoflamingo persönlich.
  await setRole(MOD, null);
  await request(
    "PUT",
    `/api/moderation/broadcast/senders/${await getUserId(
      FLAMINGO,
    )}/people/${await getUserId(MOD)}`,
    cookies.root,
  );

  assertEquals(
    await subjectsIn(cookies.mod, "/api/moderation/broadcast/queue"),
    [AS_FLAMINGO, BUDDYS].sort(),
  );
});
