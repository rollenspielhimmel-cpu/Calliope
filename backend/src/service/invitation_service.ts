import { db } from "@/src/database/client.ts";
import { EmailAddressVerificationService } from "@/src/service/email_address_verification_service.ts";

/**
 * Two questions about how members arrive, which look like one and are not.
 *
 * **Who is stuck.** Somebody who registered and never confirmed their address reaches nothing
 * but the verification wall, so from their side the account does not exist. That is a
 * mistyped address or a mail in a spam folder far more often than it is somebody changing their
 * mind, which is why a reminder is worth sending at all.
 *
 * **Who actually arrived.** An invitation that was opened proves nothing; one that ends in a
 * confirmed address is a member. Counting the first would flatter every link that was ever
 * shared, so this counts only the second.
 */

export type PendingInvitation = {
  id: string;
  username: string;
  emailAddress: string;
  createdAt: string;
  invitedBy: { id: string; username: string } | null;
};

/** Oldest first: the account that has been stuck longest is the one to look at. */
async function listPendingInvitations(): Promise<PendingInvitation[]> {
  const rows = await db
    .selectFrom("user")
    .leftJoin("user as inviter", "inviter.id", "user.invitedBy")
    .select([
      "user.id",
      "user.username",
      "user.emailAddress",
      "user.createdAt",
      "inviter.id as inviterId",
      "inviter.username as inviterUsername",
    ])
    .where("user.emailAddressVerifiedAt", "is", null)
    // A banned account that never verified is not somebody to chase.
    .where("user.bannedAt", "is", null)
    .orderBy("user.createdAt", "asc")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    emailAddress: row.emailAddress,
    createdAt: row.createdAt,
    invitedBy: row.inviterId === null || row.inviterUsername === null
      ? null
      : { id: row.inviterId, username: row.inviterUsername },
  }));
}

export type InviterCount = {
  id: string;
  username: string;
  /** Registered through this member's link *and* confirmed their address. */
  arrived: number;
  /** Registered through it and have not confirmed. Not counted as arrivals. */
  pending: number;
};

/** Most arrivals first. Members who invited nobody do not appear at all. */
async function listInviters(): Promise<InviterCount[]> {
  const rows = await db
    .selectFrom("user")
    .innerJoin("user as inviter", "inviter.id", "user.invitedBy")
    .select(["inviter.id", "inviter.username", "user.emailAddressVerifiedAt"])
    .where("user.invitedBy", "is not", null)
    .execute();

  const counts = new Map<string, InviterCount>();

  for (const row of rows) {
    const entry = counts.get(row.id) ??
      { id: row.id, username: row.username, arrived: 0, pending: 0 };

    if (row.emailAddressVerifiedAt === null) {
      entry.pending += 1;
    } else {
      entry.arrived += 1;
    }

    counts.set(row.id, entry);
  }

  return [...counts.values()].sort((a, b) =>
    b.arrived - a.arrived || a.username.localeCompare(b.username, "de")
  );
}

export type ReminderRefusal = "not_found" | "already_verified";

/**
 * Sends the verification mail again rather than a reminder of its own. The link is the whole
 * point of the message, and a second kind of mail carrying the same link would be a second
 * place for it to go stale.
 *
 * The token service's own cooldown still applies, so pressing this twice sends one mail.
 */
async function sendVerificationReminder(
  userId: string,
): Promise<ReminderRefusal | undefined> {
  const user = await db
    .selectFrom("user")
    .select(["id", "username", "emailAddress", "emailAddressVerifiedAt"])
    .where("id", "=", userId)
    .executeTakeFirst();

  if (user === undefined) {
    return "not_found";
  }

  if (user.emailAddressVerifiedAt !== null) {
    return "already_verified";
  }

  EmailAddressVerificationService.sendVerificationMail(user);
  return undefined;
}

export const InvitationService = {
  listPendingInvitations,
  listInviters,
  sendVerificationReminder,
};
