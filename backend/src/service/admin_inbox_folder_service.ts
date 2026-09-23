import { sql } from "kysely";
import { db, type Transaction } from "@/src/database/client.ts";

/**
 * Ordner im Postfach der Administration: zum Aufbewahren, nicht zum Abarbeiten.
 *
 * **Unabhängig von offen und erledigt.** Ein Gespräch in „Beschwerden" kann offen sein oder längst
 * erledigt; der Ordner sagt, wo man es wiederfindet, nicht, ob noch etwas zu tun ist.
 *
 * **Ganze Gespräche oder einzelne Nachrichten.** Aus einem langen Hin und Her sind oft nur fünf
 * Nachrichten wichtig — die liegen dann im Ordner, und der Verlauf bleibt, wo er ist.
 *
 * **Flach, und eine Reihenfolge für alle Admins.** Wichtiges steht oben, für jeden an derselben
 * Stelle. Einen Ordner zu löschen nimmt nur die Einsortierung weg: Gespräche und Nachrichten bleiben
 * im Postfach.
 *
 * Nur die Administration — wie das Postfach selbst. Die Routen prüfen das.
 */

export type InboxFolder = {
  id: string;
  title: string;
  conversationCount: number;
  messageCount: number;
};

export type FolderRefusal = "not_found" | "title_taken";

/**
 * Anlegen und Verschieben laufen nacheinander, nie gleichzeitig: Beide lesen erst, was da ist
 * (Titel, Plätze), und schreiben dann. Ohne die Sperre legten zwei Admins im selben Moment zweimal
 * „Wichtig" an, oder zwei Ordner landeten auf demselben Platz.
 */
async function lockFolders(transaction: Transaction) {
  await sql`LOCK TABLE public.inbox_folder IN SHARE ROW EXCLUSIVE MODE`
    .execute(transaction);
}

/** Ob schon ein anderer Ordner so heißt — Groß- und Kleinschreibung und Ränder zählen nicht. */
async function titleTaken(
  transaction: Transaction,
  title: string,
  except?: string,
) {
  let query = transaction
    .selectFrom("inboxFolder")
    .select("id")
    .where(sql<string>`lower(btrim(title))`, "=", title.trim().toLowerCase());

  if (except !== undefined) {
    query = query.where("id", "!=", except);
  }

  return await query.executeTakeFirst() !== undefined;
}

/** Die Ordner in ihrer Reihenfolge, mit dem, was darin liegt. */
async function listFolders(): Promise<InboxFolder[]> {
  const rows = await db
    .selectFrom("inboxFolder")
    .leftJoin(
      "inboxFolderItem",
      "inboxFolderItem.inboxFolderId",
      "inboxFolder.id",
    )
    .select((eb) => [
      "inboxFolder.id",
      "inboxFolder.title",
      eb.fn.count<string>("inboxFolderItem.chatGroupId").as("conversations"),
      eb.fn.count<string>("inboxFolderItem.chatMessageId").as("messages"),
    ])
    .groupBy(["inboxFolder.id", "inboxFolder.title", "inboxFolder.position"])
    .orderBy("inboxFolder.position")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    conversationCount: Number(row.conversations),
    messageCount: Number(row.messages),
  }));
}

/** Ein neuer Ordner, unten angehängt. */
async function createFolder(
  title: string,
  administrator: { id: string },
): Promise<{ id: string } | FolderRefusal> {
  return await db.transaction().execute(async (transaction) => {
    await lockFolders(transaction);

    if (await titleTaken(transaction, title)) {
      return "title_taken";
    }

    const last = await transaction
      .selectFrom("inboxFolder")
      .select((eb) => eb.fn.max("position").as("position"))
      .executeTakeFirst();

    return await transaction
      .insertInto("inboxFolder")
      .values({
        title: title.trim(),
        position: (last?.position ?? -1) + 1,
        createdBy: administrator.id,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  });
}

async function renameFolder(
  folderId: string,
  title: string,
): Promise<FolderRefusal | undefined> {
  return await db.transaction().execute(async (transaction) => {
    await lockFolders(transaction);

    if (await titleTaken(transaction, title, folderId)) {
      return "title_taken";
    }

    const result = await transaction
      .updateTable("inboxFolder")
      .set({ title: title.trim() })
      .where("id", "=", folderId)
      .executeTakeFirst();

    return result.numUpdatedRows === 0n ? "not_found" : undefined;
  });
}

/**
 * Löscht den Ordner und damit die Einsortierung — nicht die Gespräche und Nachrichten darin. Die
 * Plätze dahinter rücken nicht nach: Die Reihenfolge bleibt dieselbe, nur mit einer Lücke.
 */
async function deleteFolder(
  transaction: Transaction,
  folderId: string,
): Promise<"not_found" | undefined> {
  const result = await transaction
    .deleteFrom("inboxFolder")
    .where("id", "=", folderId)
    .executeTakeFirst();

  return result.numDeletedRows === 0n ? "not_found" : undefined;
}

/**
 * Setzt die Reihenfolge — für alle Admins dieselbe.
 *
 * **Die ganze Liste, nicht ein einzelner Schritt.** Wer einen Ordner nach oben schiebt, schickt die
 * Reihenfolge, die er sieht. Hat inzwischen jemand einen Ordner angelegt oder gelöscht, passt sie
 * nicht mehr zu dem, was da ist — dann lieber ein ehrliches Nein als eine Reihenfolge, die keiner
 * so gewollt hat.
 */
async function reorderFolders(
  folderIds: string[],
): Promise<"stale" | undefined> {
  return await db.transaction().execute(async (transaction) => {
    await lockFolders(transaction);

    const existing = await transaction
      .selectFrom("inboxFolder")
      .select("id")
      .execute();

    const known = new Set(existing.map((folder) => folder.id));
    if (
      folderIds.length !== known.size ||
      new Set(folderIds).size !== folderIds.length ||
      folderIds.some((id) => !known.has(id))
    ) {
      return "stale";
    }

    // Die eindeutigen Plätze werden erst am Ende der Transaktion geprüft; dazwischen dürfen zwei
    // Ordner kurz denselben haben.
    for (const [position, id] of folderIds.entries()) {
      // deno-lint-ignore no-await-in-loop -- eine Handvoll Ordner, in einer Transaktion
      await transaction
        .updateTable("inboxFolder")
        .set({ position })
        .where("id", "=", id)
        .execute();
    }

    return undefined;
  });
}

export type FolderItem =
  | {
    id: string;
    kind: "conversation";
    chatGroupId: string;
    /** Das Mitglied, mit dem das Gespräch läuft. */
    username: string | null;
    senderUsername: string | null;
    addedByUsername: string | null;
    addedAt: string;
  }
  | {
    id: string;
    kind: "message";
    chatGroupId: string;
    username: string | null;
    senderUsername: string | null;
    addedByUsername: string | null;
    addedAt: string;
    message: {
      id: string;
      text: string;
      createdAt: string;
      /** Der Name, unter dem die Nachricht steht: das Mitglied oder der Absender. */
      authorUsername: string | null;
      fromTeam: boolean;
    };
  };

/** Was in einem Ordner liegt, zuletzt Eingelegtes zuerst. Leer heißt: Den Ordner gibt es nicht. */
async function listItems(folderId: string): Promise<FolderItem[] | undefined> {
  const folder = await db
    .selectFrom("inboxFolder")
    .select("id")
    .where("id", "=", folderId)
    .executeTakeFirst();

  if (folder === undefined) {
    return undefined;
  }

  const rows = await db
    .selectFrom("inboxFolderItem")
    .leftJoin(
      "chatMessage",
      "chatMessage.id",
      "inboxFolderItem.chatMessageId",
    )
    // Das Gespräch: direkt eingelegt, oder das der eingelegten Nachricht.
    .innerJoin(
      "chatGroup",
      (join) =>
        join.on((eb) =>
          eb.or([
            eb("chatGroup.id", "=", eb.ref("inboxFolderItem.chatGroupId")),
            eb("chatGroup.id", "=", eb.ref("chatMessage.chatGroupId")),
          ])
        ),
    )
    .leftJoin(
      "user as member",
      "member.id",
      "chatGroup.administrationPartnerId",
    )
    .leftJoin("user as sender", "sender.id", "chatGroup.createdBy")
    .leftJoin("user as author", "author.id", "chatMessage.createdBy")
    .leftJoin("user as adder", "adder.id", "inboxFolderItem.addedBy")
    .select([
      "inboxFolderItem.id",
      "inboxFolderItem.addedAt",
      "chatGroup.id as chatGroupId",
      "chatGroup.administrationPartnerId",
      "member.username",
      "sender.username as senderUsername",
      "adder.username as addedByUsername",
      "chatMessage.id as messageId",
      "chatMessage.text",
      "chatMessage.createdAt",
      "chatMessage.createdBy",
      "chatMessage.broadcastId",
      "author.username as authorUsername",
    ])
    .where("inboxFolderItem.inboxFolderId", "=", folderId)
    .orderBy("inboxFolderItem.addedAt", "desc")
    .orderBy("inboxFolderItem.id", "desc")
    .execute();

  return rows.map((row): FolderItem => {
    const common = {
      id: row.id,
      chatGroupId: row.chatGroupId,
      username: row.username,
      senderUsername: row.senderUsername,
      addedByUsername: row.addedByUsername,
      addedAt: row.addedAt,
    };

    if (row.messageId === null) {
      return { ...common, kind: "conversation" };
    }

    return {
      ...common,
      kind: "message",
      message: {
        id: row.messageId,
        text: row.text ?? "",
        createdAt: row.createdAt ?? row.addedAt,
        authorUsername: row.authorUsername,
        // Dieselbe Regel wie im Verlauf: vom Team ist alles, was nicht vom Gegenüber stammt.
        fromTeam: row.broadcastId !== null ||
          row.createdBy !== row.administrationPartnerId,
      },
    };
  });
}

export type AddRefusal =
  | "folder_not_found"
  | "not_in_the_inbox"
  | "already_there";

/**
 * Legt ein Gespräch oder eine Nachricht in einen Ordner.
 *
 * **Nur, was im Postfach liegt.** Ohne die Prüfung der Marke am Gespräch wäre das ein Weg, einen
 * privaten Chat zwischen zwei Mitgliedern in einen Ordner der Administration zu ziehen — und ihn
 * dort zu lesen.
 */
async function addItem(
  folderId: string,
  target: { chatGroupId: string } | { chatMessageId: string },
  administrator: { id: string },
): Promise<{ id: string } | AddRefusal> {
  return await db.transaction().execute(async (transaction) => {
    const folder = await transaction
      .selectFrom("inboxFolder")
      .select("id")
      .where("id", "=", folderId)
      .forShare()
      .executeTakeFirst();

    if (folder === undefined) {
      return "folder_not_found";
    }

    const inInbox = "chatGroupId" in target
      ? await transaction
        .selectFrom("chatGroup")
        .select("id")
        .where("id", "=", target.chatGroupId)
        .where("addressedToAdministration", "=", true)
        .executeTakeFirst()
      : await transaction
        .selectFrom("chatMessage")
        .innerJoin("chatGroup", "chatGroup.id", "chatMessage.chatGroupId")
        .select("chatMessage.id")
        .where("chatMessage.id", "=", target.chatMessageId)
        .where("chatGroup.addressedToAdministration", "=", true)
        .executeTakeFirst();

    if (inInbox === undefined) {
      return "not_in_the_inbox";
    }

    const added = await transaction
      .insertInto("inboxFolderItem")
      .values({
        inboxFolderId: folderId,
        chatGroupId: "chatGroupId" in target ? target.chatGroupId : null,
        chatMessageId: "chatMessageId" in target ? target.chatMessageId : null,
        addedBy: administrator.id,
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning("id")
      .executeTakeFirst();

    return added ?? "already_there";
  });
}

/** Nimmt etwas aus dem Ordner — das Gespräch oder die Nachricht selbst bleibt im Postfach. */
async function removeItem(
  transaction: Transaction,
  itemId: string,
): Promise<"not_found" | undefined> {
  const result = await transaction
    .deleteFrom("inboxFolderItem")
    .where("id", "=", itemId)
    .executeTakeFirst();

  return result.numDeletedRows === 0n ? "not_found" : undefined;
}

/** In welchen Ordnern ein Gespräch und die Nachrichten darin liegen — für die Ansicht am Verlauf. */
async function placesOf(chatGroupId: string): Promise<{
  conversation: Array<{ itemId: string; folderId: string }>;
  messages: Array<{ itemId: string; folderId: string; messageId: string }>;
}> {
  const rows = await db
    .selectFrom("inboxFolderItem")
    .leftJoin(
      "chatMessage",
      "chatMessage.id",
      "inboxFolderItem.chatMessageId",
    )
    .select([
      "inboxFolderItem.id as itemId",
      "inboxFolderItem.inboxFolderId as folderId",
      "inboxFolderItem.chatGroupId",
      "inboxFolderItem.chatMessageId as messageId",
    ])
    .where((eb) =>
      eb.or([
        eb("inboxFolderItem.chatGroupId", "=", chatGroupId),
        eb("chatMessage.chatGroupId", "=", chatGroupId),
      ])
    )
    .execute();

  return {
    conversation: rows
      .filter((row) => row.chatGroupId !== null)
      .map((row) => ({ itemId: row.itemId, folderId: row.folderId })),
    messages: rows.flatMap((row) =>
      row.messageId === null ? [] : [{
        itemId: row.itemId,
        folderId: row.folderId,
        messageId: row.messageId,
      }]
    ),
  };
}

export const AdminInboxFolderService = {
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  reorderFolders,
  listItems,
  addItem,
  removeItem,
  placesOf,
};
