import { sql } from "kysely";
import { db, type Transaction } from "@/src/database/client.ts";
import type { PublicationStatus } from "@/src/database/schema.ts";
import type { User } from "@/src/service/user_service.ts";
import { mayAdministerPlatform } from "@/src/service/platform_authorization.ts";
import { BroadcastSenderService } from "@/src/service/broadcast_sender_service.ts";
import { visibleTo } from "@/src/service/publication_visibility.ts";
import { theAdministration } from "@/src/service/root_admin_service.ts";
import type { PostDocument } from "@/src/document/document_schema.ts";
import {
  documentToPlainText,
  plainTextToDocument,
} from "@/src/document/document_text.ts";

/**
 * Offizielle Forum-Threads: geschrieben von einer Person, veröffentlicht unter einem Absender der
 * Plattform, freigegeben wie eine Rundmail.
 *
 * **Dieselben Regeln wie die Rundmail-Warteschlange** (`broadcast_queue_service.ts`), weil es
 * dieselbe Sache ist: Wer vorbereitet, wer freigibt, dass eine Administration mit dem Schreiben
 * freigibt, dass jede Bearbeitung einer anderen Rolle die Freigabe zurücksetzt, dass ein Termin
 * allein nichts veröffentlicht, wer was sieht (`visibleTo`). Anders ist nur, was beim
 * Veröffentlichen geschieht: Statt Post zu verschicken, wird ein Thread sichtbar.
 *
 * **Titel, Unterforum und Eröffnungsbeitrag entstehen in einem Schritt.** Das Forum legt einen
 * Thread sonst leer an, und der erste Beitrag kommt mit einer zweiten Anfrage. Die Freigabe muss
 * aber den Text abdecken; ein offizieller Thread, dessen Beitrag nach der Freigabe erst
 * geschrieben würde, wäre eine Freigabe für einen Titel.
 *
 * **Bis zum Erscheinen unsichtbar** (`writing_thread.awaiting_release`): Er steht in keiner
 * Forum-Ansicht, für niemanden, sondern nur in der Warteschlange. **Beim Erscheinen** bekommen
 * Thread und Eröffnungsbeitrag die Uhrzeit der Veröffentlichung — sonst stünde unter einem frischen
 * Thread „vor drei Tagen".
 *
 * **Außen der Absender, innen der Schreiber** (`shown_as_*`, siehe `shown_author.ts`). Der
 * Absender „Admin" steht auf der Veröffentlichung als null, wie bei Rundmails; an Thread und
 * Beitrag steht das Konto, das ihn trägt, weil dort ein Name angezeigt werden muss.
 *
 * Keine Benachrichtigungen: Wer vom Forum was erfährt, ist #119, Maxis Teil.
 */

export type OfficialThreadInput = {
  title: string;
  /** Der Eröffnungsbeitrag, als reiner Text — wie eine Rundmail. */
  text: string;
  /** Null ist die oberste Ebene des Forums. */
  folderId: string | null;
  /** Null heißt „Admin", das Konto der Plattform. */
  sendAsUserId: string | null;
  scheduledFor: string | null;
  administrationOnly: boolean;
};

export type QueuedThread = OfficialThreadInput & {
  publicationId: string;
  threadId: string;
  status: PublicationStatus;
  folderTitle: string | null;
  sendAsUsername: string | null;
  writtenBy: string | null;
  writtenByUsername: string | null;
  writtenAt: string;
  approvedByUsername: string | null;
  approvedAt: string | null;
  editedByUsername: string | null;
  editedAt: string | null;
  releasedAt: string | null;
  /**
   * Für einen Thread, der schon im Forum steht: tauscht beim Freigeben nur den Namen am
   * Eröffnungsbeitrag. Titel und Text lassen sich in dieser Einreichung nicht ändern — sonst würde
   * mit der Freigabe unbemerkt ein anderer Text öffentlich.
   */
  forExistingThread: boolean;
};

/** Was noch zu ändern ist: weder draußen noch verworfen. */
const STILL_OPEN: PublicationStatus[] = ["awaiting_approval", "approved"];

/** Die Bedingung im Update hat nichts getroffen; die Transaktion wird damit zurückgerollt. */
class NoLongerOpen extends Error {}

function rows(executor: typeof db | Transaction = db) {
  return executor
    .selectFrom("publication")
    .innerJoin("writingThread", "writingThread.publicationId", "publication.id")
    .leftJoin("writingFolder", "writingFolder.id", "writingThread.folderId")
    .leftJoin("user as sender", "sender.id", "publication.sendAsUserId")
    .leftJoin("user as author", "author.id", "publication.writtenBy")
    .leftJoin("user as approver", "approver.id", "publication.approvedBy")
    .leftJoin("user as editor", "editor.id", "publication.editedBy")
    .select([
      "publication.id as publicationId",
      "publication.status",
      "publication.sendAsUserId",
      "publication.scheduledFor",
      "publication.administrationOnly",
      "publication.writtenBy",
      "publication.writtenAt",
      "publication.approvedAt",
      "publication.editedAt",
      "publication.releasedAt",
      "publication.forExistingThread",
      "sender.username as sendAsUsername",
      "author.username as writtenByUsername",
      "approver.username as approvedByUsername",
      "editor.username as editedByUsername",
      "writingThread.id as threadId",
      "writingThread.title",
      "writingThread.folderId",
      "writingFolder.title as folderTitle",
    ])
    // Der Eröffnungsbeitrag ist der erste des Threads. Vor dem Erscheinen ist er der einzige;
    // danach kommen Antworten, aber alle später.
    .select(
      sql<string>`(SELECT opening.text FROM writing_post AS opening
        WHERE opening.writing_thread_id = writing_thread.id
        ORDER BY opening.created_at, opening.id LIMIT 1)`.as("text"),
    )
    .where("publication.kind", "=", "forum_thread");
}

type Row = Awaited<
  ReturnType<ReturnType<typeof rows>["executeTakeFirstOrThrow"]>
>;

function toQueued(row: Row): QueuedThread {
  return { ...row, text: row.text ?? "" };
}

async function selectOne(
  publicationId: string,
  executor: typeof db | Transaction = db,
): Promise<QueuedThread | undefined> {
  const row = await rows(executor)
    .where("publication.id", "=", publicationId)
    .executeTakeFirst();
  return row === undefined ? undefined : toQueued(row);
}

async function selectOneOrThrow(publicationId: string): Promise<QueuedThread> {
  const one = await selectOne(publicationId);
  if (one === undefined) {
    throw new Error(
      `Official thread ${publicationId} vanished after being written`,
    );
  }
  return one;
}

/**
 * Das Konto, das nach außen dasteht: der gewählte Absender, oder bei „Admin" das Konto der
 * Plattform. Ohne ein solches gibt es „Admin" gerade nicht.
 */
async function shownAccount(sendAsUserId: string | null) {
  if (sendAsUserId !== null) {
    return sendAsUserId;
  }
  return (await theAdministration())?.id;
}

/** Wohin ein offizieller Thread darf: ganz oben oder in ein Unterforum, das Mitglieder sehen. */
async function mayPlaceIn(folderId: string | null): Promise<boolean> {
  if (folderId === null) {
    return true;
  }
  const folder = await db
    .selectFrom("writingFolder")
    .select("effectiveMemberPermission")
    .where("id", "=", folderId)
    .where("writingGroupId", "is", null)
    .executeTakeFirst();
  return folder !== undefined && folder.effectiveMemberPermission !== "hidden";
}

export type ThreadRefusal =
  | "sender_not_released"
  | "administration_only_is_theirs"
  | "folder_not_available"
  | "no_administration_account";

/** Was allen Wegen gemeinsam ist, die einen Thread schreiben: Absender, Haken, Ort. */
async function checkInput(
  actor: User,
  input: OfficialThreadInput,
  previousAdministrationOnly: boolean,
): Promise<ThreadRefusal | { shownAs: string }> {
  if (!await BroadcastSenderService.mayUseSender(actor, input.sendAsUserId)) {
    return "sender_not_released";
  }
  if (
    input.administrationOnly !== previousAdministrationOnly &&
    !mayAdministerPlatform(actor.platformRole)
  ) {
    return "administration_only_is_theirs";
  }
  if (!await mayPlaceIn(input.folderId)) {
    return "folder_not_available";
  }
  const shownAs = await shownAccount(input.sendAsUserId);
  if (shownAs === undefined) {
    return "no_administration_account";
  }
  return { shownAs };
}

/**
 * Schreibt einen offiziellen Thread samt Eröffnungsbeitrag, unsichtbar bis zu seinem Erscheinen.
 * Von einer Administration ist er freigegeben und erscheint ohne Termin sofort; von allen anderen
 * wartet er.
 */
async function submit(
  author: User,
  input: OfficialThreadInput,
): Promise<QueuedThread | ThreadRefusal> {
  const checked = await checkInput(author, input, false);
  if (typeof checked === "string") {
    return checked;
  }

  const now = new Date().toISOString();
  const givesOwnApproval = mayAdministerPlatform(author.platformRole);
  const document = plainTextToDocument(input.text);

  const publicationId = await db.transaction().execute(async (transaction) => {
    const publication = await transaction
      .insertInto("publication")
      .values({
        kind: "forum_thread",
        status: givesOwnApproval ? "approved" : "awaiting_approval",
        sendAsUserId: input.sendAsUserId,
        scheduledFor: input.scheduledFor,
        administrationOnly: input.administrationOnly,
        writtenBy: author.id,
        writtenAt: now,
        approvedBy: givesOwnApproval ? author.id : null,
        approvedAt: givesOwnApproval ? now : null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const thread = await transaction
      .insertInto("writingThread")
      .values({
        writingGroupId: null,
        folderId: input.folderId,
        title: input.title,
        createdBy: author.id,
        memberPermission: "write",
        publicationId: publication.id,
        awaitingRelease: true,
        shownAsUserId: checked.shownAs,
        shownAsSetBy: author.id,
        shownAsSetAt: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await transaction
      .insertInto("writingPost")
      .values({
        writingThreadId: thread.id,
        document,
        text: documentToPlainText(document),
        isDraft: false,
        createdBy: author.id,
        shownAsUserId: checked.shownAs,
        shownAsSetBy: author.id,
        shownAsSetAt: now,
      })
      .execute();

    return publication.id;
  });

  if (givesOwnApproval && input.scheduledFor === null) {
    await release(publicationId);
  }

  return await selectOneOrThrow(publicationId);
}

export type EditRefusal =
  | ThreadRefusal
  | "not_found"
  | "already_out"
  | "not_yours"
  | "content_fixed";

/** Ohne Administration nur das Eigene — beim Bearbeiten wie beim Verwerfen. */
function mayTouch(publication: { writtenBy: string | null }, actor: User) {
  return mayAdministerPlatform(actor.platformRole) ||
    publication.writtenBy === actor.id;
}

/**
 * Ändert einen wartenden oder freigegebenen offiziellen Thread. Von einer Administration ist die
 * neue Fassung freigegeben (und erscheint ohne Termin sofort), von jeder anderen Rolle wartet sie
 * wieder — dieselbe Regel wie bei Rundmails.
 */
async function edit(
  publicationId: string,
  input: OfficialThreadInput,
  editor: User,
): Promise<QueuedThread | EditRefusal> {
  const existing = await selectOne(publicationId);
  if (existing === undefined) {
    return "not_found";
  }
  if (existing.status === "released") {
    return "already_out";
  }
  if (!STILL_OPEN.includes(existing.status)) {
    return "not_found";
  }
  if (!mayTouch(existing, editor)) {
    return "not_yours";
  }

  // **Bei einem Thread, der schon im Forum steht, tauscht die Einreichung nur den Namen.** Titel,
  // Text oder Ort in derselben Einreichung zu ändern hieße, mit der Freigabe unbemerkt einen
  // anderen Text öffentlich zu machen. Wer das will, ändert ihn danach als Administration — mit
  // Grund und im Protokoll.
  if (
    existing.forExistingThread &&
    (input.title !== existing.title || input.text !== existing.text ||
      input.folderId !== existing.folderId)
  ) {
    return "content_fixed";
  }

  const checked = await checkInput(editor, input, existing.administrationOnly);
  if (typeof checked === "string") {
    return checked;
  }

  const approves = mayAdministerPlatform(editor.platformRole);
  const now = new Date().toISOString();
  const document = plainTextToDocument(input.text);

  try {
    await db.transaction().execute(async (transaction) => {
      const changed = await transaction
        .updateTable("publication")
        .set({
          status: approves ? "approved" : "awaiting_approval",
          approvedBy: approves ? editor.id : null,
          approvedAt: approves ? now : null,
          sendAsUserId: input.sendAsUserId,
          scheduledFor: input.scheduledFor,
          administrationOnly: input.administrationOnly,
          editedBy: editor.id,
          editedAt: now,
        })
        .where("id", "=", publicationId)
        .where("status", "in", STILL_OPEN)
        .returning("id")
        .executeTakeFirst();

      if (changed === undefined) {
        throw new NoLongerOpen();
      }

      // Ein bestehender Thread bekommt seinen Absender erst beim Freigeben; hier ändert sich an ihm
      // nichts.
      if (existing.forExistingThread) {
        return;
      }

      await transaction
        .updateTable("writingThread")
        .set({
          title: input.title,
          folderId: input.folderId,
          shownAsUserId: checked.shownAs,
        })
        .where("id", "=", existing.threadId)
        .execute();

      // Der Eröffnungsbeitrag: vor dem Erscheinen der einzige des Threads.
      await transaction
        .updateTable("writingPost")
        .set({
          document,
          text: documentToPlainText(document),
          shownAsUserId: checked.shownAs,
        })
        .where("writingThreadId", "=", existing.threadId)
        .execute();
    });
  } catch (failure) {
    if (failure instanceof NoLongerOpen) {
      return "already_out";
    }
    throw failure;
  }

  if (approves && input.scheduledFor === null) {
    await release(publicationId);
  }

  return await selectOneOrThrow(publicationId);
}

export type DiscardRefusal = "not_found" | "already_out" | "not_yours";

/**
 * Verworfen, nicht gelöscht — wie eine Rundmail. Der Thread bleibt, wie er war: unsichtbar.
 */
async function discard(
  publicationId: string,
  actor: User,
): Promise<DiscardRefusal | undefined> {
  const existing = await selectOne(publicationId);
  if (existing === undefined) {
    return "not_found";
  }
  if (existing.status === "released") {
    return "already_out";
  }
  if (!STILL_OPEN.includes(existing.status)) {
    return "not_found";
  }
  if (!mayTouch(existing, actor)) {
    return "not_yours";
  }

  const discarded = await db
    .updateTable("publication")
    .set({ status: "discarded" })
    .where("id", "=", publicationId)
    .where("status", "in", STILL_OPEN)
    .returning("id")
    .executeTakeFirst();

  return discarded === undefined ? "already_out" : undefined;
}

export type ApprovalRefusal = "not_found" | "not_waiting";

/** Gibt frei; ohne Termin erscheint der Thread damit. Nur für die Administration (die Route). */
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

  const approved = await db
    .updateTable("publication")
    .set({
      status: "approved",
      approvedBy: approver.id,
      approvedAt: new Date().toISOString(),
    })
    .where("id", "=", publicationId)
    .where("status", "=", "awaiting_approval")
    .returning("scheduledFor")
    .executeTakeFirst();

  if (approved === undefined) {
    return "not_waiting";
  }

  // Der Termin aus der Zeile, die gerade freigegeben wurde — nicht aus der, die vorher gelesen
  // wurde: Dazwischen kann jemand ihn geändert haben.
  if (approved.scheduledFor === null) {
    await release(publicationId);
  }

  return undefined;
}

/**
 * Lässt den Thread erscheinen. **Genau einmal:** Die Bedingung `status = 'approved'` im Update ist
 * der Punkt, an dem von zwei gleichzeitigen Wegen — Freigabe von Hand und Taktgeber — genau einer
 * gewinnt.
 */
async function release(publicationId: string): Promise<boolean> {
  return await db.transaction().execute(async (transaction) => {
    const now = new Date().toISOString();

    const claimed = await transaction
      .updateTable("publication")
      .set({ status: "released", releasedAt: now })
      .where("id", "=", publicationId)
      .where("kind", "=", "forum_thread")
      .where("status", "=", "approved")
      .returning(["forExistingThread", "sendAsUserId", "writtenBy"])
      .executeTakeFirst();

    if (claimed === undefined) {
      return false;
    }

    if (claimed.forExistingThread) {
      await makeExistingOfficial(transaction, publicationId, claimed, now);
      return true;
    }

    const thread = await transaction
      .updateTable("writingThread")
      .set({ awaitingRelease: false, createdAt: now, lastActivityAt: now })
      .where("publicationId", "=", publicationId)
      .where("awaitingRelease", "=", true)
      .returning("id")
      .executeTakeFirstOrThrow();

    // Die Zeit der Veröffentlichung, nicht die des Schreibens: Unter einem frischen Thread soll
    // nicht „vor drei Tagen" stehen.
    await transaction
      .updateTable("writingPost")
      .set({ createdAt: now })
      .where("writingThreadId", "=", thread.id)
      .execute();

    // Auch hier steht im Protokoll, unter welchem Namen er erschienen ist — einen Namen davor gab
    // es nie, er war bis eben unsichtbar.
    const shownAs = await transaction
      .selectFrom("writingThread")
      .select("shownAsUserId")
      .where("id", "=", thread.id)
      .executeTakeFirst();

    if (
      shownAs?.shownAsUserId !== null && shownAs?.shownAsUserId !== undefined
    ) {
      await recordMadeOfficial(transaction, {
        threadId: thread.id,
        nameBefore: null,
        shownAsUserId: shownAs.shownAsUserId,
        editedBy: claimed.writtenBy,
      });
    }

    return true;
  });
}

/**
 * Ein Thread, der schon im Forum steht, wird offiziell: **nur der Eröffnungsbeitrag** — und der
 * Thread selbst, dessen Eröffner er ist — erscheint ab jetzt unter dem Absender. Spätere Antworten
 * derselben Person bleiben unter ihrem Namen, und keine Zeit ändert sich: Der Thread ist nicht neu.
 *
 * Der Absender wird hier aufgelöst, nicht beim Einreichen: „Admin" ist das Konto, das die
 * Plattform zum Zeitpunkt der Freigabe trägt.
 */
async function makeExistingOfficial(
  transaction: Transaction,
  publicationId: string,
  publication: { sendAsUserId: string | null; writtenBy: string | null },
  now: string,
): Promise<void> {
  const shownAs = publication.sendAsUserId ??
    (await transaction
      .selectFrom("user")
      .select("id")
      .where("isPrimordialAdmin", "=", true)
      .executeTakeFirst())?.id;

  if (shownAs === undefined) {
    // Ohne Konto der Plattform gibt es „Admin" gerade nicht. Zurückrollen, damit sie freigegeben
    // bleibt und der nächste Takt es noch einmal versucht.
    throw new Error("There is no platform account to show the thread as");
  }

  // Wer bis eben dastand — der Name kommt ins Protokoll und beim Zurücknehmen zurück.
  const before = await transaction
    .selectFrom("writingThread")
    .leftJoin("user", "user.id", "writingThread.createdBy")
    .select("user.username")
    .where("writingThread.publicationId", "=", publicationId)
    .executeTakeFirst();

  const thread = await transaction
    .updateTable("writingThread")
    .set({
      shownAsUserId: shownAs,
      shownAsSetBy: publication.writtenBy,
      shownAsSetAt: now,
    })
    .where("publicationId", "=", publicationId)
    .where("shownAsSetAt", "is", null)
    .returning("id")
    .executeTakeFirstOrThrow();

  // Der Eröffnungsbeitrag ist der erste des Threads.
  await transaction
    .updateTable("writingPost")
    .set({
      shownAsUserId: shownAs,
      shownAsSetBy: publication.writtenBy,
      shownAsSetAt: now,
    })
    .where(
      "id",
      "=",
      (eb) =>
        eb.selectFrom("writingPost as opening")
          .select("opening.id")
          .where("opening.writingThreadId", "=", thread.id)
          .orderBy("opening.createdAt")
          .orderBy("opening.id")
          .limit(1),
    )
    .execute();

  await recordMadeOfficial(transaction, {
    threadId: thread.id,
    nameBefore: before?.username ?? null,
    shownAsUserId: shownAs,
    editedBy: publication.writtenBy,
  });
}

/**
 * Hält im Protokoll fest, dass ein Thread offiziell geworden ist, und unter welchem Namen.
 *
 * **Das ist die größte Änderung an einem Thread.** Wer den Absender vertauscht, ändert, wer die
 * Plattform zu sagen scheint — auf der Beta ist das einmal aus Versehen passiert und stand
 * nirgends. Bei einem Thread, der schon im Forum stand, steht auch der Name davor darin.
 */
async function recordMadeOfficial(
  transaction: Transaction,
  entry: {
    threadId: string;
    nameBefore: string | null;
    shownAsUserId: string;
    editedBy: string | null;
  },
): Promise<void> {
  const shownAs = await transaction
    .selectFrom("user")
    .select("username")
    .where("id", "=", entry.shownAsUserId)
    .executeTakeFirst();

  await transaction
    .insertInto("officialRevision")
    .values({
      kind: "made_official",
      writingThreadId: entry.threadId,
      editedBy: entry.editedBy,
      // Kein Grund: Der Vorgang *ist* die Einreichung, und wer und wann steht daneben.
      reason: null,
      nameBefore: entry.nameBefore,
      nameAfter: shownAs?.username ?? "Admin",
    })
    .execute();
}

export type UnmakeRefusal =
  | "not_found"
  | "not_official"
  | "not_from_an_existing_thread";

/**
 * Nimmt zurück, dass ein Thread offiziell ist — der Weg zurück, den es für einzelne Beiträge schon
 * gab und für den Namenstausch nicht.
 *
 * **Nur bei einem Thread, der vorher schon im Forum stand.** Dort gab es einen Namen davor, und der
 * kommt zurück. Ein Thread, der als offizieller geschrieben wurde, hat keinen: Unter ihm steht die
 * Person, die ihn getippt hat, und die hat nie unter ihrem Namen geschrieben. Sie nachträglich
 * daruntersetzen hieße, ihr die Aussage anzuhängen — dafür gibt es das Löschen des Beitrags.
 *
 * Mit Grund, im Protokoll, und die Veröffentlichung gilt als zurückgezogen — dieselbe Spur wie bei
 * einer zurückgezogenen Rundmail.
 */
async function unmakeOfficial(
  threadId: string,
  reason: string,
  editor: User,
): Promise<UnmakeRefusal | undefined> {
  return await db.transaction().execute(async (transaction) => {
    // Erst die Zeile sperren, dann lesen: `FOR UPDATE` verträgt sich nicht mit den Joins darunter —
    // PostgreSQL weist es zurück, und zwar mitten im Vorgang.
    await transaction
      .selectFrom("writingThread")
      .select("id")
      .where("id", "=", threadId)
      .forUpdate()
      .execute();

    const thread = await transaction
      .selectFrom("writingThread")
      .leftJoin("publication", "publication.id", "writingThread.publicationId")
      .leftJoin("user as shown", "shown.id", "writingThread.shownAsUserId")
      .select([
        "writingThread.id",
        "writingThread.publicationId",
        "writingThread.shownAsSetAt",
        "writingThread.awaitingRelease",
        "shown.username as shownAsUsername",
        "publication.forExistingThread",
        "publication.retractedAt",
      ])
      .where("writingThread.id", "=", threadId)
      .where("writingThread.writingGroupId", "is", null)
      .executeTakeFirst();

    if (thread === undefined || thread.awaitingRelease) {
      return "not_found";
    }
    if (thread.shownAsSetAt === null) {
      return "not_official";
    }
    if (thread.forExistingThread !== true) {
      return "not_from_an_existing_thread";
    }

    // Der Name, der wieder dastehen wird: der echte Verfasser des Threads.
    const author = await transaction
      .selectFrom("writingThread")
      .leftJoin("user", "user.id", "writingThread.createdBy")
      .select("user.username")
      .where("writingThread.id", "=", threadId)
      .executeTakeFirst();

    await transaction
      .updateTable("writingThread")
      .set({ shownAsUserId: null, shownAsSetBy: null, shownAsSetAt: null })
      .where("id", "=", threadId)
      .execute();

    // Alle Beiträge dieses Threads, die den Absender tragen — beim nachträglichen Offiziell-Machen
    // ist das genau der Eröffnungsbeitrag.
    await transaction
      .updateTable("writingPost")
      .set({ shownAsUserId: null, shownAsSetBy: null, shownAsSetAt: null })
      .where("writingThreadId", "=", threadId)
      .where("shownAsSetAt", "is not", null)
      .execute();

    if (thread.publicationId !== null && thread.retractedAt === null) {
      await transaction
        .updateTable("publication")
        .set({
          retractedBy: editor.id,
          retractedAt: new Date().toISOString(),
        })
        .where("id", "=", thread.publicationId)
        .execute();
    }

    await transaction
      .insertInto("officialRevision")
      .values({
        kind: "unmade_official",
        writingThreadId: threadId,
        editedBy: editor.id,
        reason,
        nameBefore: thread.shownAsUsername ?? "Admin",
        nameAfter: author?.username ?? null,
      })
      .execute();

    return undefined;
  });
}

/** Was fällig ist, erscheint. Der Taktgeber ruft das jede Minute, wie bei den Rundmails. */
async function releaseDue(): Promise<number> {
  const due = await db
    .selectFrom("publication")
    .select("id")
    .where("kind", "=", "forum_thread")
    .where("status", "=", "approved")
    .where((eb) =>
      eb.or([
        eb("scheduledFor", "is", null),
        eb("scheduledFor", "<=", sql<string>`now()`),
      ])
    )
    .orderBy("scheduledFor", "asc")
    .execute();

  let released = 0;
  for (const { id } of due) {
    try {
      // deno-lint-ignore no-await-in-loop -- nacheinander, wie bei den Rundmails
      if (await release(id)) {
        released++;
      }
    } catch (failure) {
      // Einer, der nicht erscheinen kann, hält die anderen nicht auf; er bleibt freigegeben und
      // kommt beim nächsten Takt wieder dran.
      console.error(
        `Releasing official thread ${id} failed; it stays approved and will be tried again`,
        failure,
      );
    }
  }
  return released;
}

async function listWaiting(viewer: User): Promise<QueuedThread[]> {
  const found = await rows()
    .where(visibleTo(viewer))
    .where("publication.status", "in", STILL_OPEN)
    .orderBy("publication.writtenAt", "asc")
    .execute();
  return found.map(toQueued);
}

async function listReleased(viewer: User): Promise<QueuedThread[]> {
  const found = await rows()
    .where(visibleTo(viewer))
    .where("publication.status", "=", "released")
    .orderBy("publication.releasedAt", "desc")
    .execute();
  return found.map(toQueued);
}

// ── Nachträglich offiziell ──────────────────────────────────────────────────────────────────

export type ExistingThreadInput = {
  threadId: string;
  sendAsUserId: string | null;
  administrationOnly: boolean;
};

export type ExistingRefusal =
  | ThreadRefusal
  | "thread_not_found"
  | "not_the_opener"
  | "no_opening_post"
  | "opening_post_not_by_team"
  | "already_official"
  | "already_pending";

/**
 * Macht einen Thread offiziell, der schon im Forum steht.
 *
 * **Wer:** der Eröffner selbst oder eine Administration, sonst niemand — sonst könnte jemand den
 * Beitrag eines anderen zur offiziellen Aussage machen. **Wessen:** nur, wenn der Eröffnungsbeitrag
 * von jemandem aus dem Team stammt, heute; wer das Team verlassen hat, dessen alte Beiträge bleiben
 * unter dem eigenen Namen.
 *
 * Läuft durch die Warteschlange, ohne Termin; bis zur Freigabe bleibt der eigene Name stehen. Von
 * einer Administration ist es sofort freigegeben. Titel und Text ändern sich dabei nicht.
 */
async function submitForExisting(
  actor: User,
  input: ExistingThreadInput,
): Promise<QueuedThread | ExistingRefusal> {
  const thread = await db
    .selectFrom("writingThread")
    .leftJoin("publication", "publication.id", "writingThread.publicationId")
    .select([
      "writingThread.id",
      "writingThread.title",
      "writingThread.folderId",
      "writingThread.createdBy",
      "writingThread.awaitingRelease",
      "writingThread.shownAsSetAt",
      "publication.status as publicationStatus",
      "publication.retractedAt as publicationRetractedAt",
    ])
    .where("writingThread.id", "=", input.threadId)
    .where("writingThread.writingGroupId", "is", null)
    .executeTakeFirst();

  if (thread === undefined || thread.awaitingRelease) {
    return "thread_not_found";
  }
  if (thread.shownAsSetAt !== null) {
    return "already_official";
  }
  // Eine offene Einreichung für diesen Thread gibt es schon; eine verworfene steht nicht im Weg —
  // und eine zurückgenommene auch nicht, sonst ließe sich ein Thread nach dem Zurücknehmen nie
  // wieder offiziell machen.
  if (
    thread.publicationStatus !== null &&
    thread.publicationStatus !== "discarded" &&
    thread.publicationRetractedAt === null
  ) {
    return "already_pending";
  }
  if (
    !mayAdministerPlatform(actor.platformRole) && thread.createdBy !== actor.id
  ) {
    return "not_the_opener";
  }

  const opening = await db
    .selectFrom("writingPost")
    .leftJoin("user", "user.id", "writingPost.createdBy")
    .select(["writingPost.text", "user.platformRole"])
    .where("writingPost.writingThreadId", "=", thread.id)
    .orderBy("writingPost.createdAt")
    .orderBy("writingPost.id")
    .limit(1)
    .executeTakeFirst();

  // Zwei verschiedene Nein, und sie dürfen nicht gleich klingen: Im Thema steht noch nichts, oder
  // was darin steht, stammt nicht aus dem Team.
  if (opening === undefined) {
    return "no_opening_post";
  }
  if (opening.platformRole === null) {
    return "opening_post_not_by_team";
  }

  const checked = await checkInput(actor, {
    title: thread.title,
    text: opening.text,
    folderId: thread.folderId,
    sendAsUserId: input.sendAsUserId,
    scheduledFor: null,
    administrationOnly: input.administrationOnly,
  }, false);
  if (typeof checked === "string") {
    return checked;
  }

  const now = new Date().toISOString();
  const givesOwnApproval = mayAdministerPlatform(actor.platformRole);

  const publicationId = await db.transaction().execute(async (transaction) => {
    const publication = await transaction
      .insertInto("publication")
      .values({
        kind: "forum_thread",
        forExistingThread: true,
        status: givesOwnApproval ? "approved" : "awaiting_approval",
        sendAsUserId: input.sendAsUserId,
        scheduledFor: null,
        administrationOnly: input.administrationOnly,
        writtenBy: actor.id,
        writtenAt: now,
        approvedBy: givesOwnApproval ? actor.id : null,
        approvedAt: givesOwnApproval ? now : null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await transaction
      .updateTable("writingThread")
      .set({ publicationId: publication.id })
      .where("id", "=", thread.id)
      .execute();

    return publication.id;
  });

  if (givesOwnApproval) {
    await release(publicationId);
  }

  return await selectOneOrThrow(publicationId);
}

// ── Nach dem Erscheinen: Ändern nur mit Grund, und im Protokoll ─────────────────────────────

export type RevisionRefusal = "not_found" | "not_official" | "unchanged";

/** Ein erschienener offizieller Thread: sichtbar und verdeckt. */
async function officialThread(threadId: string, executor: Transaction) {
  return await executor
    .selectFrom("writingThread")
    .select(["id", "title"])
    .where("id", "=", threadId)
    .where("writingGroupId", "is", null)
    .where("awaitingRelease", "=", false)
    .where("shownAsSetAt", "is not", null)
    .executeTakeFirst();
}

/**
 * Ändert die Überschrift eines offiziellen Threads — nur eine Administration (die Route), nur mit
 * Grund, und mit Titel vorher und nachher im Protokoll. In einer Transaktion: Eine Änderung ohne
 * Protokolleintrag kann es so nicht geben.
 */
async function changeTitle(
  threadId: string,
  title: string,
  reason: string,
  editor: User,
): Promise<RevisionRefusal | { title: string }> {
  return await db.transaction().execute(async (transaction) => {
    const thread = await transaction
      .selectFrom("writingThread")
      .select(["id", "title", "shownAsSetAt", "awaitingRelease"])
      .where("id", "=", threadId)
      .where("writingGroupId", "is", null)
      .forUpdate()
      .executeTakeFirst();

    if (thread === undefined || thread.awaitingRelease) {
      return "not_found";
    }
    if (thread.shownAsSetAt === null) {
      return "not_official";
    }
    if (thread.title === title) {
      return "unchanged";
    }

    await transaction.updateTable("writingThread").set({ title })
      .where("id", "=", threadId).execute();

    await transaction
      .insertInto("officialRevision")
      .values({
        kind: "title_changed",
        writingThreadId: threadId,
        editedBy: editor.id,
        reason,
        titleBefore: thread.title,
        titleAfter: title,
      })
      .execute();

    return { title };
  });
}

/**
 * Ändert einen offiziellen Beitrag — nur eine Administration (die Route), nur mit Grund, Text
 * vorher und nachher im Protokoll, in einer Transaktion.
 *
 * Ein eigener Weg neben `WritingPostService.updatePost`, nicht durch ihn: Der gehört dem Forum und
 * den Gruppen, und das Protokoll muss in derselben Transaktion stehen wie die Änderung.
 */
async function editOfficialPost(
  threadId: string,
  postId: string,
  document: PostDocument,
  reason: string,
  editor: User,
): Promise<RevisionRefusal | undefined> {
  return await db.transaction().execute(async (transaction) => {
    if (await officialThread(threadId, transaction) === undefined) {
      return "not_found";
    }

    const before = await transaction
      .selectFrom("writingPost")
      .select(["text", "document", "shownAsSetAt"])
      .where("id", "=", postId)
      .where("writingThreadId", "=", threadId)
      .forUpdate()
      .executeTakeFirst();

    if (before === undefined) {
      return "not_found";
    }
    if (before.shownAsSetAt === null) {
      return "not_official";
    }

    const text = documentToPlainText(document);
    if (text === before.text) {
      return "unchanged";
    }

    await transaction
      .updateTable("writingPost")
      .set({
        document,
        text,
        editedAt: new Date().toISOString(),
        editedBy: editor.id,
      })
      .where("id", "=", postId)
      .execute();

    await transaction
      .insertInto("officialRevision")
      .values({
        kind: "post_edited",
        writingThreadId: threadId,
        writingPostId: postId,
        editedBy: editor.id,
        reason,
        textBefore: before.text,
        textAfter: text,
        documentBefore: JSON.stringify(before.document),
        documentAfter: JSON.stringify(document),
      })
      .execute();

    return undefined;
  });
}

/** Löscht einen offiziellen Beitrag — mit Grund, und mit dem gelöschten Text im Protokoll. */
async function deleteOfficialPost(
  threadId: string,
  postId: string,
  reason: string,
  editor: User,
): Promise<RevisionRefusal | undefined> {
  return await db.transaction().execute(async (transaction) => {
    if (await officialThread(threadId, transaction) === undefined) {
      return "not_found";
    }

    const before = await transaction
      .selectFrom("writingPost")
      .select(["text", "document", "shownAsSetAt"])
      .where("id", "=", postId)
      .where("writingThreadId", "=", threadId)
      .forUpdate()
      .executeTakeFirst();

    if (before === undefined) {
      return "not_found";
    }
    if (before.shownAsSetAt === null) {
      return "not_official";
    }

    // Zuerst ins Protokoll, dann löschen: Die Zeile verweist danach auf keinen Beitrag mehr
    // (`ON DELETE SET NULL`), aber der Text steht in ihr selbst.
    await transaction
      .insertInto("officialRevision")
      .values({
        kind: "post_deleted",
        writingThreadId: threadId,
        writingPostId: postId,
        editedBy: editor.id,
        reason,
        textBefore: before.text,
        documentBefore: JSON.stringify(before.document),
      })
      .execute();

    await transaction.deleteFrom("writingPost").where("id", "=", postId)
      .execute();

    return undefined;
  });
}

export type OfficialRevision = {
  id: string;
  kind:
    | "title_changed"
    | "post_edited"
    | "post_deleted"
    | "made_official"
    | "unmade_official";
  editedByUsername: string | null;
  editedAt: string;
  /** Leer allein bei „offiziell gemacht": Dort ist die Einreichung selbst der Vorgang. */
  reason: string | null;
  titleBefore: string | null;
  titleAfter: string | null;
  textBefore: string | null;
  textAfter: string | null;
  /** Der Name, unter dem er erscheint — vorher und nachher. */
  nameBefore: string | null;
  nameAfter: string | null;
};

/** Das Protokoll eines offiziellen Threads, die neuesten zuerst. Nur für die Administration. */
async function listRevisions(threadId: string): Promise<OfficialRevision[]> {
  return await db
    .selectFrom("officialRevision")
    .leftJoin("user", "user.id", "officialRevision.editedBy")
    .select([
      "officialRevision.id",
      "officialRevision.kind",
      "user.username as editedByUsername",
      "officialRevision.editedAt",
      "officialRevision.reason",
      "officialRevision.titleBefore",
      "officialRevision.titleAfter",
      "officialRevision.textBefore",
      "officialRevision.textAfter",
      "officialRevision.nameBefore",
      "officialRevision.nameAfter",
    ])
    .where("officialRevision.writingThreadId", "=", threadId)
    .orderBy("officialRevision.editedAt", "desc")
    .orderBy("officialRevision.id", "desc")
    .execute();
}

export const OfficialThreadService = {
  submit,
  submitForExisting,
  edit,
  discard,
  approve,
  releaseDue,
  listWaiting,
  listReleased,
  changeTitle,
  unmakeOfficial,
  editOfficialPost,
  deleteOfficialPost,
  listRevisions,
};
