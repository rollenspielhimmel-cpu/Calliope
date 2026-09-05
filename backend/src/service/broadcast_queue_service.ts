import { db } from "@/src/database/client.ts";
import type { PublicationStatus } from "@/src/database/schema.ts";
import type { User } from "@/src/service/user_service.ts";
import {
  type BroadcastAudience,
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
 * Schritt 1 kennt keine Zeitsteuerung: Freigeben heißt hier sofort senden. `approved` und
 * `released` bleiben trotzdem zwei Zustände, weil der Termin als Nächstes dazwischenrückt.
 */

export type BroadcastInput = {
  subject: string;
  body: string;
  audienceGroups: BroadcastGroup[];
  includeUnverified: boolean;
  /** Null heißt: unter dem Ur-Admin-Konto, das dauerhaft zur Verfügung steht. */
  sendAsUserId: string | null;
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
  recipientCount: number | null;
};

function audienceOf(broadcast: BroadcastInput): BroadcastAudience {
  return {
    groups: broadcast.audienceGroups,
    includeUnverified: broadcast.includeUnverified,
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
      "sender.username as sendAsUsername",
      "author.username as writtenByUsername",
      "publication.writtenAt",
      "approver.username as approvedByUsername",
      "publication.approvedAt",
      "publication.releasedAt",
      "broadcast.subject",
      "broadcast.body",
      "broadcast.audienceGroups",
      "broadcast.includeUnverified",
      "broadcast.recipientCount",
    ])
    .where("publication.kind", "=", "broadcast");
}

function toQueued(row: {
  publicationId: string;
  status: PublicationStatus;
  sendAsUserId: string | null;
  sendAsUsername: string | null;
  writtenByUsername: string | null;
  writtenAt: string;
  approvedByUsername: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  subject: string;
  body: string;
  audienceGroups: string[];
  includeUnverified: boolean;
  recipientCount: number | null;
}): QueuedBroadcast {
  return {
    ...row,
    // Die Spalte ist `TEXT[]`, weil die Datenbank den Empfängerbegriff nicht kennt. Die Werte
    // stammen aus dem geprüften Anfragekörper, also ist die Einschränkung hier eine Behauptung
    // über bereits Geprüftes und kein Vertrauen in die Datenbank.
    audienceGroups: row.audienceGroups as BroadcastGroup[],
  };
}

/**
 * Schreibt eine Rundmail in die Warteschlange.
 *
 * Vom Ur-Admin kommt sie freigegeben heraus und geht sofort raus; von allen anderen wartet sie.
 */
async function submit(
  author: User,
  input: BroadcastInput,
): Promise<QueuedBroadcast> {
  const now = new Date().toISOString();
  const givesOwnApproval = author.isPrimordialAdmin;

  const publicationId = await db.transaction().execute(async (transaction) => {
    const publication = await transaction
      .insertInto("publication")
      .values({
        kind: "broadcast",
        status: givesOwnApproval ? "approved" : "awaiting_approval",
        sendAsUserId: input.sendAsUserId,
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
      })
      .execute();

    return publication.id;
  });

  if (givesOwnApproval) {
    await release(publicationId, input);
  }

  return await selectOneOrThrow(publicationId);
}

/**
 * Verschickt und hält fest, an wie viele.
 *
 * Die Zahl wird beim Versand festgehalten und nicht später gezählt: Wer die Liste hinterher neu
 * abfragt, zählt die Mitglieder von heute und nicht die, die sie bekommen haben.
 */
async function release(
  publicationId: string,
  input: BroadcastInput,
): Promise<void> {
  const result = await BroadcastService.send(
    audienceOf(input),
    input.subject,
    input.body,
  );

  await db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("publication")
      .set({ status: "released", releasedAt: new Date().toISOString() })
      .where("id", "=", publicationId)
      .execute();

    await transaction
      .updateTable("broadcast")
      .set({ recipientCount: result.recipients })
      .where("publicationId", "=", publicationId)
      .execute();
  });
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

  await release(publicationId, waiting);

  return undefined;
}

export type EditRefusal = "not_found" | "already_out";

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

  await db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("publication")
      .set({
        status: "awaiting_approval",
        approvedBy: null,
        approvedAt: null,
        sendAsUserId: input.sendAsUserId,
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
        updatedAt: new Date().toISOString(),
      })
      .where("publicationId", "=", publicationId)
      .execute();
  });

  return undefined;
}

/** Verworfen, nicht gelöscht: Was eingereicht wurde, bleibt als Spur stehen. */
async function discard(
  publicationId: string,
): Promise<EditRefusal | undefined> {
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

/** Die Warteschlange: die ältesten zuerst, damit nichts unten liegen bleibt. */
async function listWaiting(): Promise<QueuedBroadcast[]> {
  const found = await rows()
    .where("publication.status", "=", "awaiting_approval")
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
  edit,
  discard,
  selectOne,
  listWaiting,
  listReleased,
};
