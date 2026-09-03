import { db } from "@/src/database/client.ts";
import { Mailer } from "@/src/mail/mailer.ts";
import { broadcastMail } from "@/src/mail/broadcast_mail.ts";
import { runInBackground } from "@/src/util/background.ts";

/**
 * One message to many members. The only thing here that is not obvious is who is left out, and
 * all three exclusions are deliberate:
 *
 * - **Banned accounts.** A ban is the platform having ended the relationship; writing to them
 *   anyway would be the one message they cannot opt out of.
 * - **Unverified addresses**, unless explicitly included. Nobody has proved they own those
 *   inboxes, so mail sent there goes to somebody who never asked for it — which is also how a
 *   domain's reputation is lost.
 * - **Suspended accounts are not excluded.** A suspension is temporary and they are still
 *   members; there is nothing to spare them from.
 *
 * The audience is chosen by group rather than being all-or-nothing, because most of what an
 * operator wants to say is addressed to the team or to everybody but the team.
 */

/**
 * Who a message goes to, as the groups an operator actually thinks in: the team, and everybody
 * else. `member` is the ordinary account with no platform role, which is almost everybody.
 */
export type BroadcastGroup = "administrator" | "moderator" | "member";

export type BroadcastAudience = {
  groups: BroadcastGroup[];
  /** Off by default at the route: an unverified address belongs to nobody in particular. */
  includeUnverified: boolean;
};

export type BroadcastResult = { recipients: number };

async function selectRecipients(audience: BroadcastAudience) {
  const roles = audience.groups.filter((group) => group !== "member");
  const includeOrdinaryMembers = audience.groups.includes("member");

  let query = db
    .selectFrom("user")
    .select("emailAddress")
    .where("bannedAt", "is", null)
    // `platform_role` is null for an ordinary member, so the two halves cannot be one `in`.
    .where((eb) =>
      eb.or([
        ...(includeOrdinaryMembers ? [eb("platformRole", "is", null)] : []),
        ...(roles.length > 0
          ? [
            eb(
              "platformRole",
              "in",
              roles as ("administrator" | "moderator")[],
            ),
          ]
          : []),
      ])
    );

  if (!audience.includeUnverified) {
    query = query.where("emailAddressVerifiedAt", "is not", null);
  }

  return await query.execute();
}

/**
 * Counts the recipients without sending, so the form can say how many this will reach before
 * anybody presses the button. The count is a moment's truth rather than a promise: somebody may
 * register between reading it and sending.
 */
async function countRecipients(
  audience: BroadcastAudience,
): Promise<number> {
  return (await selectRecipients(audience)).length;
}

/**
 * Returns as soon as the recipients are known, and sends afterwards. The handler never awaits a
 * send — see AGENTS.md — and with hundreds of them the request would otherwise stay open for as
 * long as the relay takes for all of them together.
 *
 * One message per recipient rather than one with everybody in bcc: a relay that rejects the
 * batch loses all of it, and one address visible to the rest would be a real disclosure.
 */
async function send(
  audience: BroadcastAudience,
  subject: string,
  body: string,
): Promise<BroadcastResult> {
  const recipients = await selectRecipients(audience);

  runInBackground(
    `Sending a broadcast to ${recipients.length} members`,
    () => {
      for (const recipient of recipients) {
        Mailer.sendInBackground(
          broadcastMail({
            emailAddress: recipient.emailAddress,
            subject,
            body,
          }),
        );
      }

      return Promise.resolve();
    },
  );

  return { recipients: recipients.length };
}

export const BroadcastService = { countRecipients, send };
