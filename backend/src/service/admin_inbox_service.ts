import { generate as generateUuidV7 } from "@std/uuid/v7";
import { db, type Transaction } from "@/src/database/client.ts";
import {
  type ChatMessage,
  ChatMessageService,
} from "@/src/service/chat_message_service.ts";
import { ChatGroupService } from "@/src/service/chat_group_service.ts";
import { theAdministration } from "@/src/service/root_admin_service.ts";

/**
 * Das Postfach der Administration: ein Ort für alles, was an sie gerichtet ist.
 *
 * **Ein Verlauf je Mitglied und Absender.** Bis vor kurzem legte jede Rundmail für jeden Empfänger
 * einen eigenen Faden an — zehn Ankündigungen waren zehn Gespräche mit je einer Nachricht. Jetzt
 * sammelt sich alles in einem: Ankündigungen, Antworten darauf, und später Nachrichten, die jemand
 * von sich aus schickt. Je Absender getrennt, weil eine Kunstfigur ein anderer Gesprächspartner
 * ist und der Name mitten im Verlauf nicht wechseln darf.
 *
 * **Nur die Administration, lesen wie schreiben.** Mitglieder wissen, wer die Administration ist;
 * wer ihr schreibt, weiß, an welchen Kreis er sich wendet, und rechnet nicht damit, dass die
 * Moderation mitliest. Bei einer Beschwerde über eine Moderatorin ist das nicht bloß unangenehm,
 * sondern der Grund, aus dem es an die Administration ging.
 */

/**
 * Wie viel von der letzten Nachricht in der Liste steht.
 *
 * Genug, um zu erkennen, worum es geht, und zu wenig, um das Aufklappen zu ersetzen — sonst liest
 * man die halbe Nachricht in einer Liste, die dafür nicht gemacht ist.
 */
const EXCERPT_LENGTH = 140;

export type InboxConversation = {
  chatGroupId: string;
  /** Wer schreibt. Null, wenn das Konto inzwischen weg ist — das Gespräch überlebt es. */
  username: string | null;
  /** Unter welchem Namen die Plattform in diesem Faden spricht. */
  senderUsername: string | null;
  /** Der Anfang der letzten Nachricht des Mitglieds. */
  excerpt: string;
  /** Wann das **Mitglied** zuletzt geschrieben hat. Siehe unten, warum nicht das Gespräch. */
  lastMessageAt: string;
  /**
   * Ob die letzte Nachricht im Gespräch vom Mitglied stammt.
   *
   * **Das ist „offen" ohne einen Zustand, den jemand pflegen muss.** Ein Merker „erledigt" wäre
   * eine zweite Wahrheit neben dem Verlauf, und wer ihn zu setzen vergisst, hat eine Liste, die
   * lügt. Hier fällt die Antwort aus dem Verlauf selbst heraus: Steht die letzte Nachricht vom
   * Mitglied, hat noch niemand geantwortet.
   *
   * Der Preis ist ehrlich zu benennen: Ein „Danke!", das keine Antwort braucht, bleibt offen, bis
   * jemand antwortet — oder es später in einen Ordner legt.
   */
  awaitingReply: boolean;
};

/**
 * Alles, was an die Administration gerichtet ist — die jüngste Nachricht des Mitglieds zuerst.
 *
 * **Sortiert nach dem Mitglied, nicht nach dem Gespräch.** `chat_group.last_activity_at` setzt
 * jede Nachricht neu, auch die eigene: Ein Gespräch rutschte dann nach oben, weil *wir* geantwortet
 * haben — was wir ohnehin wissen. Und der Zeitpunkt in der Zeile stünde über einem Auszug, der
 * immer vom Mitglied stammt, also über einem Text von gestern.
 *
 * **Gespräche ohne eine einzige Nachricht des Mitglieds stehen nicht darin.** Jeder Empfänger einer
 * Rundmail hat einen Faden — das *ist* die Zustellung. Sie alle aufzulisten hieße, den
 * Empfängerkreis noch einmal zu zeigen und die paar echten Nachrichten darin zu verstecken.
 *
 * **Und nicht, was die Administration sich selbst schreibt.** Der Ur-Admin bekommt seine eigene
 * Rundmail wie jeder andere — an der Zustellung ändert das nichts —, aber ein Faden, in dem er
 * sich selbst gegenübersitzt, ist keine Arbeit: Da ist niemand, dem man antworten könnte. Er stand
 * prompt als „offen" in der Liste, sobald jemand als Admin darin schrieb.
 */
async function listConversations(): Promise<InboxConversation[]> {
  const rows = await db
    .selectFrom("chatGroup")
    .innerJoin("chatMessage", "chatMessage.chatGroupId", "chatGroup.id")
    .innerJoin("user", "user.id", "chatMessage.createdBy")
    .leftJoin("user as sender", "sender.id", "chatGroup.createdBy")
    .select([
      "chatGroup.id as chatGroupId",
      "user.username",
      "sender.username as senderUsername",
      "chatMessage.id as messageId",
      "chatMessage.text",
      "chatMessage.createdAt",
    ])
    .where("chatGroup.addressedToAdministration", "=", true)
    // Vom Mitglied: Es ist das Gegenüber des Fadens, und die Plattformseite sitzt nicht darin.
    .whereRef("chatMessage.createdBy", "=", "chatGroup.administrationPartnerId")
    // **Und keine Ankündigung.** Die trägt eine Rundmail-Kennung, und sie stammt vom Absender —
    // der im eigenen Faden das Mitglied sein kann, wenn er an die Administration schrieb. Ohne
    // diese Bedingung zählte seine Ankündigung als Antwort auf sich selbst.
    //
    // Früher stand hier „nicht die erste Nachricht des Gesprächs", als Unterabfrage. Das war die
    // brüchige Fassung derselben Aussage, und sie stimmte nur, solange ein Faden genau eine
    // Rundmail trug.
    .where("chatMessage.broadcastId", "is", null)
    .where((eb) =>
      eb.or([
        eb("chatGroup.createdBy", "is", null),
        eb(
          "chatGroup.createdBy",
          "!=",
          eb.ref("chatGroup.administrationPartnerId"),
        ),
      ])
    )
    .orderBy("chatMessage.createdAt", "desc")
    .execute();

  // Die jüngste Nachricht des Mitglieds je Gespräch: sortiert ist schon, also gewinnt der erste
  // Treffer. Dieselbe Sortierung ordnet damit beides — die Auswahl und die Liste.
  const newest = new Map<string, typeof rows[number]>();

  for (const row of rows) {
    if (!newest.has(row.chatGroupId)) {
      newest.set(row.chatGroupId, row);
    }
  }

  if (newest.size === 0) {
    return [];
  }

  // Die jeweils letzte Nachricht, die etwas beantworten kann — gleich von welcher Seite. Stimmt sie
  // mit der des Mitglieds überein, ist das Gespräch offen.
  //
  // **Ohne Rundmails.** Hier stand „die allerletzte Nachricht", und eine Rundmail landet im selben
  // Faden: Eine offene Frage stand still als beantwortet da, sobald dieselbe Person die nächste
  // Ankündigung bekam. Auf der Beta mit echten Rundmails gemessen. Eine Ankündigung an alle ist
  // keine Antwort an einen.
  const latest = await db
    .selectFrom("chatMessage")
    .select(["chatGroupId", "id"])
    .distinctOn("chatGroupId")
    .where("chatGroupId", "in", [...newest.keys()])
    .where("broadcastId", "is", null)
    .orderBy("chatGroupId")
    .orderBy("id", "desc")
    .execute();

  const latestByChat = new Map(latest.map((row) => [row.chatGroupId, row.id]));

  return [...newest.values()].map((row) => ({
    chatGroupId: row.chatGroupId,
    username: row.username,
    senderUsername: row.senderUsername,
    excerpt: row.text.length > EXCERPT_LENGTH
      ? `${row.text.slice(0, EXCERPT_LENGTH).trimEnd()} …`
      : row.text,
    lastMessageAt: row.createdAt,
    awaitingReply: latestByChat.get(row.chatGroupId) === row.messageId,
  }));
}

export type InboxMessage = {
  id: string;
  text: string;
  createdAt: string;
  /** Der Name nach außen: das Mitglied, oder der Absender, unter dem geschrieben wurde. */
  username: string | null;
  /** Von der Teamseite — also eine Ankündigung oder eine Antwort der Administration. */
  fromTeam: boolean;
  /**
   * Eine Rundmail, keine Antwort darauf.
   *
   * **Ohne diese Unterscheidung liest sich der Verlauf falsch herum.** Beide standen als „Team",
   * und die Ankündigung sah damit aus wie eine Antwort der Administration: eine Antwort vor der
   * Frage, ohne Verfasser. Genau so ist sie beim Durchklicken gelesen worden.
   */
  isAnnouncement: boolean;
  /** Der Betreff der Rundmail, leer bei allem anderen. */
  subject: string | null;
  /** Wer wirklich getippt hat, wenn `username` eine Maske ist. Sonst leer. */
  writtenByUsername: string | null;
  /**
   * Wer die Rundmail zurückgezogen hat und wann — nur an Ankündigungen, und nur dann. Der Text
   * sagt es ohnehin; wer und wann ist, was das Team darüber hinaus wissen will.
   */
  retractedByUsername: string | null;
  retractedAt: string | null;
};

export type InboxConversationDetail = {
  chatGroupId: string;
  username: string | null;
  senderUsername: string | null;
  messages: InboxMessage[];
};

/**
 * Ein Gespräch aus dem Postfach — oder nichts, wenn es nicht hineingehört.
 *
 * **Die Marke wird mitgeprüft, nicht nur die Kennung.** Ohne sie wäre das ein Schlüssel, mit dem
 * die Administration jedes beliebige Gespräch der Plattform aufmachen könnte, private Chats
 * zwischen zwei Mitgliedern eingeschlossen.
 *
 * **`written_by` wird mit ausgelesen.** Hier stand einmal das Gegenteil, mit der Begründung, die
 * Angabe gehöre zur Liste der gesendeten Rundmails. Das galt, solange nur Ankündigungen im Faden
 * standen — die tragen ihren Verfasser auf der Veröffentlichung. Seit die Administration antwortet,
 * gibt es Nachrichten ohne Veröffentlichung, und für die stand die Auskunft nirgends: Die
 * Nachvollziehbarkeit, für die die Trennung zwischen Maske und Mensch gebaut wurde, wäre eine in
 * der Datenbank gewesen.
 */
async function readConversation(
  chatGroupId: string,
): Promise<InboxConversationDetail | undefined> {
  const chat = await db
    .selectFrom("chatGroup")
    .leftJoin("user", "user.id", "chatGroup.administrationPartnerId")
    .leftJoin("user as sender", "sender.id", "chatGroup.createdBy")
    .select([
      "chatGroup.id",
      "chatGroup.administrationPartnerId",
      "user.username",
      "sender.username as senderUsername",
    ])
    .where("chatGroup.id", "=", chatGroupId)
    .where("chatGroup.addressedToAdministration", "=", true)
    .executeTakeFirst();

  if (chat === undefined) {
    return undefined;
  }

  const messages = await db
    .selectFrom("chatMessage")
    .leftJoin("user", "user.id", "chatMessage.createdBy")
    .leftJoin("user as writer", "writer.id", "chatMessage.writtenBy")
    .leftJoin("broadcast", "broadcast.id", "chatMessage.broadcastId")
    .leftJoin("publication", "publication.id", "broadcast.publicationId")
    .leftJoin("user as retractor", "retractor.id", "publication.retractedBy")
    .select([
      "chatMessage.id",
      "chatMessage.text",
      "chatMessage.createdAt",
      "chatMessage.subject",
      "chatMessage.broadcastId",
      "chatMessage.createdBy",
      "user.username",
      "writer.username as writtenByUsername",
      "retractor.username as retractedByUsername",
      "publication.retractedAt",
    ])
    .where("chatMessage.chatGroupId", "=", chatGroupId)
    // Kennungen sind uuidv7 und tragen ihre Entstehungszeit, also ist das die Lesereihenfolge.
    .orderBy("chatMessage.id", "asc")
    .execute();

  return {
    chatGroupId: chat.id,
    username: chat.username,
    senderUsername: chat.senderUsername,
    messages: messages.map((message) => ({
      id: message.id,
      text: message.text,
      createdAt: message.createdAt,
      username: message.username,
      // Von der Teamseite ist alles, was nicht vom Gegenüber des Fadens stammt. Der Absender kann
      // im eigenen Faden selbst das Gegenüber sein — dann ist seine Ankündigung trotzdem eine.
      fromTeam: message.broadcastId !== null ||
        message.createdBy !== chat.administrationPartnerId,
      isAnnouncement: message.broadcastId !== null,
      subject: message.subject,
      writtenByUsername: message.writtenByUsername,
      retractedByUsername: message.retractedByUsername,
      retractedAt: message.retractedAt,
    })),
  };
}

export type InboxReplyResult =
  | { ok: true; message: ChatMessage; memberIds: string[] }
  | { ok: false; reason: "not-found" };

/**
 * Die Administration antwortet in einem Gespräch des Postfachs.
 *
 * **Nach außen antwortet der Absender, nicht der Mensch.** `created_by` wird vom Gespräch abgelesen
 * und nicht neu bestimmt: Dort steht schon der Name, unter dem dieser Faden läuft. Ihn hier noch
 * einmal auszurechnen hieße, dieselbe Frage zweimal zu beantworten — und beim zweiten Mal womöglich
 * anders, wenn die Freigabe des Absenders inzwischen zurückgenommen wurde. Mitten in einem Verlauf
 * den Namen zu wechseln wäre für das Mitglied ein anderer Gesprächspartner. Genau deshalb ist ein
 * Faden je Absender getrennt und nicht alles in einem.
 *
 * **`written_by` trägt den Menschen.** Ohne die Spalte wäre es eine Maske, hinter der niemand
 * steht, und die Frage „wer hat das geschrieben" hätte auf dieser Plattform keine Antwort.
 *
 * **Das Mitglied merkt nichts davon.** Es sieht eine Antwort in seinem Postfach, von dem Namen, den
 * es kennt, in einem gewöhnlichen Gespräch.
 */
async function reply(
  chatGroupId: string,
  text: string,
  writtenBy: string,
): Promise<InboxReplyResult> {
  const chat = await db
    .selectFrom("chatGroup")
    .select(["id", "createdBy", "administrationPartnerId"])
    .where("id", "=", chatGroupId)
    .where("addressedToAdministration", "=", true)
    .executeTakeFirst();

  if (chat === undefined) {
    return { ok: false, reason: "not-found" };
  }

  // **Ohne Absender keine Antwort.** `chat_group.created_by` wird leer, wenn das Konto der
  // Kunstfigur gelöscht wird. Trotzdem zu schreiben ergäbe eine Nachricht ohne Namen mitten im
  // Verlauf — für das Mitglied jemand Drittes. Lieber ein ehrliches Nein an die Administration.
  //
  // **Und ohne Gegenüber auch nicht.** Löscht sich das Mitglied, überlebt der Faden als Beleg;
  // hineinzuschreiben hieße, an niemanden zu schreiben. Das ist das Gegenstück zum Fall darüber,
  // und es fehlte.
  if (chat.createdBy === null || chat.administrationPartnerId === null) {
    return { ok: false, reason: "not-found" };
  }

  const message = await ChatMessageService.insertMessage(
    chat.id,
    text,
    chat.createdBy,
    { writtenBy },
  );

  return {
    ok: true,
    message,
    memberIds: await ChatGroupService.selectMemberIds(chat.id),
  };
}

/**
 * Die Fäden dieser Mitglieder mit diesem Absender — gefunden, wo es sie gibt, sonst angelegt.
 *
 * **Eine Stelle, zwei Wege.** Hier kommt die Zustellung einer Rundmail herein, und hier kommt das
 * Mitglied herein, das die Administration von sich aus anschreibt. Beide meinen denselben Faden,
 * und das ist der ganze Punkt: Wer erst schreibt und später eine Rundmail bekommt, hat nicht zwei
 * Gespräche. Zweimal geschrieben wäre es zweimal zu pflegen, und beim nächsten Umbau stimmte eines
 * davon nicht mehr.
 *
 * **Ohne Absender wird nichts wiederverwendet.** `resolveSender` liefert leer, wenn es gerade
 * keinen Ur-Admin gibt — im laufenden Betrieb nie, im Testlauf für die Dauer der Hochfahr-Tests.
 * „Leer" ist dann aber kein Absender, sondern das Fehlen eines Namens, und zwei Fäden ohne Namen
 * sind nicht derselbe Gesprächspartner. Wer sie zusammenlegt, hängt seine Ankündigung in den Faden
 * einer fremden Kunstfigur — genau das ist passiert, und es kam als zwei rote Tests in zwei
 * Dateien an, deren eigener Code stimmte.
 *
 * Läuft in der Transaktion des Aufrufers: Bei einer Rundmail hängt die Zustellung daran, und ein
 * Faden ohne die Nachricht darin wäre schlimmer als keiner.
 */
async function findOrCreateThreads(
  transaction: Transaction,
  sender: { id: string; username: string } | null,
  memberIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  if (memberIds.length === 0) {
    return new Map();
  }

  const existing = sender === null ? [] : await transaction
    .selectFrom("chatGroup")
    .select(["id", "administrationPartnerId"])
    .where("addressedToAdministration", "=", true)
    .where("administrationPartnerId", "in", memberIds)
    .where("createdBy", "=", sender.id)
    .execute();

  const byMember = new Map(
    existing.flatMap((chat) =>
      chat.administrationPartnerId === null
        ? []
        : [[chat.administrationPartnerId, chat.id] as const]
    ),
  );

  // **Die Kennungen entstehen hier, nicht in der Datenbank.** Mitgliedschaft und Nachricht hängen
  // an ihnen, und sie aus einem `RETURNING` zurückzulesen hieße, sich auf eine Reihenfolge zu
  // verlassen, die PostgreSQL nirgends zusagt.
  const fresh = memberIds
    .filter((memberId) => !byMember.has(memberId))
    .map((memberId) => ({ id: generateUuidV7(), memberId }));

  if (fresh.length === 0) {
    return byMember;
  }

  // **`DO NOTHING`, weil Suchen und Anlegen zusammen nicht atomar sind.**
  //
  // Zwischen der Abfrage oben und dieser Anweisung kann eine zweite Zustellung mit demselben
  // Absender denselben Faden angelegt haben — beide sehen „gibt es nicht", beide legen an, und eine
  // fliegt in den Eindeutigkeits-Index. Im Testlauf ist es prompt passiert; im Betrieb reichen zwei
  // Rundmails, die der Zeitgeber im selben Moment freigibt.
  //
  // Der Index ist teilweise, also muss seine Bedingung hier mitstehen: Ohne sie weiß PostgreSQL
  // nicht, welchen Konflikt es übergehen soll.
  const created = await transaction
    .insertInto("chatGroup")
    .values(fresh.map((chat) => ({
      id: chat.id,
      // Der Name, unter dem geschrieben wird — nicht der Betreff, denn ein Faden kann nicht zehn
      // tragen. Bleibt stehen, wenn die Kunstfigur später umbenannt wird: selten, und beim
      // nächsten Blick zu sehen, während ein Titel, der sich still ändert, niemandem auffällt.
      title: sender?.username ?? "Administration",
      createdBy: sender?.id ?? null,
      administrationPartnerId: chat.memberId,
      // **Was hier hineingeschrieben wird, geht an die Administration.** Die Marke wird beim
      // Entstehen gesetzt und nicht später abgeleitet: Die Plattformseite sitzt mit Absicht nicht
      // im Gespräch, und „wer sitzt drin" änderte sich ohnehin, sobald jemand austritt.
      addressedToAdministration: true,
    })))
    .onConflict((conflict) =>
      conflict
        .columns(["administrationPartnerId", "createdBy"])
        .where("addressedToAdministration", "=", true)
        .where("administrationPartnerId", "is not", null)
        .doNothing()
    )
    .returning(["id", "administrationPartnerId"])
    .execute();

  // **Beigetreten, nicht eingeladen** — und das ist es, was den Weg des Mitglieds überhaupt
  // möglich macht. Bei Admin nimmt niemand an; hier gibt es nichts anzunehmen, weil das Mitglied
  // von Anfang an drin sitzt. Die Nachrichtenroute prüft `joined` und braucht dafür keine Zeile
  // Sonderbehandlung.
  //
  // Nur für die Fäden, die wirklich aus *dieser* Anweisung stammen: Wer an einem Konflikt
  // vorbeigegangen ist, hat seine Mitgliedschaft schon.
  if (created.length > 0) {
    await transaction
      .insertInto("userInChatGroup")
      .values(created.map((chat) => ({
        chatGroupId: chat.id,
        userId: chat.administrationPartnerId as string,
        status: "joined" as const,
        joinedAt: new Date().toISOString(),
      })))
      .execute();
  }

  // **Noch einmal nachsehen statt anzunehmen.** Was der Konflikt übergangen hat, steht jetzt in der
  // Datenbank — angelegt von der anderen Zustellung —, und nur eine zweite Abfrage weiß, unter
  // welcher Kennung. Sich hier auf die selbst erzeugten Kennungen zu verlassen hiesse, die Nachricht
  // in einen Faden zu schreiben, den es nicht gibt.
  const all = sender === null ? created : await transaction
    .selectFrom("chatGroup")
    .select(["id", "administrationPartnerId"])
    .where("addressedToAdministration", "=", true)
    .where("administrationPartnerId", "in", memberIds)
    .where("createdBy", "=", sender.id)
    .execute();

  for (const chat of all) {
    if (chat.administrationPartnerId !== null) {
      byMember.set(chat.administrationPartnerId, chat.id);
    }
  }

  return byMember;
}

export type OpenedThread =
  | { ok: true; chatGroupId: string }
  | { ok: false; reason: "no_administration" | "not_a_fresh_chat" };

/**
 * Der Faden dieses Mitglieds mit der Administration, aufgeschlagen — und die leere Hülle weg.
 *
 * **Das ist der Weg, den ein Mitglied nimmt, ohne es zu merken.** Für es ändert sich nichts: Es
 * legt ein Gespräch an und benennt Admin, wie bei jedem anderen Konto auch. Nur nimmt bei Admin
 * niemand an — dort meldet sich niemand an. Also wird aus der Einladung keine Einladung, sondern
 * der Faden, der die Unterhaltung mit der Administration *ist*. Liegen dort schon Rundmails, liegen
 * sie gleich mit darin.
 *
 * **Die Hülle geht in derselben Transaktion mit.** Das Gespräch, das Sekunden vorher entstand, hat
 * ein einziges Mitglied und keine Nachricht; bliebe es liegen, hätte das Mitglied einen leeren
 * Faden mit einem Titel, der nirgends hinführt. Geprüft wird beides vorher — der Aufrufer allein
 * darin, nichts geschrieben —, sonst wird gar nicht erst weitergeleitet.
 */
async function openThreadInsteadOfInviting(
  memberId: string,
  huskId: string,
): Promise<OpenedThread> {
  const administration = await theAdministration();

  if (administration === undefined) {
    return { ok: false, reason: "no_administration" };
  }

  return await db.transaction().execute(async (transaction) => {
    // **Nur eine frische, leere Hülle wird weitergeleitet.** Steht schon jemand anderes darin oder
    // wurde darin geschrieben, ist es ein Raum und keine angefangene Nachricht — dann wird
    // abgewiesen statt umgeleitet, und der Aufrufer behält, was er hat.
    const others = await transaction
      .selectFrom("userInChatGroup")
      .select("userId")
      .where("chatGroupId", "=", huskId)
      .where("userId", "!=", memberId)
      .executeTakeFirst();

    const written = await transaction
      .selectFrom("chatMessage")
      .select("id")
      .where("chatGroupId", "=", huskId)
      .executeTakeFirst();

    if (others !== undefined || written !== undefined) {
      return { ok: false, reason: "not_a_fresh_chat" } as const;
    }

    const threads = await findOrCreateThreads(transaction, administration, [
      memberId,
    ]);

    const chatGroupId = threads.get(memberId);

    if (chatGroupId === undefined) {
      return { ok: false, reason: "no_administration" } as const;
    }

    await transaction.deleteFrom("chatGroup").where("id", "=", huskId)
      .execute();

    return { ok: true, chatGroupId } as const;
  });
}

export const AdminInboxService = {
  listConversations,
  readConversation,
  reply,
  findOrCreateThreads,
  openThreadInsteadOfInviting,
};
