import { createMiddleware } from "hono/factory";
import type { Context, MiddlewareHandler } from "hono";
import { db } from "@/src/database/client.ts";

/**
 * **Gehört das Kind wirklich zum Elternteil aus der Adresse?**
 *
 * Eine Adresse wie `/groups/{groupId}/threads/{threadId}/posts/{postId}` nennt drei Dinge, und
 * jede Route darunter prüft die Rolle in `groupId`. Ob `threadId` zu dieser Gruppe gehört und
 * `postId` zu diesem Thread, prüfte bis September 2026 jede Route selbst — oder eben nicht: Die
 * drei Routen für einzelne Beiträge lasen den Beitrag nur über den Thread. Wer Mitglied irgendeiner
 * Gruppe war, las, änderte und löschte damit Beiträge jeder anderen, auch privater und auch aus dem
 * Forum, indem er die eigene Gruppe in die Adresse schrieb.
 *
 * Deshalb sitzt die Prüfung **vor dem Teilbaum**, dort, wo die Kennung ihn öffnet, und nicht in
 * den Routen darunter — wie `maskPseudonymousGroup` vor dem Teilbaum einer Gruppe. Eine Route, die
 * später dazukommt, erbt sie, statt sie vergessen zu können. Dass jede Adresse mit zwei Kennungen
 * so gedeckt ist, prüft `parent_scope_inventory_test.ts` gegen `open-api.json`.
 *
 * Fehlt die Zugehörigkeit, heißt die Antwort **404**, dieselbe wie für eine Kennung, die es nicht
 * gibt: Ob etwas anderswo existiert, geht den Fragenden nichts an. Die Routen darunter prüfen
 * weiter selbst; das hier ist die Sicherung, die nicht vergessen werden kann, nicht die einzige.
 */

type Check = (parentId: string, childId: string) => Promise<boolean>;

/** Eine Zeile gibt es mit genau dieser Kennung und genau diesem Elternteil. */
function rowExists(query: {
  execute: () => Promise<unknown[]>;
}): Promise<boolean> {
  return query.execute().then((rows) => rows.length > 0);
}

export function belongsToParent(
  parent: string,
  child: string,
  check: Check,
): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const parentId = c.req.param(parent);
    const childId = c.req.param(child);

    // Ohne beide Kennungen ist das hier an der falschen Stelle eingehängt — lieber laut als still.
    if (parentId === undefined || childId === undefined) {
      throw new Error(
        `belongsToParent(${parent}, ${child}) is mounted where the path lacks one of them`,
      );
    }

    // Keine UUID: Die Abfrage würde an der Spalte scheitern und 500 antworten. Die Route selbst
    // antwortet auf eine kaputte Kennung mit 400; hier ist sie schlicht nichts, was dazugehört.
    if (!UUID.test(parentId) || !UUID.test(childId)) {
      return notFound(c);
    }

    if (!await check(parentId, childId)) {
      return notFound(c);
    }

    await next();
    return;
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Die Beziehungen ─────────────────────────────────────────────────────────────────────────

export const threadBelongsToGroup = belongsToParent(
  "groupId",
  "threadId",
  (groupId, threadId) =>
    rowExists(
      db.selectFrom("writingThread").select("id")
        .where("id", "=", threadId)
        .where("writingGroupId", "=", groupId),
    ),
);

export const folderBelongsToGroup = belongsToParent(
  "groupId",
  "folderId",
  (groupId, folderId) =>
    rowExists(
      db.selectFrom("writingFolder").select("id")
        .where("id", "=", folderId)
        .where("writingGroupId", "=", groupId),
    ),
);

export const pageBelongsToGroup = belongsToParent(
  "groupId",
  "pageId",
  (groupId, pageId) =>
    rowExists(
      db.selectFrom("writingPage").select("id")
        .where("id", "=", pageId)
        .where("writingGroupId", "=", groupId),
    ),
);

export const stepBelongsToGroup = belongsToParent(
  "groupId",
  "stepId",
  (groupId, stepId) =>
    rowExists(
      db.selectFrom("writingGroupNextStep").select("id")
        .where("id", "=", stepId)
        .where("writingGroupId", "=", groupId),
    ),
);

/** Für Gruppe und Forum gleich: Der Beitrag steht in genau diesem Thread. */
export const postBelongsToThread = belongsToParent(
  "threadId",
  "postId",
  (threadId, postId) =>
    rowExists(
      db.selectFrom("writingPost").select("id")
        .where("id", "=", postId)
        .where("writingThreadId", "=", threadId),
    ),
);

/**
 * Die Absage als ungetypte Antwort, nicht als `c.json`: Eine getypte Antwort aus einem Mittelstück
 * wandert in den Typ jedes Routers, vor dem es hängt, und über die ganze Kette hinweg wird daraus
 * „Type instantiation is excessively deep". `maskPseudonymousGroup` gibt aus demselben Grund
 * keine eigene Antwort zurück.
 */
function notFound(c: Context): Response {
  return c.newResponse(JSON.stringify({ error: "Not found" }), 404, {
    "content-type": "application/json",
  });
}
