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
 *
 * **Eine Rundmail ist eine Mitteilung innerhalb der Community**, und der Versand per E-Mail ist
 * eine zweite, getrennte Frage. Beide Wege stehen unten nebeneinander, keiner setzt den anderen
 * voraus.
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

/**
 * Welche Wege diese Rundmail nimmt. Drei getrennte Fragen, keine Kopplung.
 *
 * Das Archiv steht bewusst neben den beiden Zustellwegen und nicht darunter: Auch eine reine
 * E-Mail-Rundmail soll im Forum nachlesbar sein, wenn der Haken gesetzt ist.
 */
export type BroadcastDelivery = {
  toInbox: boolean;
  byEmail: boolean;
  toArchive: boolean;
};

/**
 * Zwei Zahlen, nicht eine.
 *
 * **Weil die beiden Wege verschieden weit reichen.** Wer seine Adresse nie bestätigt hat, ist
 * Mitglied und liest sein Postfach — bekommt aber keine Mail, solange niemand das ausdrücklich
 * einschließt. Eine einzelne Zahl müsste sich für eine der beiden Wahrheiten entscheiden und die
 * andere verschweigen.
 *
 * Am deutlichsten wird das bei „nur E-Mail": Dort sind die Übersprungenen von niemandem erreicht,
 * auf keinem Weg. Das muss vor dem Absenden sichtbar sein, weil es die Wahl des Weges ändert.
 */
export type BroadcastReach = {
  /** Alle im Empfängerkreis — die sehen es im Postfach, wenn dieser Weg gewählt ist. */
  inbox: number;
  /** Davon die, an die auch eine Mail gehen kann. */
  email: number;
};

export type BroadcastResult = BroadcastReach;

/**
 * Der Empfängerkreis, ungefiltert nach Adressbestätigung.
 *
 * **Die Bestätigung ist eine Frage an die E-Mail, nicht an die Mitgliedschaft.** Sie hier
 * abzuziehen hieße, jemandem das Postfach auf der Plattform zu verwehren, weil seine Adresse
 * ungeprüft ist — zwei Dinge, die nichts miteinander zu tun haben. Also trennt erst
 * `mayReceiveEmail` weiter unten.
 */
async function selectRecipients(audience: BroadcastAudience) {
  const roles = audience.groups.filter((group) => group !== "member");
  const includeOrdinaryMembers = audience.groups.includes("member");

  return await db
    .selectFrom("user")
    .select(["id", "emailAddress", "emailAddressVerifiedAt"])
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
    )
    .execute();
}

/** Darf an diese Adresse eine Rundmail gehen? */
function mayReceiveEmail(
  recipient: { emailAddressVerifiedAt: string | null },
  audience: BroadcastAudience,
): boolean {
  return audience.includeUnverified ||
    recipient.emailAddressVerifiedAt !== null;
}

/**
 * Counts the recipients without sending, so the form can say how many this will reach before
 * anybody presses the button. The count is a moment's truth rather than a promise: somebody may
 * register between reading it and sending.
 */
async function countRecipients(
  audience: BroadcastAudience,
): Promise<BroadcastReach> {
  const recipients = await selectRecipients(audience);

  return {
    inbox: recipients.length,
    email:
      recipients.filter((recipient) => mayReceiveEmail(recipient, audience))
        .length,
  };
}

/**
 * Aus dem eingetippten Text ein Dokument, wie der Editor es ablegt.
 *
 * Der Betreffkasten nimmt nur Text entgegen, das Forum speichert die Baumform des Editors. Leere
 * Zeilen trennen Absätze, einzelne Umbrüche bleiben Umbrüche — wer den Text so getippt hat, wie er
 * aussehen soll, findet ihn im Forum wieder.
 */
function documentOf(body: string) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return {
    type: "doc",
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: paragraph.split("\n").flatMap((line, index) => [
        ...(index > 0 ? [{ type: "hardBreak" }] : []),
        { type: "text", text: line },
      ]),
    })),
  };
}

/**
 * Legt die Rundmail als Forenbeitrag ab und gibt die Beitragskennung zurück.
 *
 * **Der Ordner wird an seiner Kennzeichnung erkannt, nicht an seinem Titel** — siehe die Migration.
 * Fehlt er, wird nichts abgelegt und nichts behauptet: Der Aufrufer bekommt `null` und trägt es
 * nirgends ein, statt dass eine Rundmail scheinbar im Archiv steht.
 *
 * Verfasst unter dem gewählten Absender, wie die Mail auch. Nach außen ist das dieselbe Stimme;
 * wer sie wirklich geschrieben hat, steht auf der Veröffentlichung und bleibt der Administration
 * vorbehalten.
 */
async function publishInArchive(
  subject: string,
  body: string,
  publicationId: string,
  sendAsUserId: string | null,
): Promise<string | null> {
  const folder = await db
    .selectFrom("writingFolder")
    .select("id")
    .where("isBroadcastArchive", "=", true)
    .executeTakeFirst();

  if (folder === undefined) {
    console.warn(
      "No folder is marked as the broadcast archive; skipping the archive copy",
    );
    return null;
  }

  return await db.transaction().execute(async (transaction) => {
    const thread = await transaction
      .insertInto("writingThread")
      .values({
        writingGroupId: null,
        folderId: folder.id,
        title: subject,
        // Pflicht für einen Forenfaden — `writing_thread_permission_is_forum_only` verlangt genau
        // dann eine Angabe, wenn keine Schreibgruppe dahintersteht. `write`, weil Antworten das
        // Einzige ist, was das Archiv kann und das Postfach nicht.
        memberPermission: "write",
        createdBy: sendAsUserId,
        publicationId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const post = await transaction
      .insertInto("writingPost")
      .values({
        writingThreadId: thread.id,
        document: JSON.stringify(documentOf(body)),
        text: body,
        isDraft: false,
        createdBy: sendAsUserId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return post.id;
  });
}

/**
 * Returns as soon as the recipients are known, and sends afterwards. The handler never awaits a
 * send — see AGENTS.md — and with hundreds of them the request would otherwise stay open for as
 * long as the relay takes for all of them together.
 *
 * One message per recipient rather than one with everybody in bcc: a relay that rejects the
 * batch loses all of it, and one address visible to the rest would be a real disclosure.
 *
 * **Das Postfach wird vor der Rückkehr geschrieben, die Mails danach.** Die Postfachzeilen sind
 * eine einzige Anweisung und in Millisekunden erledigt; sie in den Hintergrund zu schieben hieße
 * nur, dass die Antwort eine Reichweite meldet, die noch nirgends steht. Der Mailversand dagegen
 * hängt am Relais und gehört dorthin, wo niemand auf ihn wartet.
 */
async function send(
  broadcastId: string,
  audience: BroadcastAudience,
  delivery: BroadcastDelivery,
  subject: string,
  body: string,
): Promise<BroadcastResult> {
  const recipients = await selectRecipients(audience);
  const byEmail = recipients.filter((recipient) =>
    mayReceiveEmail(recipient, audience)
  );

  if (delivery.toInbox && recipients.length > 0) {
    // Eine Anweisung für alle Empfänger, nicht eine je Empfänger: Bei tausend Mitgliedern wären das
    // sonst tausend Umläufe zur Datenbank für etwas, das die Datenbank in einem tut.
    //
    // `actorId` bleibt leer, und das ist keine Nachlässigkeit: `notification_actor_is_not_recipient`
    // verbietet, dass jemand sich selbst benachrichtigt — und wer eine Rundmail an alle schickt, ist
    // fast immer selbst unter „alle". Genau seine Zeile würde umfallen und mit ihr die ganze
    // Anweisung. Wer sie verschickt hat, steht ohnehin auf der Veröffentlichung.
    await db
      .insertInto("notification")
      .values(recipients.map((recipient) => ({
        recipientId: recipient.id,
        type: "broadcast_received" as const,
        broadcastId,
        actorId: null,
      })))
      .execute();
  }

  if (delivery.byEmail) {
    runInBackground(
      `Sending a broadcast to ${byEmail.length} members`,
      () => {
        for (const recipient of byEmail) {
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
  }

  return {
    inbox: delivery.toInbox ? recipients.length : 0,
    email: delivery.byEmail ? byEmail.length : 0,
  };
}

/**
 * Eine Rundmail, wie ihr Empfänger sie liest — oder nichts.
 *
 * **Die Benachrichtigung ist der Schlüssel.** Wer die Rundmail bekommen hat, hat eine Zeile im
 * Postfach; wer keine hat, bekommt hier nichts, auch als Administration nicht. Die Verwaltung liest
 * Rundmails über ihre eigene Liste, und die zeigt ohnehin mehr — wer sie verfasst und wer sie
 * freigegeben hat.
 */
async function readReceived(broadcastId: string, recipientId: string) {
  return await db
    .selectFrom("broadcast")
    .innerJoin("publication", "publication.id", "broadcast.publicationId")
    .innerJoin("notification", "notification.broadcastId", "broadcast.id")
    .leftJoin("user as sender", "sender.id", "publication.sendAsUserId")
    // Der Faden, nicht der Beitrag: Steht die Rundmail im Forum, gehört sie dorthin, und die
    // Oberfläche schickt den Lesenden gleich weiter, statt denselben Text zweimal zu zeigen.
    .leftJoin("writingPost", "writingPost.id", "broadcast.archivePostId")
    .select([
      "broadcast.subject",
      "broadcast.body",
      "writingPost.writingThreadId as archiveThreadId",
      "sender.username as sendAsUsername",
      "publication.releasedAt",
    ])
    .where("broadcast.id", "=", broadcastId)
    .where("notification.recipientId", "=", recipientId)
    .executeTakeFirst();
}

export const BroadcastService = {
  countRecipients,
  send,
  publishInArchive,
  readReceived,
};
