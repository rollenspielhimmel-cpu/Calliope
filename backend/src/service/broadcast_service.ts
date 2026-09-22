import { type Database, db, type Transaction } from "@/src/database/client.ts";
import { Mailer } from "@/src/mail/mailer.ts";
import { broadcastMail } from "@/src/mail/broadcast_mail.ts";
import { runInBackground } from "@/src/util/background.ts";
import { generate as generateUuidV7 } from "@std/uuid/v7";
import { AdminInboxService } from "@/src/service/admin_inbox_service.ts";
import { BroadcastSenderService } from "@/src/service/broadcast_sender_service.ts";
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
export type BroadcastRole = "administrator" | "moderator" | "member";

/** Alle drei Rollen zusammen — das ist „an alle Mitglieder". */
export const EVERYONE: ReadonlyArray<BroadcastRole> = [
  "administrator",
  "moderator",
  "member",
];

/**
 * Geht sie an alle? Alle drei Rollen und **kein** Name.
 *
 * Namen neben allen Rollen fügen niemanden hinzu, und die Oberfläche lässt sie dann gar nicht zu.
 * Verlangt wird es trotzdem, damit die Regel ohne die Oberfläche dasselbe sagt wie mit ihr — und
 * dasselbe wie `broadcast_archive_only_to_everyone` in der Datenbank.
 */
export function isToEveryone(
  roles: ReadonlyArray<string>,
  memberIds: ReadonlyArray<string>,
): boolean {
  return EVERYONE.every((role) => roles.includes(role)) &&
    memberIds.length === 0;
}

export type BroadcastAudience = {
  roles: BroadcastRole[];
  /**
   * Ausdrücklich genannte Konten, zusätzlich zu den Rollen.
   *
   * **Die Vereinigung, nicht das eine oder das andere.** Wer die Moderation wählt und zusätzlich
   * zwei Namen nennt, erreicht beide; wer nur Namen nennt, erreicht nur die. Doppelt bekommt
   * niemand etwas — das entscheidet `selectRecipients`.
   */
  memberIds: string[];
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
 * Wer die Abfrage ausführt: die Verbindung selbst oder eine offene Transaktion.
 *
 * **Weil die Zustellung inzwischen in der Transaktion der Freigabe läuft** und das Zählen davor
 * nicht. Dieselbe Abfrage bedient beide; sie auf `db` festzunageln hieße, aus der Transaktion
 * heraus an ihr vorbeizulesen.
 */
type Executor = Database | Transaction;

/**
 * Was der Versand zurückgibt: die Reichweite, und das, was erst **nach** dem Festschreiben laufen
 * darf.
 *
 * **Weil nicht alles zurückzunehmen ist.** Die Postfachzeilen stehen in derselben Transaktion wie
 * die Freigabe und fallen mit ihr; ein abgeschickter Strom-Anstoß und eine übergebene E-Mail
 * fallen nicht. Beides vor dem Festschreiben zu tun hieße, offenen Fenstern eine Nachricht zu
 * zeigen, die es nach einem Rückzieher nicht gibt, und Mails zu einer Rundmail zu verschicken, die
 * danach wieder als unversendet dasteht und ein zweites Mal rausginge.
 *
 * Also sammelt der Versand es ein und gibt es dem Aufrufer in die Hand, der weiß, wann die
 * Transaktion durch ist.
 */
export type BroadcastDispatch = {
  reach: BroadcastReach;
  /** Erst aufrufen, wenn die Transaktion festgeschrieben ist. */
  announce: () => void;
};

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
async function selectRecipients(
  executor: Executor,
  audience: BroadcastAudience,
) {
  const roles = audience.roles.filter((role) => role !== "member");
  const includeOrdinaryMembers = audience.roles.includes("member");

  return await executor
    .selectFrom("user")
    .select(["id", "emailAddress", "emailAddressVerifiedAt"])
    .where("bannedAt", "is", null)
    // **Rollen und Namen zusammen, mit `or` statt zweier Abfragen.** Die Vereinigung entsteht
    // dadurch in der Datenbank, und wer über eine Rolle *und* namentlich drinsteht, kommt trotzdem
    // nur einmal vor — eine Zeile ist eine Zeile.
    .where((eb) =>
      eb.or([
        // `platform_role` is null for an ordinary member, so the two halves cannot be one `in`.
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
        ...(audience.memberIds.length > 0
          ? [eb("id", "in", audience.memberIds)]
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
  const recipients = await selectRecipients(db, audience);

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
  transaction: Transaction,
  subject: string,
  body: string,
  sendAsUserId: string | null,
): Promise<string | null> {
  const thread = await transaction
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
  const sender = await resolveSender(transaction, sendAsUserId);
  const document = documentOf(subject, body);

  const post = await transaction
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
  executor: Executor,
  sendAsUserId: string | null,
): Promise<{ id: string; username: string } | null> {
  const sender = await executor
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
  transaction: Transaction,
  broadcastId: string,
  subject: string,
  body: string,
  sendAsUserId: string | null,
  recipientIds: string[],
): Promise<Delivered> {
  const sender = await resolveSender(transaction, sendAsUserId);
  const now = new Date().toISOString();

  // **Die Empfänger werden hier noch einmal gelesen, und diesmal festgehalten.**
  //
  // Zwischen dem Ermitteln des Empfängerkreises und dem Anlegen der Gespräche kann ein Konto
  // verschwinden — jemand löscht sich, oder die Moderation entfernt es. Die Zeile liefe dann in
  // ihren Fremdschlüssel, und **die ganze Rundmail bräche ab**, nicht nur die eine Zustellung.
  //
  // **`FOR KEY SHARE`, und das ist nicht dasselbe wie `FOR SHARE`.** Hier stand einmal die
  // Begründung, gar nicht zu sperren: Eine Sperre ließe jeden warten, der ein Konto anfasst, und
  // bei einer Rundmail an alle sind das alle Konten der Plattform — der Testlauf, der nebenher
  // ständig Konten anlegt und löscht, verklemmte sich daran prompt. Das stimmt für `FOR SHARE`.
  // `FOR KEY SHARE` ist die schwächste Sperre, die es gibt: Sie steht **nur** dem Löschen und dem
  // Ändern des Schlüssels im Weg, nicht dem gewöhnlichen Bearbeiten. Wer während einer Zustellung
  // seinen Namen ändert, merkt nichts; wer sein Konto löscht, wartet Millisekunden.
  //
  // Es ist genau die Sperre, die der Fremdschlüssel beim Einfügen ohnehin nimmt — nur eben schon
  // hier, wo noch entschieden werden kann, statt erst dort, wo es nur noch krachen kann.
  //
  // **Der zweite Versuch in `release` war dafür zu wenig.** Er unterstellt, dass beim zweiten Mal
  // dasselbe Konto schon beim Lesen fehlt. Bei einer Rundmail an Hunderte kann beim zweiten Anlauf
  // aber ein *anderes* verschwinden, und dann fällt sie wieder um. Er bleibt als Netz für alles
  // Übrige, aber diesen Fall fängt er nicht mehr, weil es ihn nicht mehr gibt.
  const present = await transaction
    .selectFrom("user")
    .select("id")
    .where("id", "in", recipientIds)
    .forKeyShare()
    .execute();

  if (present.length === 0) {
    return { sender, chats: [], at: now };
  }

  const recipientsPresent = present.map((recipient) => recipient.id);

  // **Gefunden statt angelegt, wo es den Faden schon gibt** — und durch dieselbe Funktion, die
  // auch ein Mitglied benutzt, das die Administration von sich aus anschreibt. Beide meinen
  // denselben Faden; zwei Fassungen davon wären zwei, die auseinanderlaufen.
  const chatByRecipient = await AdminInboxService.findOrCreateThreads(
    transaction,
    sender,
    recipientsPresent,
  );

  const chats = recipientsPresent.flatMap((recipientId) => {
    const id = chatByRecipient.get(recipientId);
    return id === undefined
      ? []
      : [{ id, messageId: generateUuidV7(), recipientId }];
  });

  await transaction
    .insertInto("chatMessage")
    .values(chats.map((chat) => ({
      chatGroupId: chat.id,
      text: body,
      id: chat.messageId,
      createdBy: sender?.id ?? null,
      // Die Rundmail hängt jetzt an der Nachricht: Ein Faden trägt viele Ankündigungen, und
      // „welche Nachricht ist eine" muss ohne die brüchige Regel „die erste im Gespräch"
      // beantwortbar sein.
      broadcastId,
      subject,
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
}

/**
 * Stellt zu und sammelt ein, was danach noch zu tun ist.
 *
 * **In der Transaktion des Aufrufers, nicht in einer eigenen.** Freigabe und Zustellung gehören
 * zusammen: Eine Rundmail, die als „raus" gebucht ist und in keinem Postfach steht, ist still
 * verloren, und niemand merkt es — weder der, der sie geschrieben hat, noch der, der sie bekommen
 * sollte. Fällt hier etwas um, fällt die Freigabe mit um, die Rundmail steht wieder auf
 * `approved`, und der Taktgeber holt sie im nächsten Takt.
 *
 * **Kein zweiter Versuch mehr an dieser Stelle.** Eine Anweisung, die scheitert, bricht die ganze
 * Transaktion ab; hier weiterzumachen ginge gar nicht. Der zweite Versuch liegt jetzt eine Ebene
 * höher, um die ganze Transaktion herum — und zwar sauberer als vorher, weil der erste Versuch
 * dann wirklich nichts hinterlassen hat.
 *
 * **Die Mails und die Strom-Anstöße bleiben draußen.** Beides ist nicht zurückzunehmen: Ein
 * Browser, dem eine Nachricht angekündigt wurde, die es nach dem Rückzieher nicht gibt, zeigt eine
 * Lücke; eine Mail, die raus ist, während die Rundmail wieder als unversendet dasteht, kommt beim
 * nächsten Takt ein zweites Mal. Deshalb kommen sie als `announce` zurück, statt hier zu laufen.
 */
async function send(
  transaction: Transaction,
  broadcastId: string,
  audience: BroadcastAudience,
  delivery: BroadcastDelivery,
  subject: string,
  body: string,
  sendAsUserId: string | null,
): Promise<BroadcastDispatch> {
  const recipients = await selectRecipients(transaction, audience);
  const byEmail = recipients.filter((recipient) =>
    mayReceiveEmail(recipient, audience)
  );

  const delivered: Delivered = delivery.toInbox && recipients.length > 0
    ? await deliverToInbox(
      transaction,
      broadcastId,
      subject,
      body,
      sendAsUserId,
      recipients.map((recipient) => recipient.id),
    )
    : { sender: null, chats: [], at: new Date().toISOString() };

  return {
    reach: {
      // Was zugestellt wurde, nicht was gezählt worden war: Wer sich zwischen beidem löscht, ist
      // kein Empfänger mehr, und die festgehaltene Zahl soll die Wirklichkeit beschreiben.
      inbox: delivered.chats.length,
      email: delivery.byEmail ? byEmail.length : 0,
    },
    announce: () => {
      // **Dieselbe Bahn, die jede gewöhnliche Nachricht nimmt** — und das war der Fehler: Die
      // Zustellung schrieb ihre Zeilen direkt in die Datenbank und sagte den offenen Fenstern
      // nichts. Wer die Seite offen hatte, als die Rundmail kam, behielt eine Chatliste ohne sie;
      // die Glocke führte dann auf ein Gespräch, das seine Liste nicht kannte, und der Dialog blieb
      // leer.
      //
      // Ohne den Absender selbst — er sieht die Rundmail dort, wo er sie geschrieben hat.
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

      // One message per recipient rather than one with everybody in bcc: a relay that rejects the
      // batch loses all of it, and one address visible to the rest would be a real disclosure.
      //
      // Im Hintergrund, weil kein Aufrufer darauf warten darf — siehe AGENTS.md: Bei Hunderten
      // Adressen bliebe die Anfrage so lange offen, wie das Relais für alle zusammen braucht.
      //
      // **Das Relais kennt keine Transaktion.** Eine übergebene Mail ist draußen, und keine
      // Datenbank holt sie zurück. Die Zusage „was als versendet gilt, ist zugestellt" reicht
      // deshalb genau so weit wie die Datenbank: Postfach und Archiv stehen darin, der Mailweg
      // nicht. Er läuft erst, wenn das Übrige festgeschrieben ist, damit wenigstens nie eine Mail
      // zu einer Rundmail hinausgeht, die danach wieder als unversendet dasteht.
      if (!delivery.byEmail) {
        return;
      }

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
    },
  };
}

/** Was vor dem Text einer Test-Rundmail steht, im Postfach wie in der Mail. */
export const TEST_MARK = "— TEST-Rundmail —";

/** Was eine Test-Rundmail braucht: der Inhalt, wie er rausginge — ein Empfänger kommt nicht vor. */
export type TestBroadcast = {
  subject: string;
  body: string;
  sendAsUserId: string | null;
  deliverByEmail: boolean;
};

export type TestOutcome =
  | "sender_not_released"
  | {
    chatGroupId: string;
    /**
     * Ob die Mail an die eigene Adresse rausging. Eine unbestätigte Adresse kommt dabei nicht vor:
     * Ein Konto ohne bestätigte Adresse kommt an keine Route heran (`authenticated`), also auch an
     * diese nicht.
     */
    email: "sent" | "not_chosen";
  };

/**
 * Eine Test-Rundmail: so, wie sie ankommen wird, aber **nur bei der Person, die testet**.
 *
 * **Der Empfänger steht nicht im Aufruf.** Die Route reicht den Inhalt durch und die angemeldete
 * Person — mehr nicht. Damit ist „nie an andere" keine Prüfung, die jemand vergessen kann, sondern
 * eine Frage, die sich gar nicht stellt.
 *
 * **In einem eigenen Faden, nicht im echten.** Der echte Faden zwischen dieser Person und dem
 * Absender steht im Postfach der Administration, alle Admins lesen seinen Verlauf, und eine
 * Nachricht dort würde eine offene Frage derselben Person still schließen. Der Test-Faden ist
 * gekennzeichnet (`is_test_broadcast`) und nur für sie da.
 *
 * **Sonst wie der Ernstfall:** derselbe aufgelöste Absender, derselbe Betreff, dieselbe Glocke,
 * dieselbe Mail-Vorlage — nur mit `TEST_MARK` davor und „[TEST]" im Betreff der Mail. Keine
 * Veröffentlichung, keine Freigabe, keine Empfängerzahl, kein Archiv.
 *
 * Der Absender wird geprüft wie bei einer echten Rundmail. Sonst ließe sich über den Test ausprobieren,
 * wie eine Nachricht unter einem beliebigen Namen aussähe.
 */
async function sendTest(
  tester: { id: string; emailAddress: string },
  input: TestBroadcast,
): Promise<TestOutcome> {
  if (!await BroadcastSenderService.mayBeSender(input.sendAsUserId)) {
    return "sender_not_released";
  }

  const text = `${TEST_MARK}\n\n${input.body}`;
  const now = new Date().toISOString();
  const messageId = generateUuidV7();

  const delivered = await db.transaction().execute(async (transaction) => {
    const sender = await resolveSender(transaction, input.sendAsUserId);

    // Gefunden statt angelegt, wo es ihn schon gibt — dieselbe Form wie `findOrCreateThreads`:
    // erst einfügen und den Konflikt übergehen, dann nachlesen, unter welcher Kennung er steht.
    // Zweimal schnell hintereinander gedrückt, legte ein Nachsehen-dann-Anlegen sonst zwei an.
    const created = await transaction
      .insertInto("chatGroup")
      .values({
        title: sender?.username ?? "Administration",
        createdBy: sender?.id ?? null,
        administrationPartnerId: tester.id,
        isTestBroadcast: true,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["administrationPartnerId", "createdBy"])
          .where("isTestBroadcast", "=", true)
          .where("administrationPartnerId", "is not", null)
          .doNothing()
      )
      .returning("id")
      .executeTakeFirst();

    const thread = created ?? await transaction
      .selectFrom("chatGroup")
      .select("id")
      .where("isTestBroadcast", "=", true)
      .where("administrationPartnerId", "=", tester.id)
      // Ohne Absender — das dauerhafte Konto ist gerade niemand — gibt es keinen Faden zu teilen,
      // und `= null` träfe ohnehin nichts.
      .$if(sender !== null, (query) =>
        // deno-lint-ignore no-non-null-assertion -- das `$if` läuft nur, wenn er gesetzt ist
        query.where("createdBy", "=", sender!.id))
      .executeTakeFirstOrThrow();

    // `joined` wie bei der echten Rundmail: Man nimmt sie nicht an. Und doNothing, weil die
    // Person im wiederverwendeten Faden schon sitzt.
    await transaction
      .insertInto("userInChatGroup")
      .values({ chatGroupId: thread.id, userId: tester.id, status: "joined" })
      .onConflict((conflict) => conflict.doNothing())
      .execute();

    await transaction
      .insertInto("chatMessage")
      .values({
        id: messageId,
        chatGroupId: thread.id,
        text,
        subject: input.subject,
        createdBy: sender?.id ?? null,
        // Keine Rundmail-Kennung: Es gibt keine Rundmail, nur ihren Inhalt.
        broadcastId: null,
        writtenBy: null,
      })
      .execute();

    // Die Glocke, wie bei der echten — sie gehört zu dem, was man sehen will. Ohne Absender als
    // Auslöser, wenn man sich selbst testet: `notification_actor_is_not_recipient`.
    await transaction
      .insertInto("notification")
      .values({
        recipientId: tester.id,
        type: "broadcast_received",
        chatGroupId: thread.id,
        actorId: sender?.id === tester.id ? null : sender?.id ?? null,
      })
      .execute();

    return { chatGroupId: thread.id, sender };
  });

  // Nach dem Festschreiben, wie bei der echten: Ein offenes Fenster erfährt es, sobald es stimmt.
  // Anders als dort auch dann, wenn die Person sich selbst als Absender testet — sie will es sehen.
  publishChatEvent([tester.id], {
    chatGroupId: delivered.chatGroupId,
    message: {
      id: messageId,
      text,
      createdAt: now,
      createdBy: delivered.sender?.id ?? null,
      createdByUsername: delivered.sender?.username ?? null,
    },
  });

  if (!input.deliverByEmail) {
    return { chatGroupId: delivered.chatGroupId, email: "not_chosen" };
  }

  Mailer.sendInBackground(
    broadcastMail({
      emailAddress: tester.emailAddress,
      subject: `[TEST] ${input.subject}`,
      body: text,
    }),
  );

  return { chatGroupId: delivered.chatGroupId, email: "sent" };
}

export const BroadcastService = {
  countRecipients,
  send,
  sendTest,
  publishInArchive,
};
