import { assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
  write,
} from "@/src/test/support.ts";

/**
 * Eigenes löschen — und was davon im Protokoll bleibt.
 *
 * **Der Fall, für den das Protokoll da ist:** Jemand schreibt etwas, zieht es zurück und behauptet
 * später, es nie getan zu haben. Ohne Aufzeichnung steht Aussage gegen Aussage.
 */

const author = "status-delete-author";
const other = "status-delete-other";

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(async () => {
  await write((transaction) =>
    transaction
      .deleteFrom("statusUpdateDeletion")
      .where("writtenByUsername", "in", [author, other])
      .execute()
  );
  await deleteUsers([author, other]);
});

async function post(cookie: string, body: string) {
  const response = await request("POST", "/api/status-updates", cookie, {
    body,
  });
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json();
}

async function comment(cookie: string, statusUpdateId: string, body: string) {
  const response = await request(
    "POST",
    `/api/status-updates/${statusUpdateId}/comments`,
    cookie,
    { body },
  );
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json();
}

function log() {
  return db
    .selectFrom("statusUpdateDeletion")
    .select([
      "kind",
      "body",
      "writtenByUsername",
      "deletedByUsername",
      "byModeration",
    ])
    .where("writtenByUsername", "in", [author, other])
    .orderBy("deletedAt", "asc")
    .execute();
}

Deno.test("eine eigene Meldung nimmt ihre Kommentare mit, und alles steht im Protokoll", async () => {
  const authorCookie = await registerUser(author);
  const otherCookie = await registerUser(other);
  const statusUpdate = await post(authorCookie, "Meine Meldung");
  await comment(otherCookie, statusUpdate.id, "Fremder Kommentar");

  assertEquals(
    (await request(
      "DELETE",
      `/api/status-updates/${statusUpdate.id}`,
      authorCookie,
    )).status,
    STATUS_CODE.NoContent,
  );

  // Weg — und mit ihr der Kommentar darunter.
  assertEquals(
    (await request(
      "GET",
      `/api/status-updates/${statusUpdate.id}/comments`,
      authorCookie,
    )).status,
    STATUS_CODE.NotFound,
  );

  // **Beides steht im Protokoll**, jedes mit seinem eigenen Verfasser: Wer eine Meldung löscht,
  // entfernt damit auch fremdes Wort, und das muss nachlesbar bleiben.
  assertEquals(await log(), [
    {
      kind: "status_update",
      body: "Meine Meldung",
      writtenByUsername: author,
      deletedByUsername: author,
      byModeration: false,
    },
    {
      kind: "comment",
      body: "Fremder Kommentar",
      writtenByUsername: other,
      deletedByUsername: author,
      byModeration: false,
    },
  ]);
});

/** Weich gelöscht: Der Text ist weg, die Zeile bleibt — sonst hinge ein Zitat darauf in der Luft. */
Deno.test("ein eigener Kommentar wird leer, nicht weg", async () => {
  const authorCookie = await registerUser(author);
  const otherCookie = await registerUser(other);
  const statusUpdate = await post(authorCookie, "Meine Meldung");
  const mine = await comment(otherCookie, statusUpdate.id, "Nehme ich zurück");

  assertEquals(
    (await request(
      "DELETE",
      `/api/status-updates/${statusUpdate.id}/comments/${mine.id}`,
      otherCookie,
    )).status,
    STATUS_CODE.NoContent,
  );

  const comments = await (await request(
    "GET",
    `/api/status-updates/${statusUpdate.id}/comments`,
    authorCookie,
  )).json();

  assertEquals(comments.results.length, 1);
  // Der Text verlässt den Server nicht — auch nicht für den, der die Antwort abfängt.
  assertEquals(comments.results[0].body, "");
  assertEquals(comments.results[0].deletedBy, "member");

  assertEquals((await log())[0]?.body, "Nehme ich zurück");

  // Ein zweites Mal gibt es nichts zu löschen.
  assertEquals(
    (await request(
      "DELETE",
      `/api/status-updates/${statusUpdate.id}/comments/${mine.id}`,
      otherCookie,
    )).status,
    STATUS_CODE.NotFound,
  );
});

Deno.test("fremdes löscht hier noch niemand", async () => {
  const authorCookie = await registerUser(author);
  const otherCookie = await registerUser(other);
  const statusUpdate = await post(authorCookie, "Meine Meldung");
  const mine = await comment(authorCookie, statusUpdate.id, "Mein Kommentar");

  assertEquals(
    (await request(
      "DELETE",
      `/api/status-updates/${statusUpdate.id}`,
      otherCookie,
    )).status,
    STATUS_CODE.Forbidden,
  );

  assertEquals(
    (await request(
      "DELETE",
      `/api/status-updates/${statusUpdate.id}/comments/${mine.id}`,
      otherCookie,
    )).status,
    STATUS_CODE.Forbidden,
  );

  assertEquals(await log(), []);
});
