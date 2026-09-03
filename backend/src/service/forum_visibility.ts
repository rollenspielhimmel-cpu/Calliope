import type { ForumVisibility, PlatformRole } from "@/src/database/schema.ts";

/**
 * Who may read what in the forum. Two things carry a visibility — the sub-forum and, optionally,
 * the thread — and they combine by taking the **stricter** of the two.
 *
 * That direction is the whole point. A thread marked `everyone` inside an administration
 * sub-forum stays administration-only, which is what makes moving a thread into a closed
 * sub-forum a way to hide it. The opposite rule would turn one careless move into a disclosure.
 *
 * The enum is declared open-to-closed, so "stricter" is simply "greater" — in Postgres too,
 * where `greatest()` and `<=` do this without a mapping table. See the migration.
 */

/** Ascending strictness, matching the enum's declaration order. */
const RANK: Record<ForumVisibility, number> = {
  everyone: 0,
  members: 1,
  moderation: 2,
  administration: 3,
};

/**
 * A reader, as much of one as this decision needs. `undefined` is nobody signed in — the forum is
 * the one place in the product that answers without a session, so that is a real case here rather
 * than a defensive one.
 */
export type ForumReader = { platformRole: PlatformRole | null } | undefined;

/**
 * The most restricted level this reader may see. Everything at or below it is theirs; the query
 * side reads this as `visibility <= ceiling`, which is one comparison rather than four branches.
 */
export function visibilityCeiling(reader: ForumReader): ForumVisibility {
  if (reader === undefined) {
    return "everyone";
  }

  switch (reader.platformRole) {
    case "administrator":
      return "administration";
    case "moderator":
      return "moderation";
    case null:
      return "members";
  }
}

/** The stricter of the two, which is what a thread is actually read at. */
export function effectiveVisibility(
  subForum: ForumVisibility,
  thread: ForumVisibility | null,
): ForumVisibility {
  if (thread === null) {
    return subForum;
  }

  return RANK[thread] > RANK[subForum] ? thread : subForum;
}

/** Whether a reader may see something at this visibility. */
export function maySee(
  visibility: ForumVisibility,
  reader: ForumReader,
): boolean {
  return RANK[visibility] <= RANK[visibilityCeiling(reader)];
}

/**
 * Whether a reader may *write* where they may read. Signing in is the floor: the forum is
 * readable without an account in places, and writable in none of them.
 */
export function mayPost(
  visibility: ForumVisibility,
  reader: ForumReader,
): boolean {
  return reader !== undefined && maySee(visibility, reader);
}
