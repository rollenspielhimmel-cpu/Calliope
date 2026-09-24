import { assertEquals, assertFalse } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
} from "@/src/test/support.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";

const author = "status-comments-create-author";
const commenter = "status-comments-create-commenter";

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(() => deleteUsers([author, commenter]));

async function createStatusUpdate(cookie: string) {
  const response = await request("POST", "/api/status-updates", cookie, {
    body: "Ein Status",
  });
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json();
}

Deno.test("POST /api/status-updates/{id}/comments adds a comment", async () => {
  const cookie = await registerUser(author);
  const commenterCookie = await registerUser(commenter);
  const statusUpdate = await createStatusUpdate(cookie);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    commenterCookie,
    { body: "Schön geschrieben!" },
  );

  assertEquals(response.status, STATUS_CODE.Created);
  const created = await response.json();
  assertEquals(created.body, "Schön geschrieben!");
  assertEquals(created.statusUpdateId, statusUpdate.id);
  assertEquals(created.createdByUsername, commenter);
});

Deno.test("POST /api/status-updates/{id}/comments trims the body", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body: "  Danke!  " },
  );

  assertEquals(response.status, STATUS_CODE.Created);
  assertEquals((await response.json()).body, "Danke!");
});

Deno.test("POST /api/status-updates/{id}/comments refuses a body of only whitespace", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body: "   " },
  );

  assertEquals(response.status, STATUS_CODE.BadRequest);
});

Deno.test("POST /api/status-updates/{id}/comments accepts a body at the limit", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);
  const body = "a".repeat(TEXT_LIMIT.statusUpdateCommentBody);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body },
  );

  assertEquals(response.status, STATUS_CODE.Created);
  assertEquals(
    (await response.json()).body.length,
    TEXT_LIMIT.statusUpdateCommentBody,
  );
});

Deno.test("POST /api/status-updates/{id}/comments refuses a body past the limit", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);
  const body = "a".repeat(TEXT_LIMIT.statusUpdateCommentBody + 1);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body },
  );

  assertEquals(response.status, STATUS_CODE.BadRequest);
});

Deno.test("POST /api/status-updates/{id}/comments answers 404 for a status update that does not exist", async () => {
  const cookie = await registerUser(author);

  const response = await request(
    "POST",
    "/api/status-updates/01a00000-0000-7000-8000-00000000ffff/comments",
    cookie,
    { body: "Hallo" },
  );

  assertEquals(response.status, STATUS_CODE.NotFound);
});

Deno.test("POST /api/status-updates/{id}/comments needs a session", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    "",
    { body: "Hallo" },
  );

  assertEquals(response.status, STATUS_CODE.Unauthorized);
  assertFalse(response.headers.has("set-cookie"));
});

/**
 * Das Zitat als Bezug.
 *
 * **Der Fall, für den es gebaut ist:** Als Text mitgeschickt war das Zitat nach 60 Zeichen zu
 * Ende — es gab kein „weiterlesen", weil der Rest nie gespeichert war —, der Name ließ sich nicht
 * verlinken, und er wäre eingefroren, sobald jemand sich umbenennt.
 */
Deno.test("ein Kommentar zitiert einen anderen, und das Zitat kommt frisch", async () => {
  const cookie = await registerUser(author);
  const commenterCookie = await registerUser(commenter);
  const statusUpdate = await createStatusUpdate(cookie);

  const quoted = await (await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body: "Der Beitrag, auf den sich jemand bezieht." },
  )).json();

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    commenterCookie,
    { body: "Sehe ich auch so.", quotedCommentId: quoted.id },
  );

  assertEquals(response.status, STATUS_CODE.Created);
  const created = await response.json();

  // Der ganze Text, nicht die ersten 60 Zeichen — und der Name als eigene Angabe, nicht als
  // `@name:` im Fließtext.
  assertEquals(created.quotedComment, {
    id: quoted.id,
    body: "Der Beitrag, auf den sich jemand bezieht.",
    createdBy: quoted.createdBy,
    createdByUsername: author,
  });

  // Und beim Lesen steht es genauso da.
  const listed = await (await request(
    "GET",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
  )).json();

  assertEquals(listed.results[0].quotedComment, null);
  assertEquals(listed.results[1].quotedComment.createdByUsername, author);
});

/** Ohne Bezug bleibt das Feld leer — die meisten Kommentare zitieren nichts. */
Deno.test("ein Kommentar ohne Zitat trägt keines", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);

  const created = await (await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body: "Einfach nur ein Kommentar." },
  )).json();

  assertEquals(created.quotedComment, null);
});

/**
 * **Ein Zitat kann seine Meldung nicht verlassen.** Die Datenbank lehnt es ohnehin ab — der
 * Fremdschlüssel zeigt auf das Paar aus Kommentar und Meldung —, aber als Verstoß gäbe das eine
 * 500. Hier kommt ein Nein mit Grund zurück.
 */
Deno.test("ein Kommentar zitiert nichts aus einer fremden Meldung", async () => {
  const cookie = await registerUser(author);
  const statusUpdate = await createStatusUpdate(cookie);
  const andere = await createStatusUpdate(cookie);

  const fremd = await (await request(
    "POST",
    `/api/status-updates/${andere.id}/comments`,
    cookie,
    { body: "Steht woanders." },
  )).json();

  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdate.id}/comments`,
    cookie,
    { body: "Ich zitiere quer.", quotedCommentId: fremd.id },
  );

  assertEquals(response.status, STATUS_CODE.NotFound);
});
