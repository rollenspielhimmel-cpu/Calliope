import {
  type ChatMessage,
  ChatMessageService,
} from "@/src/service/chat_message_service.ts";
import { ChatGroupService } from "@/src/service/chat_group_service.ts";
import { db } from "@/src/database/client.ts";

/**
 * Die Antworten auf eine Rundmail.
 *
 * **Sie hängen an der Rundmail, nicht an einem Konto.** Das ist der Punkt des ganzen Entwurfs:
 * Antwortete jemand dem Ur-Admin, läge die Antwort in einem Postfach, in das niemand sieht;
 * antwortete er dem Weihnachtsmann, läge sie in einem Postfach, das es nur an Weihnachten gibt.
 * Also liest das Team sie hier — über die Rundmail, zu der sie gehören.
 *
 * **Lesen darf die ganze Moderation, antworten nur die Administration.** Das erste steht in den
 * Leseabfragen dieser Datei, das zweite in `reply` und der Route daneben.
 *
 * Für das Mitglied sieht nichts davon anders aus als ein gewöhnliches Gespräch: Es schreibt in
 * seinen Chat, und was zurückkommt, kommt von dem Namen, der auf der Rundmail stand.
 */

export type BroadcastReply = {
  chatGroupId: string;
  /** Wer geantwortet hat. Null, wenn das Konto inzwischen weg ist — das Gespräch überlebt es. */
  username: string | null;
  /**
   * Wann das **Mitglied** zuletzt geschrieben hat.
   *
   * **Nicht die letzte Aktivität des Gesprächs**, obwohl die danebenliegt und billiger wäre.
   * `chat_group.last_activity_at` setzt jede Nachricht neu, auch die des Teams — und dann stünde in
   * der Zeile „vor zwei Minuten" über einem Auszug von gestern, weil der Auszug immer vom Mitglied
   * stammt. Zwei Angaben aus zwei Quellen, die aussehen, als gehörten sie zusammen.
   *
   * Und die Sortierung liefe verkehrt herum: Ein Gespräch rutschte nach oben, weil *wir* geantwortet
   * haben. Dass wir geantwortet haben, wissen wir. Die Liste beantwortet „wer hat geschrieben", also
   * sortiert sie danach.
   */
  lastReplyAt: string;
  /** Der Anfang der letzten Antwort des Mitglieds, damit die Liste etwas sagt. */
  excerpt: string;
};

/**
 * Wie viel von der letzten Antwort in der Liste steht.
 *
 * Genug, um zu erkennen, worum es geht, und zu wenig, um das Aufklappen zu ersetzen — sonst liest
 * man die halbe Antwort in einer Liste, die dafür nicht gemacht ist.
 */
const EXCERPT_LENGTH = 140;

/**
 * Wer auf diese Rundmail geantwortet hat, zuletzt Geschriebenes zuerst.
 *
 * **Nur Gespräche mit einer echten Antwort.** Jeder Empfänger hat ein Gespräch — das ist die
 * Zustellung —, und sie alle aufzulisten hieße, die Empfängerliste noch einmal zu zeigen und die
 * paar Antworten darin zu verstecken. Eine Antwort ist deshalb: von jemandem, der im Gespräch
 * sitzt, und nicht die erste Nachricht. Beide Hälften werden gebraucht, siehe unten.
 *
 * Nach letzter Aktivität sortiert und ohne Zähler: „wie viele haben geantwortet" ist keine Zahl,
 * auf die jemand handelt, und Zähler kommen in dieser Oberfläche nicht vor.
 */
async function listReplies(broadcastId: string): Promise<BroadcastReply[]> {
  const rows = await db
    .selectFrom("chatGroup")
    .innerJoin("chatMessage", "chatMessage.chatGroupId", "chatGroup.id")
    .innerJoin("user", "user.id", "chatMessage.createdBy")
    .leftJoin("userInChatGroup", (join) =>
      join
        .onRef("userInChatGroup.chatGroupId", "=", "chatGroup.id")
        .onRef("userInChatGroup.userId", "=", "chatMessage.createdBy"))
    .select([
      "chatGroup.id as chatGroupId",
      "user.username",
      "chatMessage.text",
      "chatMessage.createdAt",
    ])
    .where("chatGroup.broadcastId", "=", broadcastId)
    // Vom Mitglied, nicht von der Teamseite.
    .where("userInChatGroup.userId", "is not", null)
    // **Und nicht die Rundmail selbst.**
    //
    // „Wer im Gespräch sitzt, ist das Mitglied" allein reicht nicht, und der Fall, an dem das
    // auffiel, ist der häufigste: Der Ur-Admin schickt an die Administration, gehört also selbst
    // zum Empfängerkreis — und in *seinem* Gespräch stammt die Rundmail von jemandem, der darin
    // sitzt. Sie zählte prompt als Antwort auf sich selbst.
    //
    // Die erste Nachricht eines Rundmail-Gesprächs ist immer die Rundmail; Kennungen sind uuidv7
    // und tragen ihre Entstehungszeit, also ist „die kleinste" auch „die erste".
    //
    // Über Sortierung und nicht über `min`: PostgreSQL kennt kein `min(uuid)`, was hier als 500
    // ankam statt als Übersetzungsfehler.
    .where(({ eb, selectFrom }) =>
      eb(
        "chatMessage.id",
        "!=",
        selectFrom("chatMessage as first")
          .select("first.id")
          .whereRef("first.chatGroupId", "=", "chatGroup.id")
          .orderBy("first.id", "asc")
          .limit(1),
      )
    )
    // Nur nach der Nachricht, nicht mehr nach dem Gespräch: Weil unten je Gespräch der erste
    // Treffer gewinnt, ordnet dieselbe Sortierung beides — die Auswahl der jüngsten Antwort und
    // die Reihenfolge der Gespräche untereinander.
    .orderBy("chatMessage.createdAt", "desc")
    .execute();

  // Eine Zeile je Gespräch, und zwar die neueste: Die Abfrage liefert jede Antwort, sortiert ist
  // sie schon, also gewinnt der erste Treffer je Gespräch.
  const newest = new Map<string, BroadcastReply>();

  for (const row of rows) {
    if (newest.has(row.chatGroupId)) {
      continue;
    }

    newest.set(row.chatGroupId, {
      chatGroupId: row.chatGroupId,
      username: row.username,
      lastReplyAt: row.createdAt,
      excerpt: row.text.length > EXCERPT_LENGTH
        ? `${row.text.slice(0, EXCERPT_LENGTH).trimEnd()} …`
        : row.text,
    });
  }

  return [...newest.values()];
}

export type BroadcastConversationMessage = {
  id: string;
  text: string;
  createdAt: string;
  /** Der Name nach außen: das Mitglied, oder der Absender, unter dem die Rundmail lief. */
  username: string | null;
  /** Vom Team geschrieben — also die Rundmail selbst oder eine Antwort der Administration. */
  fromTeam: boolean;
  /**
   * Wer wirklich getippt hat, wenn `username` eine Maske ist. Sonst leer.
   *
   * Leer bleibt es bei jeder Nachricht des Mitglieds — dort ist `username` die Wahrheit — und auch
   * bei der Rundmail selbst: Deren Verfasser steht auf der Veröffentlichung und wird unter
   * „Gesendete" gezeigt, und dieselbe Angabe zweimal zu führen heißt, sie irgendwann an einer
   * Stelle zu vergessen. Gesetzt ist es genau bei den Antworten der Administration, denn die haben
   * keine Veröffentlichung, die den Namen tragen könnte.
   */
  writtenByUsername: string | null;
};

export type BroadcastConversation = {
  chatGroupId: string;
  /** Wessen Gespräch das ist. */
  username: string | null;
  messages: BroadcastConversationMessage[];
};

/**
 * Ein Gespräch, wie das Team es liest — oder nichts, wenn es zu dieser Rundmail nicht gehört.
 *
 * **Die Rundmail wird mitgeprüft, nicht nur das Gespräch.** Ohne sie wäre das eine Kennung, mit der
 * jedes Team-Mitglied jedes beliebige Gespräch der Plattform aufmachen könnte — auch private Chats
 * zwischen zwei Mitgliedern, die niemanden etwas angehen.
 *
 * **`written_by` wird mit ausgelesen.** Hier stand einmal das Gegenteil, mit der Begründung, die
 * Angabe gehöre in die Liste der gesendeten Rundmails, wo `written_by` und `approved_by` ohnehin
 * stehen. Das galt, solange nur die Rundmail selbst im Gespräch stand — die trägt ihren Verfasser
 * auf der Veröffentlichung. Seit die Administration antwortet, gibt es Nachrichten ohne
 * Veröffentlichung, und für die stand die Auskunft nirgends: Die Nachvollziehbarkeit, für die die
 * Trennung zwischen Maske und Mensch überhaupt gebaut wurde, war dann eine in der Datenbank.
 *
 * Doppelt wird dabei nichts: Bei der Rundmail selbst ist die Spalte leer, gesetzt ist sie genau bei
 * den Antworten.
 */
async function readConversation(
  broadcastId: string,
  chatGroupId: string,
): Promise<BroadcastConversation | undefined> {
  const chat = await db
    .selectFrom("chatGroup")
    .leftJoin("userInChatGroup", "userInChatGroup.chatGroupId", "chatGroup.id")
    .leftJoin("user", "user.id", "userInChatGroup.userId")
    .select(["chatGroup.id", "user.username"])
    .where("chatGroup.id", "=", chatGroupId)
    .where("chatGroup.broadcastId", "=", broadcastId)
    .executeTakeFirst();

  if (chat === undefined) {
    return undefined;
  }

  const messages = await db
    .selectFrom("chatMessage")
    .leftJoin("user", "user.id", "chatMessage.createdBy")
    .leftJoin("user as writer", "writer.id", "chatMessage.writtenBy")
    .leftJoin("userInChatGroup", (join) =>
      join
        .onRef("userInChatGroup.chatGroupId", "=", "chatMessage.chatGroupId")
        .onRef("userInChatGroup.userId", "=", "chatMessage.createdBy"))
    .select([
      "chatMessage.id",
      "chatMessage.text",
      "chatMessage.createdAt",
      "user.username",
      "writer.username as writtenByUsername",
      "userInChatGroup.userId as memberId",
    ])
    .where("chatMessage.chatGroupId", "=", chatGroupId)
    // Kennungen sind uuidv7 und tragen ihre Entstehungszeit, also ist das die Lesereihenfolge.
    .orderBy("chatMessage.id", "asc")
    .execute();

  // Die erste ist immer die Rundmail — siehe `listReplies`. Sie eigens zu merken ist nötig, weil
  // der Absender im eigenen Gespräch selbst Mitglied sein kann und die Nachricht sonst aussähe wie
  // eine Antwort.
  const [broadcastMessage] = messages;

  return {
    chatGroupId: chat.id,
    username: chat.username,
    messages: messages.map((message) => ({
      id: message.id,
      text: message.text,
      createdAt: message.createdAt,
      username: message.username,
      // Von der Teamseite: die Rundmail selbst, oder eine Nachricht von jemandem, der im Gespräch
      // gar nicht sitzt — das ist die Antwort der Administration.
      fromTeam: message.id === broadcastMessage?.id ||
        message.memberId === null,
      writtenByUsername: message.writtenByUsername,
    })),
  };
}

export type BroadcastReplyResult =
  | { ok: true; message: ChatMessage; memberIds: string[] }
  | { ok: false; reason: "not-found" };

/**
 * Die Administration antwortet in einem Rundmail-Gespräch.
 *
 * **Nach außen antwortet der Absender, nicht der Mensch.** `created_by` wird vom Gespräch
 * abgelesen und nicht neu bestimmt: Dort steht schon der Absender, unter dem die Rundmail lief.
 * Ihn hier noch einmal auszurechnen hieße, dieselbe Frage zweimal zu beantworten — und beim
 * zweiten Mal womöglich anders, wenn die Freigabe des Absenders inzwischen zurückgenommen wurde.
 * Mitten in einem Verlauf den Namen zu wechseln wäre für das Mitglied ein anderer Gesprächspartner.
 *
 * **`written_by` trägt den Menschen.** Das ist keine Höflichkeit gegenüber der Buchhaltung: Ohne
 * die Spalte wäre eine Maske, hinter der niemand steht, und die Frage „wer hat das geschrieben"
 * hätte auf dieser Plattform keine Antwort. Gelesen wird sie hier nicht — siehe `readConversation`.
 *
 * **Das Mitglied merkt nichts davon.** Es sieht eine Antwort in seinem Postfach, von dem Namen, der
 * auf der Rundmail stand, in einem gewöhnlichen Gespräch. Wer wirklich getippt hat, erfährt es
 * nicht, und genau das ist der Sinn der Kunstfigur.
 *
 * Die Rundmail steht in der Adresse, aus demselben Grund wie beim Lesen: Sonst wäre das eine
 * Kennung, mit der die Administration in jedes Gespräch der Plattform hineinschreiben könnte.
 */
async function reply(
  broadcastId: string,
  chatGroupId: string,
  text: string,
  writtenBy: string,
): Promise<BroadcastReplyResult> {
  const chat = await db
    .selectFrom("chatGroup")
    .select(["id", "createdBy"])
    .where("id", "=", chatGroupId)
    .where("broadcastId", "=", broadcastId)
    .executeTakeFirst();

  if (chat === undefined) {
    return { ok: false, reason: "not-found" };
  }

  // **Ohne Absender keine Antwort.** `chat_group.created_by` wird leer, wenn das Konto der
  // Kunstfigur gelöscht wird. Trotzdem zu schreiben ergäbe eine Nachricht ohne Namen mitten im
  // Verlauf — für das Mitglied jemand Drittes. Lieber ein ehrliches Nein an die Administration.
  if (chat.createdBy === null) {
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

export const BroadcastReplyService = { listReplies, readConversation, reply };
