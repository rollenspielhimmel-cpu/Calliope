import { db } from "@/src/database/client.ts";

/**
 * Keeping an eye on somebody, independent of the report queue and of the strike ladder: not an
 * incident and not a consequence, just a note that says why somebody is worth a second look.
 *
 * Its own service rather than part of `strike_service.ts` because the two answer different
 * questions — one is what was decided about a member, the other is that nothing has been.
 */

export type WatchlistEntry = {
  user: { id: string; username: string };
  note: string;
  addedBy: { id: string; username: string } | null;
  addedAt: string;
};

/** Adding somebody already on the list updates the note and the time: one row per member. */
async function addToWatchlist(
  userId: string,
  note: string,
  addedBy: string,
): Promise<"not_found" | undefined> {
  // Checked rather than left to the foreign key, which would answer 500 for what is a 404.
  const target = await db
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst();

  if (target === undefined) {
    return "not_found";
  }

  await db
    .insertInto("watchlistEntry")
    .values({ userId, note, addedBy })
    .onConflict((conflict) =>
      conflict.column("userId").doUpdateSet({
        note,
        addedBy,
        addedAt: Temporal.Now.instant().toString(),
      })
    )
    .execute();

  return undefined;
}

async function removeFromWatchlist(userId: string): Promise<void> {
  await db.deleteFrom("watchlistEntry").where("userId", "=", userId).execute();
}

async function isWatched(userId: string): Promise<boolean> {
  const row = await db
    .selectFrom("watchlistEntry")
    .select("userId")
    .where("userId", "=", userId)
    .executeTakeFirst();

  return row !== undefined;
}

async function listWatchlist(): Promise<WatchlistEntry[]> {
  const rows = await db
    .selectFrom("watchlistEntry")
    .innerJoin("user", "user.id", "watchlistEntry.userId")
    .leftJoin("user as addedByUser", "addedByUser.id", "watchlistEntry.addedBy")
    .select([
      "user.id as userId",
      "user.username as username",
      "watchlistEntry.note",
      "watchlistEntry.addedAt",
      "addedByUser.id as addedById",
      "addedByUser.username as addedByUsername",
    ])
    .orderBy("watchlistEntry.addedAt", "desc")
    .execute();

  return rows.map((row) => ({
    user: { id: row.userId, username: row.username },
    note: row.note,
    addedBy: row.addedById === null || row.addedByUsername === null
      ? null
      : { id: row.addedById, username: row.addedByUsername },
    addedAt: row.addedAt,
  }));
}

export const WatchlistService = {
  addToWatchlist,
  removeFromWatchlist,
  isWatched,
  listWatchlist,
};
