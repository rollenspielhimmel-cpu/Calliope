import { db } from "@/src/database/client.ts";

/**
 * Das Postfach der Administration: ein Ort für alles, was an sie gerichtet ist.
 *
 * **Wozu es da ist.** Die Antworten auf Rundmails lagen je Rundmail vor. Wer wissen wollte, ob
 * etwas zurückgekommen ist, musste Rundmail für Rundmail nachsehen — und was man nachsehen muss,
 * geht unter. Hier laufen sie zusammen.
 *
 * **Nur die Administration, lesen wie schreiben.** Mitglieder wissen, wer die Administration ist;
 * wer ihr schreibt, weiß, an welchen Kreis er sich wendet, und rechnet nicht damit, dass die
 * Moderation mitliest. Bei einer Beschwerde über eine Moderatorin ist das nicht bloß unangenehm,
 * sondern der Grund, aus dem es an die Administration ging. Die Begründung im Langen steht in
 * `route/moderation/broadcast_replies.ts`.
 *
 * **Die Liste unter „Gesendete" bleibt daneben bestehen**, und das ist kein Versehen. Sie
 * beantwortet, was dieses Postfach nicht kann: „Ist diese eine Ankündigung angekommen." Das ist
 * eine Eigenschaft der Rundmail, nicht des Stapels. Zwei Orte werden erst dann zum Problem, wenn
 * beide zum *Handeln* einladen — geantwortet wird deshalb nur hier.
 */

/**
 * Wie viel von der letzten Nachricht in der Liste steht.
 *
 * Dieselbe Länge wie bei den Antworten je Rundmail: genug, um zu erkennen, worum es geht, und zu
 * wenig, um das Aufklappen zu ersetzen.
 */
const EXCERPT_LENGTH = 140;

export type InboxConversation = {
  chatGroupId: string;
  /** Wer schreibt. Null, wenn das Konto inzwischen weg ist — das Gespräch überlebt es. */
  username: string | null;
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
  /** Die Rundmail, aus der das Gespräch entstand, falls es eine gibt. */
  broadcastId: string | null;
};

/**
 * Alles, was an die Administration gerichtet ist — die jüngste Nachricht des Mitglieds zuerst.
 *
 * **Sortiert nach dem Mitglied, nicht nach dem Gespräch.** `chat_group.last_activity_at` setzt
 * jede Nachricht neu, auch die eigene: Ein Gespräch rutschte dann nach oben, weil *wir* geantwortet
 * haben — was wir ohnehin wissen. Und der Zeitpunkt in der Zeile stünde über einem Auszug, der
 * immer vom Mitglied stammt, also über einem Text von gestern. Dieselbe Entscheidung wie bei den
 * Antworten je Rundmail, aus demselben Grund.
 *
 * **Gespräche ohne eine einzige Nachricht des Mitglieds stehen nicht darin.** Jeder Empfänger einer
 * Rundmail hat ein Gespräch — das *ist* die Zustellung. Sie alle aufzulisten hieße, den
 * Empfängerkreis noch einmal zu zeigen und die paar echten Nachrichten darin zu verstecken.
 */
async function listConversations(): Promise<InboxConversation[]> {
  const rows = await db
    .selectFrom("chatGroup")
    .innerJoin("chatMessage", "chatMessage.chatGroupId", "chatGroup.id")
    .innerJoin("user", "user.id", "chatMessage.createdBy")
    .innerJoin("userInChatGroup", (join) =>
      join
        .onRef("userInChatGroup.chatGroupId", "=", "chatGroup.id")
        .onRef("userInChatGroup.userId", "=", "chatMessage.createdBy"))
    .select([
      "chatGroup.id as chatGroupId",
      "chatGroup.broadcastId",
      "user.username",
      "chatMessage.id as messageId",
      "chatMessage.text",
      "chatMessage.createdAt",
    ])
    .where("chatGroup.addressedToAdministration", "=", true)
    // **Vom Mitglied**: Wer im Gespräch sitzt, ist das Mitglied — die Plattformseite gehört mit
    // Absicht nicht hinein. Der `innerJoin` oben ist diese Bedingung.
    //
    // **Und nicht die erste Nachricht**, denn die ist bei einer Rundmail die Ankündigung selbst.
    // Der Absender kann im eigenen Gespräch selbst Mitglied sein — schickt er an die
    // Administration, gehört er zum Empfängerkreis —, und seine Ankündigung zählte sonst als
    // Antwort auf sich selbst. Über Sortierung statt über `min`, weil PostgreSQL kein `min(uuid)`
    // kennt; Kennungen sind uuidv7 und tragen ihre Entstehungszeit, also ist „die kleinste" auch
    // „die erste".
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

  // Die jeweils allerletzte Nachricht — gleich von welcher Seite. Nur so ist zu sagen, ob schon
  // geantwortet wurde: Stimmt sie mit der des Mitglieds überein, ist das Gespräch offen.
  const latest = await db
    .selectFrom("chatMessage")
    .select(["chatGroupId", "id"])
    .distinctOn("chatGroupId")
    .where("chatGroupId", "in", [...newest.keys()])
    .orderBy("chatGroupId")
    .orderBy("id", "desc")
    .execute();

  const latestByChat = new Map(
    latest.map((row) => [row.chatGroupId, row.id]),
  );

  return [...newest.values()].map((row) => ({
    chatGroupId: row.chatGroupId,
    username: row.username,
    excerpt: row.text.length > EXCERPT_LENGTH
      ? `${row.text.slice(0, EXCERPT_LENGTH).trimEnd()} …`
      : row.text,
    lastMessageAt: row.createdAt,
    awaitingReply: latestByChat.get(row.chatGroupId) === row.messageId,
    broadcastId: row.broadcastId,
  }));
}

export type InboxMessage = {
  id: string;
  text: string;
  createdAt: string;
  /** Der Name nach außen: das Mitglied, oder der Absender, unter dem geschrieben wurde. */
  username: string | null;
  /** Von der Teamseite — also die Rundmail selbst oder eine Antwort der Administration. */
  fromTeam: boolean;
  /**
   * Die Rundmail, mit der das Gespräch begann — nicht eine Antwort darauf.
   *
   * **Ohne diese Unterscheidung liest sich der Verlauf falsch herum.** Beide standen als „Team",
   * und die Ankündigung sah damit aus wie eine Antwort der Administration: eine Antwort vor der
   * Frage, ohne Verfasser. Genau so ist es beim Durchklicken gelesen worden, und der Schluss daraus
   * war folgerichtig — die Anzeige log über das, was die erste Nachricht ist.
   */
  isAnnouncement: boolean;
  /** Wer wirklich getippt hat, wenn `username` eine Maske ist. Sonst leer. */
  writtenByUsername: string | null;
};

export type InboxConversationDetail = {
  chatGroupId: string;
  username: string | null;
  broadcastId: string | null;
  messages: InboxMessage[];
};

/**
 * Ein Gespräch aus dem Postfach — oder nichts, wenn es nicht hineingehört.
 *
 * **Die Marke wird mitgeprüft, nicht nur die Kennung.** Ohne sie wäre das ein Schlüssel, mit dem
 * die Administration jedes beliebige Gespräch der Plattform aufmachen könnte, private Chats
 * zwischen zwei Mitgliedern eingeschlossen. Dieselbe Sperre wie bei den Antworten je Rundmail, wo
 * die Rundmail in der Adresse steht.
 */
async function readConversation(
  chatGroupId: string,
): Promise<InboxConversationDetail | undefined> {
  const chat = await db
    .selectFrom("chatGroup")
    .leftJoin("userInChatGroup", "userInChatGroup.chatGroupId", "chatGroup.id")
    .leftJoin("user", "user.id", "userInChatGroup.userId")
    .select(["chatGroup.id", "chatGroup.broadcastId", "user.username"])
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

  // Bei einer Rundmail ist die erste Nachricht die Ankündigung. Sie eigens zu merken ist nötig,
  // weil der Absender im eigenen Gespräch selbst Mitglied sein kann und sie sonst aussähe wie eine
  // Nachricht von ihm. Bei einem Gespräch ohne Rundmail schreibt das Mitglied zuerst — dann ist die
  // erste Nachricht seine, und `memberId` sagt das bereits.
  const [firstMessage] = messages;

  const isAnnouncement = (id: string) =>
    chat.broadcastId !== null && id === firstMessage?.id;

  return {
    chatGroupId: chat.id,
    username: chat.username,
    broadcastId: chat.broadcastId,
    messages: messages.map((message) => ({
      id: message.id,
      text: message.text,
      createdAt: message.createdAt,
      username: message.username,
      fromTeam: isAnnouncement(message.id) || message.memberId === null,
      isAnnouncement: isAnnouncement(message.id),
      writtenByUsername: message.writtenByUsername,
    })),
  };
}

export const AdminInboxService = { listConversations, readConversation };
