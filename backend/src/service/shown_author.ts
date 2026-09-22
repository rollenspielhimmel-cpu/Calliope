import { sql } from "kysely";

/**
 * **Wer nach außen als Autor dasteht** — bei einem offiziellen Thread oder Beitrag der Absender,
 * sonst der Schreiber.
 *
 * Verdeckt ist, was `shown_as_set_at` trägt, nicht was `shown_as_user_id` trägt: Wird das
 * angezeigte Konto gelöscht, wird die Kennung null, und der Beitrag muss dann „gelöschtes Konto"
 * heißen — nicht auf den Schreiber zurückfallen, dessen Name nie erscheinen soll.
 *
 * **Kennung und Name kommen beide von hier**, und dazu der Bearbeiter: Eine Antwort, die den
 * Namen tauscht und die Kennung des Schreibers mitschickt, verrät ihn trotzdem. Die Ausdrücke sind
 * rohes SQL, weil sie in Abfragen stehen, deren Tabellen schon andere Aliase tragen; sie nennen
 * die Tabellen deshalb beim vollen Namen.
 *
 * Intern — Meldungen, Warteschlange, die eigene Prüfung, wer bearbeiten darf — gilt weiter
 * `created_by`: Das hier ist nur, was hinausgeht.
 */

type Table = "writing_thread" | "writing_post";

function shownId(table: Table) {
  return sql.raw(
    `CASE WHEN ${table}.shown_as_set_at IS NOT NULL THEN ${table}.shown_as_user_id ELSE ${table}.created_by END`,
  );
}

/** Die Kennung, die als Autor hinausgeht. */
export function shownAuthorId(table: Table) {
  return sql<string | null>`${shownId(table)}`;
}

/** Der Name dazu — null, wenn das Konto gelöscht ist. */
export function shownAuthorName(table: Table) {
  return sql<
    string | null
  >`(SELECT shown_author.username FROM "user" AS shown_author WHERE shown_author.id = ${
    shownId(table)
  })`;
}

/**
 * Wer bearbeitet hat, wie es hinausgeht. An einem verdeckten Beitrag ist das der angezeigte
 * Absender, sobald überhaupt jemand bearbeitet hat: Mitglieder sehen „bearbeitet", aber nicht,
 * welche Administration es war — deren Namen daneben zu setzen hieße, sie als Verfasserin zu
 * zeigen.
 */
export function shownEditorId() {
  return sql<string | null>`CASE
    WHEN writing_post.edited_by IS NULL AND writing_post.edited_at IS NULL THEN NULL
    WHEN writing_post.shown_as_set_at IS NOT NULL THEN writing_post.shown_as_user_id
    ELSE writing_post.edited_by
  END`;
}

export function shownEditorName() {
  return sql<
    string | null
  >`(SELECT shown_editor.username FROM "user" AS shown_editor WHERE shown_editor.id = ${shownEditorId()})`;
}

/** Ob der Beitrag verdeckt ist — für die Regel, wer ihn ändern darf, und für die Oberfläche. */
export function isOfficial(table: Table) {
  return sql<boolean>`${sql.raw(`${table}.shown_as_set_at IS NOT NULL`)}`;
}
