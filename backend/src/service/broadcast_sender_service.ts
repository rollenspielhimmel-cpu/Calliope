import { db } from "@/src/database/client.ts";

/**
 * Which accounts a broadcast may be sent as.
 *
 * A team member writes the mail; the account it appears to come from is chosen when it goes out.
 * „Admin" for something official, or a persona the team keeps for an occasion — a „Weihnachtsmann"
 * that writes on the 24th and is silent the rest of the year.
 *
 * **The root administrator is always here and cannot be removed**, the same way it holds the
 * Blind-Date desk by being that account: it is the platform's own voice, and a row saying so would
 * suggest it could be taken away. It sorts first for the same reason.
 *
 * **A persona need not be on the team.** Unlike the Blind-Date desk, this is not a right somebody
 * exercises — nobody signs in as the Weihnachtsmann. It is a name a mail wears, so the account
 * behind it may be an ordinary one that exists for nothing else.
 */

export type Sender = {
  id: string;
  username: string;
  /** True for the root administrator, which is in the list without a row and cannot leave it. */
  isPermanent: boolean;
};

/**
 * The root administrator first, then everybody released, by name.
 *
 * By name rather than by when they were released: a list somebody picks from should be findable,
 * and „whoever was added last" is an order only the person who added them knows. `sort_order` is in
 * the table for the day somebody wants to pin one — nothing sets it yet, and a column nobody writes
 * is cheaper than a migration later.
 */
async function listSenders(): Promise<Sender[]> {
  const [rootAdmin, released] = await Promise.all([
    db
      .selectFrom("user")
      .select(["id", "username"])
      .where("isPrimordialAdmin", "=", true)
      .executeTakeFirst(),
    db
      .selectFrom("broadcastSender")
      .innerJoin("user", "user.id", "broadcastSender.userId")
      .select(["user.id", "user.username"])
      .where("user.isPrimordialAdmin", "=", false)
      .orderBy("broadcastSender.sortOrder", "asc")
      .orderBy("user.username", "asc")
      .execute(),
  ]);

  return [
    ...(rootAdmin === undefined ? [] : [{ ...rootAdmin, isPermanent: true }]),
    ...released.map((row) => ({ ...row, isPermanent: false })),
  ];
}

export type ReleaseRefusal = "not_found" | "is_root_administrator";

/**
 * Releases an account, found by the name it goes by.
 *
 * **By name rather than by id, because there is no way to look an account up.** Releasing is not
 * picking from a set the interface can show: any of thousands of accounts may be one, and the only
 * person who does this already knows which — they created the persona. Building a member search to
 * feed one field would be a new surface for one caller, and a search over every account is a thing
 * to add on purpose rather than in passing.
 *
 * Releasing an account that is already released is not an error: two people reaching the same state
 * should not depend on who got there first. The record keeps the first release rather than
 * overwriting it — „since when" is the half worth having.
 */
async function releaseSender(
  username: string,
  enabledBy: string,
): Promise<ReleaseRefusal | undefined> {
  const user = await db
    .selectFrom("user")
    .select(["id", "isPrimordialAdmin"])
    // Case-insensitively, the way signing in finds an account: somebody typing „weihnachtsmann"
    // means the account they named it, and being told it does not exist would be a lie.
    .where((eb) =>
      eb(eb.fn("lower", ["username"]), "=", username.toLowerCase())
    )
    .executeTakeFirst();

  if (user === undefined) {
    return "not_found";
  }

  if (user.isPrimordialAdmin) {
    return "is_root_administrator";
  }

  await db
    .insertInto("broadcastSender")
    .values({ userId: user.id, enabledBy })
    .onConflict((conflict) => conflict.column("userId").doNothing())
    .execute();

  return undefined;
}

/**
 * Takes a release back.
 *
 * **Does not touch what was already sent**: `publication.send_as_user_id` points at the account
 * rather than at this table, so a mail that went out as the Weihnachtsmann still says so next
 * December, when the persona is no longer released.
 *
 * Withdrawing something that is not released succeeds quietly — the caller wanted it gone, and it
 * is gone. Only the root administrator is refused, because that is a misunderstanding worth
 * answering rather than a state to reach.
 */
async function withdrawSender(
  userId: string,
): Promise<"is_root_administrator" | undefined> {
  const user = await db
    .selectFrom("user")
    .select("isPrimordialAdmin")
    .where("id", "=", userId)
    .executeTakeFirst();

  if (user?.isPrimordialAdmin === true) {
    return "is_root_administrator";
  }

  await db
    .deleteFrom("broadcastSender")
    .where("userId", "=", userId)
    .execute();

  return undefined;
}

/**
 * Darf unter diesem Konto gesendet werden?
 *
 * **Die Frage muss beim Senden gestellt werden, nicht nur beim Auswählen.** Die Liste im Formular
 * schlägt vor; sie hindert niemanden daran, eine andere Kennung zu schicken. Ohne diese Prüfung
 * könnte jede Administration eine Rundmail an alle unter dem Namen eines beliebigen Mitglieds
 * verschicken — und die Freigabe des Ur-Admins wäre eine Empfehlung statt einer Regel.
 *
 * Null heißt das Ur-Admin-Konto und ist immer erlaubt: Es steht dauerhaft zur Verfügung, ohne
 * Zeile in der Tabelle, aus denselben Gründen wie in `listSenders`.
 */
async function mayBeSender(userId: string | null): Promise<boolean> {
  if (userId === null) {
    return true;
  }

  const released = await db
    .selectFrom("user")
    .select("user.id")
    .leftJoin("broadcastSender", "broadcastSender.userId", "user.id")
    .where("user.id", "=", userId)
    .where((eb) =>
      eb.or([
        eb("broadcastSender.userId", "is not", null),
        eb("user.isPrimordialAdmin", "=", true),
      ])
    )
    .executeTakeFirst();

  return released !== undefined;
}

export const BroadcastSenderService = {
  listSenders,
  releaseSender,
  withdrawSender,
  mayBeSender,
};
