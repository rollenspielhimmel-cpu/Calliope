import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
} from "@/src/test/support.ts";

/**
 * Mitteilungen bei Kommentaren, und der Schalter mit drei Stellungen.
 *
 * **Der Fall, für den es sie gibt:** Bisher erfuhr niemand, dass unter seiner Statusmeldung
 * geschrieben wurde. Und der Fall, für den es den Schalter gibt: „Ich kommentiere, wir schreiben
 * kurz hin und her, dann folgen 76 weitere Kommentare, die mich nicht interessieren."
 */

const author = "status-notify-author";
const commenter = "status-notify-commenter";
const passerby = "status-notify-passerby";

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(() => deleteUsers([author, commenter, passerby]));

async function createStatusUpdate(cookie: string) {
  const response = await request("POST", "/api/status-updates", cookie, {
    body: "Ein Status",
  });
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json();
}

function comment(cookie: string, statusUpdateId: string, body: string) {
  return request(
    "POST",
    `/api/status-updates/${statusUpdateId}/comments`,
    cookie,
    { body },
  );
}

async function notifications(cookie: string) {
  const response = await request("QUERY", "/api/notifications", cookie, {
    limit: 25,
    offset: 0,
    unreadOnly: false,
  });
  assertEquals(response.status, STATUS_CODE.OK);
  return (await response.json()).results as Array<{
    type: string;
    statusUpdateId?: string;
    newCommentCount?: number;
    actorUsername: string | null;
  }>;
}

Deno.test("wer eine Statusmeldung schreibt, erfährt von Kommentaren darunter", async () => {
  const authorCookie = await registerUser(author);
  const commenterCookie = await registerUser(commenter);
  const statusUpdate = await createStatusUpdate(authorCookie);

  assertEquals(
    (await comment(commenterCookie, statusUpdate.id, "Schön.")).status,
    STATUS_CODE.Created,
  );

  const received = await notifications(authorCookie);
  assertEquals(received.length, 1);
  assertEquals(received[0]?.type, "status_update_commented");
  assertEquals(received[0]?.statusUpdateId, statusUpdate.id);
  assertEquals(received[0]?.actorUsername, commenter);
  assertEquals(received[0]?.newCommentCount, 1);

  // Und wer selbst geschrieben hat, bekommt nichts über sich.
  assertEquals((await notifications(commenterCookie)).length, 0);
});

/**
 * **Achtzig Kommentare ergeben eine Zeile, nicht achtzig.** Sonst stünde für alles andere in der
 * Liste kein Platz mehr, und die Zahl an der Glocke wäre eine Zahl über einen einzigen Strang.
 */
Deno.test("viele Kommentare ergeben eine Mitteilung mit einer Zahl", async () => {
  const authorCookie = await registerUser(author);
  const commenterCookie = await registerUser(commenter);
  const statusUpdate = await createStatusUpdate(authorCookie);

  await comment(commenterCookie, statusUpdate.id, "Eins.");
  await comment(commenterCookie, statusUpdate.id, "Zwei.");
  await comment(commenterCookie, statusUpdate.id, "Drei.");

  const received = await notifications(authorCookie);
  assertEquals(received.length, 1);
  assertEquals(received[0]?.newCommentCount, 3);
});

/** Mitreden heißt mithören: Wer unter einer fremden Meldung schreibt, erfährt, was danach kommt. */
Deno.test("wer mitkommentiert hat, erfährt von weiteren Kommentaren", async () => {
  const authorCookie = await registerUser(author);
  const commenterCookie = await registerUser(commenter);
  const passerbyCookie = await registerUser(passerby);
  const statusUpdate = await createStatusUpdate(authorCookie);

  await comment(commenterCookie, statusUpdate.id, "Ich sage auch was.");
  await comment(passerbyCookie, statusUpdate.id, "Und ich.");

  const received = await notifications(commenterCookie);
  assertEquals(received.length, 1);
  assertEquals(received[0]?.actorUsername, passerby);
});

Deno.test("für eine einzelne Meldung lässt sich Ruhe einstellen", async () => {
  const authorCookie = await registerUser(author);
  const commenterCookie = await registerUser(commenter);
  const statusUpdate = await createStatusUpdate(authorCookie);

  // Vorher gilt die Regel, und für die Verfasserin heißt die: ja.
  const before = await (await request(
    "GET",
    `/api/status-updates/${statusUpdate.id}/notifications`,
    authorCookie,
  )).json();
  assertEquals(before, { subscribed: true, explicit: false });

  const off = await request(
    "PUT",
    `/api/status-updates/${statusUpdate.id}/notifications`,
    authorCookie,
    { subscribed: false },
  );
  assertEquals(off.status, STATUS_CODE.OK);
  assertEquals(await off.json(), { subscribed: false, explicit: true });

  await comment(commenterCookie, statusUpdate.id, "Hallo?");
  assertEquals((await notifications(authorCookie)).length, 0);

  // Und zurück auf die Regel, ohne raten zu müssen, was sie bedeutet.
  const back = await request(
    "PUT",
    `/api/status-updates/${statusUpdate.id}/notifications`,
    authorCookie,
    { subscribed: null },
  );
  assertEquals(await back.json(), { subscribed: true, explicit: false });
});

/** Die andere Richtung: mitlesen, ohne selbst etwas geschrieben zu haben. */
Deno.test("mitlesen lässt sich auch einschalten, ohne mitzuschreiben", async () => {
  const authorCookie = await registerUser(author);
  const commenterCookie = await registerUser(commenter);
  const passerbyCookie = await registerUser(passerby);
  const statusUpdate = await createStatusUpdate(authorCookie);

  // Ohne Eintrag bekäme jemand, der nichts geschrieben hat, nichts.
  const before = await (await request(
    "GET",
    `/api/status-updates/${statusUpdate.id}/notifications`,
    passerbyCookie,
  )).json();
  assertEquals(before, { subscribed: false, explicit: false });

  await request(
    "PUT",
    `/api/status-updates/${statusUpdate.id}/notifications`,
    passerbyCookie,
    { subscribed: true },
  );

  await comment(commenterCookie, statusUpdate.id, "Etwas Neues.");

  const received = await notifications(passerbyCookie);
  assertEquals(received.length, 1);
  assertEquals(received[0]?.statusUpdateId, statusUpdate.id);
});

Deno.test("der Schalter braucht eine Meldung, die es gibt", async () => {
  const cookie = await registerUser(author);

  const response = await request(
    "PUT",
    "/api/status-updates/01900000-0000-7000-8000-00000000ffff/notifications",
    cookie,
    { subscribed: true },
  );

  assertEquals(response.status, STATUS_CODE.NotFound);
});
