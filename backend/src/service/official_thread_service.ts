import { sql } from "kysely";
import { db, type Transaction } from "@/src/database/client.ts";
import type { PublicationStatus } from "@/src/database/schema.ts";
import type { User } from "@/src/service/user_service.ts";
import { mayAdministerPlatform } from "@/src/service/platform_authorization.ts";
import { BroadcastSenderService } from "@/src/service/broadcast_sender_service.ts";
import { visibleTo } from "@/src/service/publication_visibility.ts";
import { theAdministration } from "@/src/service/root_admin_service.ts";
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
    .where("publication.kind", "=", "forum_thread")
    // Nur die als offizieller Thread geschriebenen, nicht die nachträglich gesetzten (2b).
    .where("writingThread.shownAsSetAt", "is not", null);
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
  | "not_yours";

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
      .returning("id")
      .executeTakeFirst();

    if (claimed === undefined) {
      return false;
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

    return true;
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

export const OfficialThreadService = {
  submit,
  edit,
  discard,
  approve,
  releaseDue,
  listWaiting,
  listReleased,
};
