import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  registerUser,
  request,
  write,
} from "@/src/test/support.ts";

/**
 * Wen jemand in den Statusmeldungen nicht sehen will.
 *
 * **Zwei Schalter, nicht einer:** Es gibt Leute, deren Meldungen einem zu viel sind, deren
 * Antworten unter fremden Meldungen aber völlig in Ordnung — und umgekehrt.
 */

/** Kennzeichnet, was aus dieser Datei stammt. */
const MINE = "status-hide:";

const reader = "status-hide-reader";
const loud = "status-hide-loud";
const operator = "status-hide-operator";

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(() => deleteUsers([reader, loud, operator]));

async function post(cookie: string, body: string) {
  const response = await request("POST", "/api/status-updates", cookie, {
    body,
  });
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json();
}

/**
 * Die Liste der eigenen Meldungen aus dieser Datei.
 *
 * **Nicht die ganze Liste.** Sie ist plattformweit, und andere Testdateien schreiben
 * gleichzeitig hinein — auf ihre Länge zu zählen heißt, gegen den Zufall zu prüfen.
 */
async function feed(cookie: string) {
  const response = await request("QUERY", "/api/status-updates", cookie, {
    limit: 100,
  });
  assertEquals(response.status, STATUS_CODE.OK);
  const results = (await response.json()).results as Array<
    { body: string; commentCount: number }
  >;
  return results.filter((update) => update.body.startsWith(MINE));
}

function hide(
  cookie: string,
  userId: string,
  what: { hideUpdates: boolean; hideComments: boolean },
) {
  return request(
    "PUT",
    `/api/status-updates/hidden/${userId}`,
    cookie,
    what,
  );
}

Deno.test("wer ausgeblendet ist, verschwindet aus der Liste — und kommt zurück", async () => {
  const readerCookie = await registerUser(reader);
  const loudCookie = await registerUser(loud);
  await post(loudCookie, `${MINE} sehr laute Meldung`);

  assertEquals((await feed(readerCookie)).length, 1);

  const hidden = await hide(readerCookie, await getUserId(loud), {
    hideUpdates: true,
    hideComments: false,
  });
  assertEquals(hidden.status, STATUS_CODE.OK);
  assertEquals((await hidden.json()).results, [{
    userId: await getUserId(loud),
    username: loud,
    hideUpdates: true,
    hideComments: false,
  }]);

  assertEquals((await feed(readerCookie)).length, 0);

  // **Gefiltert wird beim Lesen, nie beim Schreiben.** Wieder einblenden bringt zurück, was
  // verborgen war, statt einer Lücke in der Geschichte.
  const shown = await hide(readerCookie, await getUserId(loud), {
    hideUpdates: false,
    hideComments: false,
  });
  assertEquals((await shown.json()).results, []);
  assertEquals((await feed(readerCookie)).length, 1);
});

/** Getrennt: Die Meldungen dürfen bleiben, während die Kommentare verschwinden. */
Deno.test("Kommentare lassen sich einzeln ausblenden, ohne die Meldungen", async () => {
  const readerCookie = await registerUser(reader);
  const loudCookie = await registerUser(loud);
  const statusUpdate = await post(readerCookie, `${MINE} meine eigene Meldung`);

  assertEquals(
    (await request(
      "POST",
      `/api/status-updates/${statusUpdate.id}/comments`,
      loudCookie,
      { body: "Etwas, das ich nicht lesen will." },
    )).status,
    STATUS_CODE.Created,
  );

  await hide(readerCookie, await getUserId(loud), {
    hideUpdates: false,
    hideComments: true,
  });

  const comments = await (await request(
    "GET",
    `/api/status-updates/${statusUpdate.id}/comments`,
    readerCookie,
  )).json();
  assertEquals(comments.results, []);

  // **Die Zahl zählt, was man sehen kann.** Eine Vier über einem leeren Strang sieht nach einem
  // Fehler aus — und verrät nebenbei, dass da noch etwas ist.
  assertEquals((await feed(readerCookie))[0]?.commentCount, 0);

  // Die Verfasserin selbst sieht ihn weiterhin.
  const forLoud = await (await request(
    "GET",
    `/api/status-updates/${statusUpdate.id}/comments`,
    loudCookie,
  )).json();
  assertEquals(forLoud.results.length, 1);
});

Deno.test("sich selbst blendet niemand aus", async () => {
  const cookie = await registerUser(reader);

  const response = await hide(cookie, await getUserId(reader), {
    hideUpdates: true,
    hideComments: true,
  });

  assertEquals(response.status, STATUS_CODE.Conflict);
});

/**
 * **Für die Moderation muss alles sichtbar sein.** Im Löschprotokoll steht nur, was gelöscht
 * wurde — was jemand geschrieben und stehen gelassen hat, sieht man nur, wenn man es sehen kann.
 */
Deno.test("die Moderation kann niemanden ausblenden", async () => {
  const operatorCookie = await registerUser(operator);
  const loudCookie = await registerUser(loud);
  await post(loudCookie, `${MINE} sehr laute Meldung`);

  await write((transaction) =>
    transaction
      .updateTable("user")
      .set({ platformRole: "moderator" })
      .where("username", "=", operator)
      .execute()
  );

  const refused = await hide(operatorCookie, await getUserId(loud), {
    hideUpdates: true,
    hideComments: true,
  });
  assertEquals(refused.status, STATUS_CODE.Forbidden);

  assertEquals(
    (await request("GET", "/api/status-updates/hidden", operatorCookie)).status,
    STATUS_CODE.Forbidden,
  );

  // Und die Meldung steht weiterhin da.
  assertEquals((await feed(operatorCookie)).length, 1);
});
