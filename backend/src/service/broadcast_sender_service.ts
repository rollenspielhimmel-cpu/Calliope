import { db } from "@/src/database/client.ts";
import type { PlatformRole } from "@/src/database/schema.ts";
import type { User } from "@/src/service/user_service.ts";
import { mayAdministerPlatform } from "@/src/service/platform_authorization.ts";

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

// ── Wer welchen Absender nutzen darf ─────────────────────────────────────────────────────────
//
// `sender_grant` gibt einen Absender einer Rolle oder einer Person. Administrationen dürfen jeden
// freigeschalteten, ohne Zeile. Siehe die Migration `absender_fuer_rollen_und_personen`.

/**
 * Der Schlüssel, unter dem ein Absender in `sender_grant` steht: null für „Admin", sonst das
 * Konto. „Admin" kommt auf zwei Wegen an — als null, und als die Kennung des Ur-Admin-Kontos, die
 * die Absenderliste zeigt —, und beides meint dasselbe.
 */
async function grantKey(senderUserId: string | null): Promise<string | null> {
  if (senderUserId === null) {
    return null;
  }

  const account = await db
    .selectFrom("user")
    .select("isPrimordialAdmin")
    .where("id", "=", senderUserId)
    .executeTakeFirst();

  return account?.isPrimordialAdmin === true ? null : senderUserId;
}

/** Die Absender, die diese Person über ihre Rolle oder persönlich bekommen hat — als Schlüssel. */
async function grantedKeys(user: User): Promise<Array<string | null>> {
  const rows = await db
    .selectFrom("senderGrant")
    .select("senderUserId")
    .where((eb) =>
      eb.or([
        eb("userId", "=", user.id),
        ...(user.platformRole === null
          ? []
          : [eb("role", "=", user.platformRole)]),
      ])
    )
    .execute();

  return rows.map((row) => row.senderUserId);
}

/**
 * Darf diese Person unter diesem Absender vorbereiten?
 *
 * **Im Backend, bei jedem Einreichen, Bearbeiten und Testen** — die Liste im Formular zeigt nur,
 * was jemand nutzen darf, aber sie hindert niemanden daran, eine andere Kennung zu schicken.
 * Freigeschaltet sein muss der Absender immer; dazu braucht jede Rolle ohne Administration eine
 * Freigabe für ihre Rolle oder für sich selbst.
 */
async function mayUseSender(
  user: User,
  senderUserId: string | null,
): Promise<boolean> {
  if (!await mayBeSender(senderUserId)) {
    return false;
  }

  if (mayAdministerPlatform(user.platformRole)) {
    return true;
  }

  const key = await grantKey(senderUserId);
  return (await grantedKeys(user)).includes(key);
}

/**
 * Die Absenderliste, wie diese Person sie sieht: alle für eine Administration, sonst nur, was ihre
 * Rolle oder sie selbst bekommen hat.
 */
async function listSendersFor(user: User): Promise<Sender[]> {
  const all = await listSenders();

  if (mayAdministerPlatform(user.platformRole)) {
    return all;
  }

  const keys = await grantedKeys(user);
  return all.filter((sender) =>
    keys.includes(sender.isPermanent ? null : sender.id)
  );
}

export type SenderGrant = {
  /** Die Kennung des Absenders, wie `listSenders` sie zeigt — bei „Admin" das Ur-Admin-Konto. */
  senderId: string;
  role: Exclude<PlatformRole, "administrator"> | null;
  userId: string | null;
  username: string | null;
  grantedAt: string;
};

/** Jede Freigabe, für die Übersicht des Ur-Admins: Rollen und Personen, je Absender. */
async function listGrants(): Promise<SenderGrant[]> {
  const [rows, rootAdmin] = await Promise.all([
    db
      .selectFrom("senderGrant")
      .leftJoin("user", "user.id", "senderGrant.userId")
      .select([
        "senderGrant.senderUserId",
        "senderGrant.role",
        "senderGrant.userId",
        "user.username",
        "senderGrant.grantedAt",
      ])
      .orderBy("user.username")
      .execute(),
    db
      .selectFrom("user")
      .select("id")
      .where("isPrimordialAdmin", "=", true)
      .executeTakeFirst(),
  ]);

  return rows.flatMap((row) => {
    const senderId = row.senderUserId ?? rootAdmin?.id;
    // Ohne Ur-Admin-Konto gibt es „Admin" als Absender gerade nicht; dann auch keine Zeile dafür.
    if (senderId === undefined) {
      return [];
    }
    return [{
      senderId,
      // Die Bedingung `sender_grant_not_for_administrators` hält `administrator` heraus.
      role: row.role as SenderGrant["role"],
      userId: row.userId,
      username: row.username,
      grantedAt: row.grantedAt,
    }];
  });
}

export type GrantRefusal = "not_a_sender" | "not_found";

/** Gibt einen Absender einer Rolle oder einer Person. Zweimal geben ändert nichts. */
async function grant(
  senderId: string,
  to: { role: Exclude<PlatformRole, "administrator"> } | { userId: string },
  grantedBy: string,
): Promise<GrantRefusal | undefined> {
  if (!await mayBeSender(senderId)) {
    return "not_a_sender";
  }

  if ("userId" in to) {
    const exists = await db
      .selectFrom("user")
      .select("id")
      .where("id", "=", to.userId)
      .executeTakeFirst();
    if (exists === undefined) {
      return "not_found";
    }
  }

  await db
    .insertInto("senderGrant")
    .values({
      senderUserId: await grantKey(senderId),
      role: "role" in to ? to.role : null,
      userId: "userId" in to ? to.userId : null,
      grantedBy,
    })
    // Beide Teilindizes sind eindeutig; welcher greift, hängt davon ab, ob Rolle oder Person.
    .onConflict((conflict) => conflict.doNothing())
    .execute();

  return undefined;
}

/** Nimmt eine Freigabe zurück. Was nicht vergeben war, ist danach genauso wenig vergeben. */
async function revoke(
  senderId: string,
  from: { role: Exclude<PlatformRole, "administrator"> } | { userId: string },
): Promise<void> {
  const key = await grantKey(senderId);

  await db
    .deleteFrom("senderGrant")
    .where((eb) =>
      key === null
        ? eb("senderUserId", "is", null)
        : eb("senderUserId", "=", key)
    )
    .where((eb) =>
      "role" in from
        ? eb("role", "=", from.role)
        : eb("userId", "=", from.userId)
    )
    .execute();
}

export const BroadcastSenderService = {
  listSenders,
  listSendersFor,
  releaseSender,
  withdrawSender,
  mayBeSender,
  mayUseSender,
  listGrants,
  grant,
  revoke,
};
