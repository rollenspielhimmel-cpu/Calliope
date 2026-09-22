import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import { registerUser, request, scopedTestData } from "@/src/test/support.ts";
import { borrowPrimordialSeat } from "@/src/test/primordial_seat.ts";

/**
 * Was eine Rolle darf, legt der Ur-Admin fest; lesen dürfen es alle Administrationen.
 *
 * **Was hier nicht steht: ein echtes Entziehen.** Es gibt eine Rolle, der man etwas geben kann, und
 * die Zeile gilt für den ganzen Lauf. Sie hier wegzunehmen hieße, jeder anderen Datei, die gerade
 * mit einem Mod eine Rundmail einreicht, die Berechtigung unter den Füßen wegzuziehen. Dass ein
 * Mod ohne die Zeile nichts mehr darf, prüft `platform_authorization_test.ts`; dass die Zeile mit
 * der Sitzung gelesen wird, `me_test.ts`.
 */

const PRIMORDIAL = "rp-root";
const ADMINISTRATOR = "rp-admin";
const MODERATOR = "rp-moderator";
const MEMBER = "rp-member";

const USERS = [PRIMORDIAL, ADMINISTRATOR, MODERATOR, MEMBER];

const PATH = "/api/moderation/role-permissions";
const GRANT = `${PATH}/moderator/prepare_publications`;

const data = scopedTestData({ users: USERS, seat: PRIMORDIAL });

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
      primordial: await registerUser(PRIMORDIAL),
      administrator: await registerUser(ADMINISTRATOR),
      moderator: await registerUser(MODERATOR),
      member: await registerUser(MEMBER),
    };

    await setRole(PRIMORDIAL, "administrator");
    await setRole(ADMINISTRATOR, "administrator");
    await setRole(MODERATOR, "moderator");

    return cookies;
  });
}

Deno.test.afterEach(data.cleanUp);

type Listing = {
  roles: string[];
  permissions: string[];
  granted: Array<{ role: string; permission: string; grantedAt: string }>;
};

async function listing(cookie: string): Promise<Listing> {
  const response = await request("GET", PATH, cookie);
  assertEquals(response.status, STATUS_CODE.OK);
  return await response.json() as Listing;
}

function grantOf(list: Listing) {
  return list.granted.find((row) =>
    row.role === "moderator" && row.permission === "prepare_publications"
  );
}

Deno.test("an administrator reads what each role may, and the moderators may prepare", async () => {
  const cookies = await fixture();

  const list = await listing(cookies.administrator);

  // Keine Zeile für Administrationen, und auch keine Rolle, die man ihnen geben könnte.
  assertEquals(list.roles, ["moderator"]);
  assertEquals(list.permissions, ["prepare_publications"]);
  assertEquals(
    grantOf(list)?.role,
    "moderator",
    "die Migration hat sie gegeben",
  );
});

Deno.test("neither a moderator nor a member reads it", async () => {
  const cookies = await fixture();

  assertEquals(
    (await request("GET", PATH, cookies.moderator)).status,
    STATUS_CODE.Forbidden,
  );
  assertEquals(
    (await request("GET", PATH, cookies.member)).status,
    STATUS_CODE.Forbidden,
  );
});

/**
 * **Nur der Ur-Admin ändert es.** Eine gewöhnliche Administration, die einer Rolle das Vorbereiten
 * geben könnte, könnte die Stimme des Teams an jemanden weiterreichen, ohne dass der, der über den
 * Rollen steht, es merkt.
 */
Deno.test("an ordinary administrator neither grants nor revokes", async () => {
  const cookies = await fixture();
  const before = grantOf(await listing(cookies.administrator));

  assertEquals(
    (await request("DELETE", GRANT, cookies.administrator)).status,
    STATUS_CODE.Forbidden,
  );
  assertEquals(
    (await request("PUT", GRANT, cookies.administrator)).status,
    STATUS_CODE.Forbidden,
  );

  assertEquals(grantOf(await listing(cookies.administrator)), before);
});

/** Administrationen haben alles; eine Zeile für sie wäre eine, deren Fehlen etwas bedeuten könnte. */
Deno.test("administrators cannot be named as a role here", async () => {
  const cookies = await fixture();
  await borrowPrimordialSeat(PRIMORDIAL);

  assertEquals(
    (await request(
      "PUT",
      `${PATH}/administrator/prepare_publications`,
      cookies.primordial,
    )).status,
    STATUS_CODE.BadRequest,
  );
});

/** Zweimal geben ändert nichts, auch nicht, wer es wann gegeben hat. */
Deno.test("the first administrator grants, and granting again keeps the first grant", async () => {
  const cookies = await fixture();
  await borrowPrimordialSeat(PRIMORDIAL);
  const before = grantOf(await listing(cookies.primordial));

  assertEquals(
    (await request("PUT", GRANT, cookies.primordial)).status,
    STATUS_CODE.OK,
  );

  assertEquals(grantOf(await listing(cookies.primordial)), before);
});
