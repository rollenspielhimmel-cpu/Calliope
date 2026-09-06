import { db } from "@/src/database/client.ts";
import { Mailer } from "@/src/mail/mailer.ts";
import { broadcastMail } from "@/src/mail/broadcast_mail.ts";
import { runInBackground } from "@/src/util/background.ts";
import { generate as generateUuidV7 } from "@std/uuid/v7";
import { publishChatEvent } from "@/src/event/chat_events.ts";
import type { PostDocument } from "@/src/document/document_schema.ts";
import {
  documentToPlainText,
  plainTextToDocument,
} from "@/src/document/document_text.ts";

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
 * Was beim Zustellen ins Postfach entstanden ist — genug, um es den offenen Fenstern zu sagen.
 *
 * Die Kennungen der Nachrichten stehen darin, weil sie beim Anlegen erzeugt werden und nicht aus
 * der Datenbank zurückgelesen: Ein Ereignis trägt die Nachricht selbst, damit der Browser sie
 * anzeigen kann, ohne noch einmal zu fragen.
 */
type Delivered = {
  sender: { id: string; username: string } | null;
  chats: Array<{ id: string; messageId: string; recipientId: string }>;
  at: string;
};

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
function documentOf(subject: string, body: string): PostDocument {
  // **Auf `plainTextToDocument` aufgebaut statt selbst gebaut.** Mein Eigenbau hat zwei Regeln des
  // Schemas übersehen, die dort schon bedacht sind: Ein `doc` darf nicht leer sein, und ein
  // Textknoten auch nicht — eine Rundmail, deren Text nach dem Trimmen nichts übrig lässt, hätte
  // ein Dokument ergeben, das die Prüfung nicht besteht.
  const { content } = plainTextToDocument(body);

  return {
    type: "doc",
    content: [
      // **Der Betreff als Überschrift, weil alle Rundmails in einem Faden stehen.** Ohne sie wäre
      // die Sammlung eine Folge von Beiträgen, in der niemand sieht, wo eine Mitteilung endet und
      // die nächste beginnt. Ebene 3, weil der Editor nur 2 und 3 zulässt und 2 der Fadentitel ist.
      {
        type: "heading",
        // `textAlign` gehört dazu: Das Schema ist streng, und ein Knoten ohne dieses Feld fällt
        // bei der Prüfung durch — was beim direkten Einfügen niemand merkt.
        attrs: { level: 3, textAlign: null },
        content: [{ type: "text", text: subject }],
      },
      ...content,
    ],
  };
}

/**
 * Hängt die Rundmail an den Archiv-Faden und gibt die Beitragskennung zurück.
 *
 * **Ein Faden für alle, nicht einer je Rundmail.** Wer als neues Mitglied nachlesen will, was es je
 * gab, liest einmal von oben nach unten — statt eine Liste von Fäden zu finden und jeden einzeln zu
 * öffnen. Der Betreff steht deshalb als Überschrift im Beitrag: In einer Sammlung muss man sehen,
 * wo eine Mitteilung endet und die nächste beginnt.
 *
 * **Der Faden wird an seiner Kennzeichnung erkannt, nicht an seinem Titel** — siehe die Migration.
 * Fehlt er, wird nichts abgelegt und nichts behauptet: Der Aufrufer bekommt `null` und trägt es
 * nirgends ein, statt dass eine Rundmail scheinbar im Archiv steht.
 *
 * Verfasst unter dem gewählten Absender, wie die Nachricht auch. Nach außen ist das dieselbe
 * Stimme; wer sie wirklich geschrieben hat, steht auf der Veröffentlichung und bleibt der
 * Administration vorbehalten.
 */
async function publishInArchive(
  subject: string,
  body: string,
  sendAsUserId: string | null,
): Promise<string | null> {
  const thread = await db
    .selectFrom("writingThread")
    .select("id")
    .where("isBroadcastArchive", "=", true)
    .executeTakeFirst();

  if (thread === undefined) {
    console.warn(
      "No thread is marked as the broadcast archive; skipping the archive copy",
    );
    return null;
  }

  // Aufgelöst wie im Postfach: Ein Beitrag ohne Verfasser sähe im Forum aus, als hätte ihn niemand
  // geschrieben, während dieselbe Rundmail in der Nachricht den Absender trägt.
  const sender = await resolveSender(sendAsUserId);
  const document = documentOf(subject, body);

  const post = await db
    .insertInto("writingPost")
    .values({
      writingThreadId: thread.id,
      // **Ein Objekt, keine Zeichenkette.** `JSON.stringify` legt in einer jsonb-Spalte eine
      // JSON-*Zeichenkette* ab statt eines Dokuments; der Editor bekommt dann Text, wo er einen
      // Baum erwartet, und zeichnet nichts. Genau so standen die ersten Archiv-Beiträge da — sie
      // waren vorhanden und leer. Dieselbe Warnung steht seit je in `writing_post_service.ts`,
      // zwei Dateien weiter.
      document,
      // Abgeleitet statt zusammengesetzt, damit Volltext und Dokument nicht auseinanderlaufen
      // können — dieselbe Regel wie beim gewöhnlichen Beitrag. Der Betreff steht darin, weil er
      // im Dokument die Überschrift ist.
      text: documentToPlainText(document),
      isDraft: false,
      createdBy: sender?.id ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return post.id;
}

/**
 * Unter welchem Konto die Rundmail nach außen erscheint.
 *
 * Leer heißt: das dauerhaft verfügbare Konto, das ohne Zeile in `broadcast_sender` immer zur
 * Verfügung steht. Für ein Gespräch reicht „leer" aber nicht — im Postfach muss ein Name stehen,
 * also wird hier aufgelöst.
 */
async function resolveSender(
  sendAsUserId: string | null,
): Promise<{ id: string; username: string } | null> {
  const sender = await db
    .selectFrom("user")
    .select(["id", "username"])
    .$if(sendAsUserId !== null, (query) =>
      // deno-lint-ignore no-non-null-assertion -- das `$if` läuft nur, wenn er gesetzt ist
      query.where("id", "=", sendAsUserId!))
    .$if(
      sendAsUserId === null,
      (query) => query.where("isPrimordialAdmin", "=", true),
    )
    .executeTakeFirst();

  return sender ?? null;
}

/**
 * Legt die Rundmail als vollständige Nachricht in jedem Postfach ab.
 *
 * **Ein Gespräch je Empfänger, und darin sitzt nur das Mitglied.** Ohne Zeile in
 * `user_in_chat_group` taucht es beim Absender nirgends auf — weder beim Ur-Admin, in dessen
 * Postfach niemand sieht, noch bei einer Kunstfigur wie dem Weihnachtsmann. Den Namen trägt die
 * Nachricht trotzdem, weil `created_by` auf sein Konto zeigt. Das Team liest die Antworten über die
 * Rundmail, nicht über ein Postfach.
 *
 * Der Preis ist die Zahl: Hundert Mitglieder sind hundert Gespräche. Das ist der Preis dafür, dass
 * niemand die Antwort eines anderen sieht.
 *
 * **`joined` und nicht `invited`:** Eine Rundmail nimmt man nicht an. Eine Einladung, die erst
 * bestätigt werden müsste, wäre eine Hürde vor einer Mitteilung, die ohnehin schon ausgesprochen
 * ist.
 *
 * **`created_by` ist der Absender, nicht die schreibende Person.** Auch am Gespräch selbst — das ist
 * die Ecke, an die niemand denkt: Stünde dort der Mensch aus der Administration, wäre die Maske
 * über eine Spalte zu umgehen, die nie jemand ansieht.
 */
async function deliverToInbox(
  broadcastId: string,
  subject: string,
  body: string,
  sendAsUserId: string | null,
  recipientIds: string[],
): Promise<Delivered> {
  const sender = await resolveSender(sendAsUserId);
  const now = new Date().toISOString();

  return await db.transaction().execute(async (transaction) => {
    // **Die Empfänger werden hier noch einmal gelesen.**
    //
    // Zwischen dem Ermitteln des Empfängerkreises und dem Anlegen der Gespräche kann ein Konto
    // verschwinden — jemand löscht sich, oder die Moderation entfernt es. Die Mitgliedschaftszeile
    // liefe dann in ihren Fremdschlüssel, der ganze Versand bräche ab, und zwar **nachdem** die
    // Rundmail bereits als „raus" gebucht ist: Sie wäre für alle verloren, nicht nur für den einen.
    //
    // **Ohne `FOR SHARE`, obwohl das die dichtere Lösung wäre.** Die Sperre hielte jede Zeile bis
    // zum Ende der Transaktion und ließe jeden warten, der gerade ein Konto löscht — bei einer
    // Rundmail an alle sind das alle Konten der Plattform. Der Testlauf, der nebenher ständig
    // Konten anlegt und löscht, verklemmte sich daran prompt. Das Fenster ist stattdessen so klein
    // wie möglich gemacht, und `sendToInbox` wiederholt einmal, falls es doch jemanden erwischt.
    const present = await transaction
      .selectFrom("user")
      .select("id")
      .where("id", "in", recipientIds)
      .execute();

    // **Die Kennungen entstehen hier, nicht in der Datenbank.** Mitgliedschaft und Nachricht hängen
    // an ihnen, und sie aus einem `RETURNING` zurückzulesen hieße, sich auf eine Reihenfolge zu
    // verlassen, die PostgreSQL nirgends zusagt. Version 7, wie die Vorgabewerte der Tabellen: Die
    // Kennung trägt ihre Entstehungszeit, und darauf beruht die Sortierung der Nachrichten.
    const chats = present.map((recipient) => ({
      id: generateUuidV7(),
      messageId: generateUuidV7(),
      recipientId: recipient.id,
    }));

    if (chats.length === 0) {
      return { sender, chats: [], at: now };
    }

    await transaction
      .insertInto("chatGroup")
      .values(chats.map((chat) => ({
        id: chat.id,
        title: subject,
        createdBy: sender?.id ?? null,
        broadcastId,
      })))
      .execute();

    await transaction
      .insertInto("userInChatGroup")
      .values(chats.map((chat) => ({
        chatGroupId: chat.id,
        userId: chat.recipientId,
        status: "joined" as const,
        joinedAt: now,
      })))
      .execute();

    await transaction
      .insertInto("chatMessage")
      .values(chats.map((chat) => ({
        chatGroupId: chat.id,
        text: body,
        id: chat.messageId,
        createdBy: sender?.id ?? null,
        // Leer, obwohl es eine echte Verfasserin gibt: Die steht auf der Veröffentlichung, und
        // dieselbe Angabe zweimal zu führen heißt, sie irgendwann an einer Stelle zu vergessen.
        // Für Antworten der Administration ist die Spalte da — dort gibt es keine Veröffentlichung,
        // die sie tragen könnte.
        writtenBy: null,
      })))
      .execute();

    // **Die Meldung, wie bei jeder neuen PN.**
    //
    // Ein gewöhnliches Gespräch beginnt mit einer Einladung, und die meldet sich. Eine Rundmail
    // setzt das Mitglied direkt hinein und übersprang damit genau diese Meldung — wer nicht zufällig
    // ins Postfach sieht, erführe nie, dass eine Ankündigung da ist. Sie zeigt auf das Gespräch,
    // nicht auf die Rundmail: gelesen wird im Postfach, die Glocke weist nur hin.
    //
    // **`actorId` ist der Absender, außer bei ihm selbst.** `notification_actor_is_not_recipient`
    // verbietet, sich selbst zu benachrichtigen, und wer an alle schreibt, steht fast immer selbst
    // unter „alle" — genau seine Zeile würde umfallen und mit ihr die ganze Anweisung.
    await transaction
      .insertInto("notification")
      .values(chats.map((chat) => ({
        recipientId: chat.recipientId,
        type: "broadcast_received" as const,
        chatGroupId: chat.id,
        actorId: chat.recipientId === sender?.id ? null : sender?.id ?? null,
      })))
      .execute();

    // Zurückgegeben wird, was wirklich zugestellt wurde — nicht, was vorher gezählt worden war.
    return { sender, chats, at: now };
  });
}

/**
 * Stellt zu, und wenn dabei jemand verschwindet, noch einmal.
 *
 * **Ein zweiter Versuch statt einer Sperre.** Der einzige Grund, warum das Einfügen scheitern kann,
 * ist ein Konto, das zwischen Lesen und Schreiben gelöscht wurde — und beim zweiten Versuch ist es
 * schon beim Lesen weg. Ein dritter brächte deshalb nichts, was der zweite nicht gebracht hätte.
 *
 * Scheitert auch der, fliegt der Fehler weiter: Dann stimmt etwas anderes nicht, und eine Rundmail,
 * die stillschweigend bei niemandem ankommt, wäre das Schlechteste von allem.
 */
async function sendToInbox(
  broadcastId: string,
  subject: string,
  body: string,
  sendAsUserId: string | null,
  recipientIds: string[],
): Promise<number> {
  let delivered: Delivered;

  try {
    delivered = await deliverToInbox(
      broadcastId,
      subject,
      body,
      sendAsUserId,
      recipientIds,
    );
  } catch (failure) {
    console.warn("Retrying the inbox delivery of a broadcast", failure);

    delivered = await deliverToInbox(
      broadcastId,
      subject,
      body,
      sendAsUserId,
      recipientIds,
    );
  }

  // **Dieselbe Bahn, die jede gewöhnliche Nachricht nimmt** — und das war der Fehler: Die
  // Zustellung schrieb ihre Zeilen direkt in die Datenbank und sagte den offenen Fenstern nichts.
  // Wer die Seite offen hatte, als die Rundmail kam, behielt eine Chatliste ohne sie; die Glocke
  // führte dann auf ein Gespräch, das seine Liste nicht kannte, und der Dialog blieb leer.
  //
  // Nach dem Schreiben, nie darin: Ein Strom, der sich nicht beschreiben lässt, darf keine
  // Zustellung umwerfen, die längst gespeichert ist. Und ohne den Absender selbst — er sieht die
  // Rundmail dort, wo er sie geschrieben hat.
  for (const chat of delivered.chats) {
    if (chat.recipientId === delivered.sender?.id) {
      continue;
    }

    publishChatEvent([chat.recipientId], {
      chatGroupId: chat.id,
      message: {
        id: chat.messageId,
        text: body,
        createdAt: delivered.at,
        createdBy: delivered.sender?.id ?? null,
        createdByUsername: delivered.sender?.username ?? null,
      },
    });
  }

  return delivered.chats.length;
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
  sendAsUserId: string | null,
): Promise<BroadcastResult> {
  const recipients = await selectRecipients(audience);
  const byEmail = recipients.filter((recipient) =>
    mayReceiveEmail(recipient, audience)
  );

  const delivered = delivery.toInbox && recipients.length > 0
    ? await sendToInbox(
      broadcastId,
      subject,
      body,
      sendAsUserId,
      recipients.map((recipient) => recipient.id),
    )
    : 0;

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
    // Was zugestellt wurde, nicht was gezählt worden war: Wer sich zwischen beidem löscht, ist
    // kein Empfänger mehr, und die festgehaltene Zahl soll die Wirklichkeit beschreiben.
    inbox: delivered,
    email: delivery.byEmail ? byEmail.length : 0,
  };
}

export const BroadcastService = {
  countRecipients,
  send,
  publishInArchive,
};
