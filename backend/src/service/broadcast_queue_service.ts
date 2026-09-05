import { sql } from "kysely";
import { db } from "@/src/database/client.ts";
import type { PublicationStatus } from "@/src/database/schema.ts";
import type { User } from "@/src/service/user_service.ts";
import { BroadcastSenderService } from "@/src/service/broadcast_sender_service.ts";
import {
  type BroadcastAudience,
  type BroadcastDelivery,
  type BroadcastGroup,
  BroadcastService,
} from "@/src/service/broadcast_service.ts";

/**
 * Rundmails, die auf eine Freigabe warten — und was danach mit ihnen geschieht.
 *
 * **Warum es die Warteschlange gibt:** Eine Rundmail geht an alle und ist nicht zurückzuholen, und
 * sie erscheint unter einem Absender, der nicht die Person ist, die sie geschrieben hat. Wer im
 * Namen eines anderen an alle schreibt, kann Schaden anrichten, der ihm nicht zugeschrieben wird.
 * Zwei Augenpaare sind die einzige Sicherung, die davor greift — jede spätere ist eine Entschuldigung.
 *
 * **Wer freigibt:** jede Administration, keine Moderation. Aber **nicht die eigene Einreichung**.
 * Das steht so nicht in der Anforderung und ist eine Folgerung: Dass der Ur-Admin ausdrücklich
 * keine Freigabe braucht, ergibt nur dann einen Sinn, wenn alle anderen eine von *jemand anderem*
 * brauchen. Dürfte jeder sich selbst freigeben, wäre die Ausnahme keine und die Warteschlange
 * Theater. Eine Zeile, falls das anders gemeint war.
 *
 * **Der Ur-Admin gibt mit dem Schreiben frei.** Auch dort werden `approved_by` und `approved_at`
 * gesetzt, statt sie leer zu lassen: Die Spalte soll immer sagen, wer es verantwortet, und ein
 * Sonderfall mit leeren Feldern wäre eine Lücke in genau der Spur, für die es sie gibt.
 *
 * **Jede Bearbeitung setzt die Freigabe zurück** — Text, Betreff, Empfängerkreis und Absender
 * gleichermaßen. Sonst lässt man Harmloses absegnen und tauscht danach den Empfängerkreis, was
 * dasselbe ist wie einen anderen Text zu senden.
 *
 * **Freigabe und Versand sind zwei Dinge.** Ohne Termin fallen sie zusammen: freigeben heißt
 * senden. Mit Termin ist die Freigabe erteilt und die Uhr eine zweite Bedingung — `releaseDue`
 * sammelt ein, was beides erfüllt. Der Termin allein sendet nie: Was niemand freigegeben hat,
 * geht auch dann nicht raus, wenn der Zeitpunkt verstreicht.
 */

export type BroadcastInput = {
  subject: string;
  body: string;
  audienceGroups: BroadcastGroup[];
  includeUnverified: boolean;
  /** Null heißt: unter dem Ur-Admin-Konto, das dauerhaft zur Verfügung steht. */
  sendAsUserId: string | null;
  /**
   * Die drei Wege, einzeln zu haben.
   *
   * Ins Postfach auf der Plattform, per E-Mail, ins Forum-Archiv — jede Kombination ist erlaubt
   * außer keiner, und dafür sorgt `broadcast_arrives_somewhere` in der Datenbank. Die Aufteilung
   * ist der Punkt: Eine Ankündigung an alle will man oft auch per Mail, eine Notiz an die
   * Administration nicht, und ein Hinweis fürs Nachlesen soll niemanden anstupsen.
   */
  deliverToInbox: boolean;
  deliverByEmail: boolean;
  publishInArchive: boolean;
  /**
   * Wann sie frühestens rausgeht, oder null für „sobald freigegeben".
   *
   * In UTC wie alles hier. Dass die Oberfläche nach Europe/Berlin rechnet, ist ihre Sache — „morgen
   * um 20 Uhr" ist das, was jemand meint, der es eintippt, und nicht das, was in der Spalte steht.
   *
   * **Der Termin allein sendet nichts.** Er ist ein Frühestens, kein Auslöser: Was nicht
   * freigegeben ist, geht auch dann nicht raus, wenn der Zeitpunkt verstreicht.
   */
  scheduledFor: string | null;
};

export type QueuedBroadcast = BroadcastInput & {
  publicationId: string;
  status: PublicationStatus;
  /** Nach außen: unter welchem Namen sie erscheint. */
  sendAsUsername: string | null;
  /** Intern: wer sie verfasst hat, auch wenn außen jemand anderes draufsteht. */
  writtenByUsername: string | null;
  writtenAt: string;
  approvedByUsername: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  /** Wie viele es ins Postfach bekommen haben, oder null, wenn dieser Weg nicht gewählt war. */
  recipientCount: number | null;
  /** Wie viele eine Mail bekommen haben. Weniger, wenn Adressen unbestätigt sind. */
  emailRecipientCount: number | null;
  /** Gesetzt, sobald sie im Archiv steht — die Oberfläche verlinkt darauf. */
  archivePostId: string | null;
};

function audienceOf(broadcast: BroadcastInput): BroadcastAudience {
  return {
    groups: broadcast.audienceGroups,
    includeUnverified: broadcast.includeUnverified,
  };
}

function deliveryOf(broadcast: BroadcastInput): BroadcastDelivery {
  return {
    toInbox: broadcast.deliverToInbox,
    byEmail: broadcast.deliverByEmail,
    toArchive: broadcast.publishInArchive,
  };
}

/** Eine Zeile der Liste, mit beiden echten Namen und dem Absender daneben. */
function rows() {
  return db
    .selectFrom("publication")
    .innerJoin("broadcast", "broadcast.publicationId", "publication.id")
    .leftJoin(
      "user as sender",
      "sender.id",
      "publication.sendAsUserId",
    )
    .leftJoin("user as author", "author.id", "publication.writtenBy")
    .leftJoin("user as approver", "approver.id", "publication.approvedBy")
    .select([
      "publication.id as publicationId",
      "publication.status",
      "publication.sendAsUserId",
      "publication.scheduledFor",
      "sender.username as sendAsUsername",
      "author.username as writtenByUsername",
      "publication.writtenAt",
      "approver.username as approvedByUsername",
      "publication.approvedAt",
      "publication.releasedAt",
      "broadcast.id as broadcastId",
      "broadcast.subject",
      "broadcast.body",
      "broadcast.audienceGroups",
      "broadcast.includeUnverified",
      "broadcast.deliverToInbox",
      "broadcast.deliverByEmail",
      "broadcast.publishInArchive",
      "broadcast.archivePostId",
      "broadcast.recipientCount",
      "broadcast.emailRecipientCount",
    ])
    .where("publication.kind", "=", "broadcast");
}

function toQueued(row: {
  publicationId: string;
  status: PublicationStatus;
  sendAsUserId: string | null;
  scheduledFor: string | null;
  sendAsUsername: string | null;
  writtenByUsername: string | null;
  writtenAt: string;
  approvedByUsername: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  broadcastId: string;
  subject: string;
  body: string;
  audienceGroups: string[];
  includeUnverified: boolean;
  deliverToInbox: boolean;
  deliverByEmail: boolean;
  publishInArchive: boolean;
  archivePostId: string | null;
  recipientCount: number | null;
  emailRecipientCount: number | null;
}): QueuedBroadcast {
  return {
    ...row,
    // Die Spalte ist `TEXT[]`, weil die Datenbank den Empfängerbegriff nicht kennt. Die Werte
    // stammen aus dem geprüften Anfragekörper, also ist die Einschränkung hier eine Behauptung
    // über bereits Geprüftes und kein Vertrauen in die Datenbank.
    audienceGroups: row.audienceGroups as BroadcastGroup[],
  };
}

export type SubmitRefusal = "sender_not_released";

/**
 * Schreibt eine Rundmail in die Warteschlange.
 *
 * Vom Ur-Admin kommt sie freigegeben heraus und geht sofort raus; von allen anderen wartet sie.
 *
 * **Der Absender wird hier geprüft, nicht nur im Formular.** Die Liste dort schlägt vor; sie
 * hindert niemanden daran, eine andere Kennung zu schicken — und ohne diese Prüfung könnte jede
 * Administration unter dem Namen eines beliebigen Mitglieds an alle schreiben.
 */
async function submit(
  author: User,
  input: BroadcastInput,
): Promise<QueuedBroadcast | SubmitRefusal> {
  if (!await BroadcastSenderService.mayBeSender(input.sendAsUserId)) {
    return "sender_not_released";
  }

  const now = new Date().toISOString();
  const givesOwnApproval = author.isPrimordialAdmin;

  const publicationId = await db.transaction().execute(async (transaction) => {
    const publication = await transaction
      .insertInto("publication")
      .values({
        kind: "broadcast",
        status: givesOwnApproval ? "approved" : "awaiting_approval",
        sendAsUserId: input.sendAsUserId,
        scheduledFor: input.scheduledFor,
        writtenBy: author.id,
        writtenAt: now,
        approvedBy: givesOwnApproval ? author.id : null,
        approvedAt: givesOwnApproval ? now : null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await transaction
      .insertInto("broadcast")
      .values({
        publicationId: publication.id,
        subject: input.subject,
        body: input.body,
        audienceGroups: input.audienceGroups,
        includeUnverified: input.includeUnverified,
        deliverToInbox: input.deliverToInbox,
        deliverByEmail: input.deliverByEmail,
        publishInArchive: input.publishInArchive,
      })
      .execute();

    return publication.id;
  });

  // Freigegeben und ohne Termin heißt: jetzt. Mit Termin wartet sie auf den Taktgeber, auch beim
  // Ur-Admin — die Freigabe ist erteilt, die Uhr ist eine zweite Bedingung.
  if (givesOwnApproval && input.scheduledFor === null) {
    await release(publicationId, input);
  }

  return await selectOneOrThrow(publicationId);
}

/**
 * Verschickt und hält fest, an wie viele.
 *
 * **Erst den Zustand nehmen, dann senden** — nicht umgekehrt. Seit der Taktgeber danebensteht,
 * können zwei Wege gleichzeitig dieselbe Rundmail freigeben wollen: die Freigabe von Hand und der
 * Lauf, der Fälliges einsammelt. Das `WHERE status = 'approved'` ist die Stelle, an der genau einer
 * gewinnt; wer keine Zeile trifft, sendet nicht. Andersherum — senden und dann buchen — hätten
 * beide gesendet und beide gebucht, und Hunderte Leute hätten die Mail zweimal.
 *
 * Der Preis ist der andere Fehlerfall: Bricht der Versand nach dem Buchen ab, steht `released` da,
 * ohne dass alles draußen ist. Das ist die bessere Hälfte des Tauschs — eine Mail, die einmal zu
 * wenig ankommt, ist ein Ärgernis; eine, die zweimal ankommt, ist ein Vertrauensschaden.
 *
 * Die Empfängerzahl wird beim Versand festgehalten und nicht später gezählt: Wer die Liste
 * hinterher neu abfragt, zählt die Mitglieder von heute und nicht die, die sie bekommen haben.
 */
async function release(
  publicationId: string,
  input: BroadcastInput,
): Promise<boolean> {
  const claimed = await db
    .updateTable("publication")
    .set({ status: "released", releasedAt: new Date().toISOString() })
    .where("id", "=", publicationId)
    .where("status", "=", "approved")
    .returning("id")
    .executeTakeFirst();

  if (claimed === undefined) {
    return false;
  }

  const broadcast = await db
    .selectFrom("broadcast")
    .select("id")
    .where("publicationId", "=", publicationId)
    .executeTakeFirstOrThrow();

  const delivery = deliveryOf(input);

  // **Zuerst ins Archiv, dann zustellen.** Die Postfachzeile und die Mail zeigen auf den Beitrag im
  // Forum; gäbe es ihn beim Zustellen noch nicht, verwiese die Benachrichtigung für einen Moment
  // ins Leere. Andersherum kostet es nichts.
  const archivePostId = delivery.toArchive
    ? await BroadcastService.publishInArchive(
      input.subject,
      input.body,
      publicationId,
      input.sendAsUserId,
    )
    : null;

  const reach = await BroadcastService.send(
    broadcast.id,
    audienceOf(input),
    delivery,
    input.subject,
    input.body,
  );

  await db
    .updateTable("broadcast")
    .set({
      recipientCount: delivery.toInbox ? reach.inbox : null,
      emailRecipientCount: delivery.byEmail ? reach.email : null,
      archivePostId,
    })
    .where("publicationId", "=", publicationId)
    .execute();

  return true;
}

/**
 * Was fällig ist, geht raus. Der Taktgeber ruft das jede Minute.
 *
 * Freigegeben **und** Termin erreicht — oder freigegeben ohne Termin, was „sobald freigegeben"
 * heißt. Der zweite Fall geht normalerweise schon bei der Freigabe selbst raus; er steht hier als
 * Netz darunter, für den Fall, dass jener Weg abgebrochen ist. Zweimal senden kann das nicht,
 * dafür sorgt `release`.
 *
 * Nach der Uhr der Datenbank, nicht nach der dieses Prozesses: Bei zwei Servern wäre sonst der
 * Termin zweierlei, und `scheduled_for` steht ohnehin in derselben Datenbank.
 */
async function releaseDue(): Promise<number> {
  const due = await rows()
    .where("publication.status", "=", "approved")
    .where((eb) =>
      eb.or([
        eb("publication.scheduledFor", "is", null),
        eb("publication.scheduledFor", "<=", sql<string>`now()`),
      ])
    )
    .orderBy("publication.scheduledFor", "asc")
    .execute();

  let sent = 0;

  // Nacheinander mit Absicht: Jede Rundmail ist Hunderte Zustellungen, und alle Fälligen
  // gleichzeitig loszuschicken hieße, den Mailserver mit dem ersten Takt der Stunde zu überfahren.
  for (const row of due) {
    // deno-lint-ignore no-await-in-loop -- siehe darüber
    if (await release(row.publicationId, toQueued(row))) {
      sent++;
    }
  }

  return sent;
}

export type ApprovalRefusal =
  | "not_found"
  | "not_waiting"
  | "own_submission";

/**
 * Gibt frei und sendet sofort.
 *
 * Ein Zustand, der nicht `awaiting_approval` ist, wird abgelehnt statt still übergangen: Zweimal
 * freigeben hieße zweimal senden, und „schon erledigt" ist eine Antwort, die jemand lesen soll.
 */
async function approve(
  publicationId: string,
  approver: User,
): Promise<ApprovalRefusal | undefined> {
  const waiting = await selectOne(publicationId);

  if (waiting === undefined) {
    return "not_found";
  }

  if (waiting.status !== "awaiting_approval") {
    return "not_waiting";
  }

  const author = await db
    .selectFrom("publication")
    .select("writtenBy")
    .where("id", "=", publicationId)
    .executeTakeFirst();

  if (author?.writtenBy === approver.id) {
    return "own_submission";
  }

  await db
    .updateTable("publication")
    .set({
      status: "approved",
      approvedBy: approver.id,
      approvedAt: new Date().toISOString(),
    })
    .where("id", "=", publicationId)
    .where("status", "=", "awaiting_approval")
    .execute();

  // Ohne Termin geht sie sofort raus; mit Termin ist die Freigabe erteilt und der Taktgeber holt
  // sie ab, sobald die Uhr so weit ist. Deshalb heißt der Knopf auch nicht mehr nur „senden".
  if (waiting.scheduledFor === null) {
    await release(publicationId, waiting);
  }

  return undefined;
}

export type EditRefusal =
  | "not_found"
  | "already_out"
  | "sender_not_released";

/**
 * Ändert eine wartende oder freigegebene Rundmail — und nimmt ihr damit die Freigabe.
 *
 * Was schon draußen ist, lässt sich nicht mehr ändern: Die Mail ist verschickt, und eine Zeile in
 * der Datenbank zu korrigieren würde nur den Beleg von dem entfernen, was tatsächlich ankam.
 */
async function edit(
  publicationId: string,
  input: BroadcastInput,
): Promise<EditRefusal | undefined> {
  const existing = await selectOne(publicationId);

  if (existing === undefined) {
    return "not_found";
  }

  if (existing.status === "released") {
    return "already_out";
  }

  if (!await BroadcastSenderService.mayBeSender(input.sendAsUserId)) {
    return "sender_not_released";
  }

  await db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("publication")
      .set({
        status: "awaiting_approval",
        approvedBy: null,
        approvedAt: null,
        sendAsUserId: input.sendAsUserId,
        scheduledFor: input.scheduledFor,
      })
      .where("id", "=", publicationId)
      .execute();

    await transaction
      .updateTable("broadcast")
      .set({
        subject: input.subject,
        body: input.body,
        audienceGroups: input.audienceGroups,
        includeUnverified: input.includeUnverified,
        deliverToInbox: input.deliverToInbox,
        deliverByEmail: input.deliverByEmail,
        publishInArchive: input.publishInArchive,
        updatedAt: new Date().toISOString(),
      })
      .where("publicationId", "=", publicationId)
      .execute();
  });

  return undefined;
}

/**
 * Verworfen, nicht gelöscht: Was eingereicht wurde, bleibt als Spur stehen.
 *
 * Ein eigener Ablehnungstyp statt `EditRefusal`: Verwerfen kennt keinen Absender und kann an ihm
 * deshalb auch nicht scheitern. Beide denselben Typ teilen zu lassen hieße, im Aufrufer einen Fall
 * zu behandeln, den es nicht gibt.
 */
export type DiscardRefusal = "not_found" | "already_out";

async function discard(
  publicationId: string,
): Promise<DiscardRefusal | undefined> {
  const existing = await selectOne(publicationId);

  if (existing === undefined) {
    return "not_found";
  }

  if (existing.status === "released") {
    return "already_out";
  }

  await db
    .updateTable("publication")
    .set({ status: "discarded" })
    .where("id", "=", publicationId)
    .execute();

  return undefined;
}

async function selectOne(
  publicationId: string,
): Promise<QueuedBroadcast | undefined> {
  const row = await rows()
    .where("publication.id", "=", publicationId)
    .executeTakeFirst();

  return row === undefined ? undefined : toQueued(row);
}

async function selectOneOrThrow(
  publicationId: string,
): Promise<QueuedBroadcast> {
  const one = await selectOne(publicationId);

  if (one === undefined) {
    throw new Error(
      `Publication ${publicationId} vanished after being written`,
    );
  }

  return one;
}

/**
 * Was noch nicht draußen ist: was auf eine Freigabe wartet, **und was auf die Uhr wartet**.
 *
 * Die zweite Hälfte kam dazu, als der Termin dazukam. Ohne sie wäre eine freigegebene, terminierte
 * Rundmail bis zum Versand in keiner Liste zu sehen — nicht hier, weil sie freigegeben ist, und
 * nicht unter „Gesendete", weil sie noch nicht raus ist. Etwas, das an alle geht und nirgends
 * steht, ist genau das, was man vor dem Absenden noch einmal sehen können will.
 *
 * Die rote Zahl zählt trotzdem nur die wartenden: Was freigegeben ist, wartet auf niemanden.
 *
 * Die ältesten zuerst, damit nichts unten liegen bleibt.
 */
async function listWaiting(): Promise<QueuedBroadcast[]> {
  const found = await rows()
    .where("publication.status", "in", ["awaiting_approval", "approved"])
    .orderBy("publication.writtenAt", "asc")
    .execute();

  return found.map(toQueued);
}

/** Was draußen ist, das Neueste zuerst. */
async function listReleased(): Promise<QueuedBroadcast[]> {
  const found = await rows()
    .where("publication.status", "=", "released")
    .orderBy("publication.releasedAt", "desc")
    .execute();

  return found.map(toQueued);
}

export const BroadcastQueueService = {
  submit,
  approve,
  releaseDue,
  edit,
  discard,
  selectOne,
  listWaiting,
  listReleased,
};
