import { sql } from "kysely";
import { db, type Transaction } from "@/src/database/client.ts";
import type { PublicationStatus } from "@/src/database/schema.ts";
import type { User } from "@/src/service/user_service.ts";
import { mayAdministerPlatform } from "@/src/service/platform_authorization.ts";
import { BroadcastSenderService } from "@/src/service/broadcast_sender_service.ts";
import { publishChatEvent } from "@/src/event/chat_events.ts";
import {
  documentToPlainText,
  plainTextToDocument,
} from "@/src/document/document_text.ts";
import {
  type BroadcastAudience,
  type BroadcastDelivery,
  type BroadcastRole,
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
 * **Wer vorbereitet:** jede Rolle mit der Berechtigung `prepare_publications` — heute Admins und
 * Mods. Wer keine Administration hat, bearbeitet und verwirft nur das Eigene.
 *
 * **Wer freigibt:** jede Administration, keine andere Rolle. Freigeben ist keine Berechtigung, die
 * man einer Rolle geben kann; sonst wäre die Warteschlange mit einem Haken abgeschafft.
 *
 * **Eine Administration gibt mit dem Schreiben frei**, der Ur-Admin wie jede andere. Was sie
 * einreicht, ist freigegeben; was sie bearbeitet, auch — die Fassung, die dann dasteht, ist ihre.
 * Auch dort werden `approved_by` und `approved_at` gesetzt, statt sie leer zu lassen: Die Spalte
 * soll immer sagen, wer es verantwortet, und ein Sonderfall mit leeren Feldern wäre eine Lücke in
 * genau der Spur, für die es sie gibt. Bis zum 22. September 2026 galt das nur für den Ur-Admin, und
 * keine Administration durfte die eigene Einreichung freigeben; seitdem ist die Warteschlange für
 * das da, was Rollen ohne Administration schreiben.
 *
 * **Jede Bearbeitung setzt die Freigabe zurück**, wenn sie nicht von einer Administration kommt —
 * Text, Betreff, Empfängerkreis und Absender gleichermaßen. Sonst lässt man Harmloses absegnen und
 * tauscht danach den Empfängerkreis, was dasselbe ist wie einen anderen Text zu senden.
 *
 * **Freigabe und Versand sind zwei Dinge.** Ohne Termin fallen sie zusammen: freigeben heißt
 * senden. Mit Termin ist die Freigabe erteilt und die Uhr eine zweite Bedingung — `releaseDue`
 * sammelt ein, was beides erfüllt. Der Termin allein sendet nie: Was niemand freigegeben hat,
 * geht auch dann nicht raus, wenn der Zeitpunkt verstreicht.
 */

export type BroadcastInput = {
  subject: string;
  body: string;
  audienceRoles: BroadcastRole[];
  /**
   * Ausdruecklich genannte Konten, zusaetzlich zu den Rollen.
   *
   * Beides zugleich: Wer die Moderation waehlt und zwei Namen nennt, erreicht beide. Wer nur Namen
   * nennt, schreibt an genau die — und dann ist es keine Ankuendigung mehr, weshalb das Archiv in
   * diesem Fall gar nicht erst angeboten wird.
   */
  memberIds: string[];
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
  /** Die Rundmail selbst, an der die Antworten hängen. */
  broadcastId: string;
  status: PublicationStatus;
  /** Nach außen: unter welchem Namen sie erscheint. */
  sendAsUsername: string | null;
  /**
   * Intern: wer sie verfasst hat, auch wenn außen jemand anderes draufsteht. Die Kennung daneben,
   * weil die Oberfläche an ihr entscheidet, was jemand ohne Administration hier anfassen darf: nur
   * das Eigene.
   */
  writtenBy: string | null;
  writtenByUsername: string | null;
  writtenAt: string;
  approvedByUsername: string | null;
  approvedAt: string | null;
  /**
   * Wer sie zuletzt bearbeitet hat, falls jemand — **neben** dem Verfasser, nicht an dessen Stelle.
   *
   * Der Fall, für den die Warteschlange existiert, ist der, dass jemand etwas Grenzwertiges
   * einreicht und eine Administration es entschärft. Dann müssen beide Namen dastehen; eine
   * Spalte, die von einem auf den anderen überginge, hätte den ersten gelöscht.
   */
  editedByUsername: string | null;
  editedAt: string | null;
  releasedAt: string | null;
  /**
   * Wer sie zurückgezogen hat und wann — oder nichts. Vom Inhalt bleibt danach nichts, auch intern
   * nicht; das hier ist, was bleibt.
   */
  retractedByUsername: string | null;
  retractedAt: string | null;
  /** Wie viele es ins Postfach bekommen haben, oder null, wenn dieser Weg nicht gewählt war. */
  recipientCount: number | null;
  /** Wie viele eine Mail bekommen haben. Weniger, wenn Adressen unbestätigt sind. */
  emailRecipientCount: number | null;
  /** Gesetzt, sobald sie im Archiv steht — die Oberfläche verlinkt darauf. */
  archivePostId: string | null;
  /**
   * Die namentlich Genannten **mit Namen**, für die Liste und fürs Bearbeiten.
   *
   * `memberIds` allein reicht nicht: Beim Bearbeiten stünden sonst Kennungen im Formular, und
   * niemand weiß, wer `01a077b4-…` ist.
   */
  namedRecipients: Array<{ id: string; username: string }>;
};

function audienceOf(broadcast: BroadcastInput): BroadcastAudience {
  return {
    roles: broadcast.audienceRoles,
    memberIds: broadcast.memberIds,
    includeUnverified: broadcast.includeUnverified,
  };
}

/**
 * Schreibt die namentlich Genannten, nachdem die alten weg sind.
 *
 * **Ersetzen statt ergänzen**, weil Bearbeiten den Empfängerkreis neu bestimmt: Wer einen Namen
 * herausnimmt, will ihn heraus haben, und ein Ergänzen ließe ihn stehen. Gefahrlos ist das, weil
 * die neue Fassung entweder wieder wartet oder von der Administration stammt, die sie freigibt —
 * es sieht in beiden Fällen jemand darauf.
 *
 * `onConflict … doNothing`, weil dieselbe Kennung zweimal in der Liste stehen kann, wenn jemand im
 * Formular herumklickt. Eine Absage dafür wäre Strenge ohne Zweck.
 */
async function insertNamedRecipients(
  transaction: Transaction,
  broadcastId: string,
  memberIds: string[],
): Promise<void> {
  if (memberIds.length === 0) {
    return;
  }

  await transaction
    .insertInto("broadcastRecipient")
    .values(memberIds.map((userId) => ({ broadcastId, userId })))
    .onConflict((conflict) => conflict.doNothing())
    .execute();
}

function deliveryOf(broadcast: BroadcastInput): BroadcastDelivery {
  return {
    toInbox: broadcast.deliverToInbox,
    byEmail: broadcast.deliverByEmail,
    toArchive: broadcast.publishInArchive,
  };
}

/** Eine Zeile der Liste, mit beiden echten Namen und dem Absender daneben. */
function rows(executor: typeof db | Transaction = db) {
  return executor
    .selectFrom("publication")
    .innerJoin("broadcast", "broadcast.publicationId", "publication.id")
    .leftJoin(
      "user as sender",
      "sender.id",
      "publication.sendAsUserId",
    )
    .leftJoin("user as author", "author.id", "publication.writtenBy")
    .leftJoin("user as approver", "approver.id", "publication.approvedBy")
    .leftJoin("user as editor", "editor.id", "publication.editedBy")
    .leftJoin("user as retractor", "retractor.id", "publication.retractedBy")
    .select([
      "publication.id as publicationId",
      "publication.status",
      "publication.sendAsUserId",
      "publication.scheduledFor",
      "sender.username as sendAsUsername",
      "publication.writtenBy",
      "author.username as writtenByUsername",
      "publication.writtenAt",
      "approver.username as approvedByUsername",
      "publication.approvedAt",
      "editor.username as editedByUsername",
      "publication.editedAt",
      "publication.releasedAt",
      "retractor.username as retractedByUsername",
      "publication.retractedAt",
      "broadcast.id as broadcastId",
      "broadcast.subject",
      "broadcast.body",
      "broadcast.audienceRoles",
      "broadcast.includeUnverified",
      "broadcast.deliverToInbox",
      "broadcast.deliverByEmail",
      "broadcast.publishInArchive",
      "broadcast.archivePostId",
      "broadcast.recipientCount",
      "broadcast.emailRecipientCount",
    ])
    // Die namentlich Genannten als Feld daneben, statt in einer zweiten Abfrage: Die Liste zeigt
    // sie mit an, und eine Rundmail ohne Namen bekommt eine leere Reihung statt null.
    .select(
      sql<
        string[]
      >`coalesce(array(select user_id::text from broadcast_recipient where broadcast_id = broadcast.id), array[]::text[])`
        .as("memberIds"),
    )
    // **Und dieselben mit Namen.** Ohne die stünden beim Bearbeiten Kennungen im Formular, und
    // niemand weiß, wer `01a077b4-…` ist. Nach Namen sortiert, weil eine Liste, die jemand liest,
    // findbar sein soll — „in welcher Reihenfolge angeklickt" ist keine.
    .select(
      sql<
        Array<{ id: string; username: string }>
      >`coalesce((select json_agg(json_build_object('id', u.id, 'username', u.username) order by u.username) from broadcast_recipient r join "user" u on u.id = r.user_id where r.broadcast_id = broadcast.id), '[]'::json)`
        .as("namedRecipients"),
    )
    .where("publication.kind", "=", "broadcast");
}

function toQueued(row: {
  publicationId: string;
  status: PublicationStatus;
  sendAsUserId: string | null;
  scheduledFor: string | null;
  sendAsUsername: string | null;
  writtenBy: string | null;
  writtenByUsername: string | null;
  writtenAt: string;
  approvedByUsername: string | null;
  approvedAt: string | null;
  editedByUsername: string | null;
  editedAt: string | null;
  releasedAt: string | null;
  retractedByUsername: string | null;
  retractedAt: string | null;
  broadcastId: string;
  subject: string;
  body: string;
  audienceRoles: string[];
  memberIds: string[];
  includeUnverified: boolean;
  deliverToInbox: boolean;
  deliverByEmail: boolean;
  publishInArchive: boolean;
  archivePostId: string | null;
  recipientCount: number | null;
  emailRecipientCount: number | null;
  namedRecipients: Array<{ id: string; username: string }>;
}): QueuedBroadcast {
  return {
    ...row,
    // Die Spalte ist `TEXT[]`, weil die Datenbank den Empfängerbegriff nicht kennt. Die Werte
    // stammen aus dem geprüften Anfragekörper, also ist die Einschränkung hier eine Behauptung
    // über bereits Geprüftes und kein Vertrauen in die Datenbank.
    audienceRoles: row.audienceRoles as BroadcastRole[],
  };
}

export type SubmitRefusal = "sender_not_released";

/**
 * Schreibt eine Rundmail in die Warteschlange.
 *
 * Von einer Administration kommt sie freigegeben heraus und geht ohne Termin sofort raus; von
 * allen anderen wartet sie.
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
  const givesOwnApproval = mayAdministerPlatform(author.platformRole);

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

    const broadcast = await transaction
      .insertInto("broadcast")
      .values({
        publicationId: publication.id,
        subject: input.subject,
        body: input.body,
        audienceRoles: input.audienceRoles,
        includeUnverified: input.includeUnverified,
        deliverToInbox: input.deliverToInbox,
        deliverByEmail: input.deliverByEmail,
        publishInArchive: input.publishInArchive,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await insertNamedRecipients(transaction, broadcast.id, input.memberIds);

    return publication.id;
  });

  // Freigegeben und ohne Termin heißt: jetzt. Mit Termin wartet sie auf den Taktgeber, auch bei
  // einer Administration — die Freigabe ist erteilt, die Uhr ist eine zweite Bedingung.
  if (givesOwnApproval && input.scheduledFor === null) {
    await release(publicationId);
  }

  return await selectOneOrThrow(publicationId);
}

/**
 * Verschickt und hält fest, an wie viele.
 *
 * **Keine Rundmail gilt als versendet, die nicht zugestellt ist.** Das Buchen auf `released` und
 * die Zustellung stehen in **einer** Transaktion; bricht das Zustellen ab, fällt die Buchung mit
 * um, die Rundmail steht wieder auf `approved` und geht im nächsten Takt erneut raus. Vorher waren
 * es zwei Schritte, und der Fehlerfall dazwischen war als Preis ausdrücklich in Kauf genommen: Ein
 * abgebrochener Versand hinterließ eine Rundmail, die als „raus" dastand und in keinem Postfach
 * lag — still verloren, unbemerkt von beiden Seiten.
 *
 * **Das `WHERE status = 'approved'` bleibt der Punkt, an dem genau einer gewinnt.** Seit der
 * Taktgeber danebensteht, können zwei Wege gleichzeitig freigeben wollen: die Freigabe von Hand
 * und der Lauf, der Fälliges einsammelt. Die Bedingung wirkt in der Transaktion genauso — wer
 * zweiter ist, wartet auf der Zeilensperre und prüft danach neu: Ist der erste durchgekommen,
 * steht dort `released` und die Bedingung trifft nichts; hat er zurückgezogen, steht wieder
 * `approved` und der zweite darf, weil der erste eben *nicht* zugestellt hat. Die Transaktion
 * kostet den Schutz vor doppeltem Versand also nicht, sie schärft ihn.
 *
 * **Nicht alles passt hinein.** Das Relais kennt keine Transaktion, und ein Strom-Anstoß an einen
 * offenen Browser auch nicht. Beides läuft deshalb erst nach dem Festschreiben, als `announce` —
 * siehe `BroadcastService.send`. Für den reinen E-Mail-Weg heißt das, dass die Zusage nur so weit
 * reicht wie die Datenbank; für Postfach und Archiv gilt sie ganz.
 *
 * **Ein zweiter Versuch um das Ganze herum.** Er stand früher innen, um die Postfachzustellung, für
 * den einen Fall, der sie umwerfen kann: ein Konto, das zwischen Lesen und Schreiben gelöscht
 * wurde. Innen ginge er jetzt nicht mehr — eine gescheiterte Anweisung bricht die Transaktion ab —,
 * und außen ist er ohnehin richtiger: Der erste Versuch hat dann wirklich nichts hinterlassen.
 *
 * Die Empfängerzahl wird beim Versand festgehalten und nicht später gezählt: Wer die Liste
 * hinterher neu abfragt, zählt die Mitglieder von heute und nicht die, die sie bekommen haben.
 */
async function release(publicationId: string): Promise<boolean> {
  try {
    return await releaseOnce(publicationId);
  } catch (failure) {
    console.warn("Retrying the release of a broadcast", failure);

    return await releaseOnce(publicationId);
  }
}

async function releaseOnce(publicationId: string): Promise<boolean> {
  const dispatch = await db.transaction().execute(async (transaction) => {
    const claimed = await transaction
      .updateTable("publication")
      .set({ status: "released", releasedAt: new Date().toISOString() })
      .where("id", "=", publicationId)
      .where("status", "=", "approved")
      .returning("id")
      .executeTakeFirst();

    if (claimed === undefined) {
      return undefined;
    }

    // **Was rausgeht, wird hier gelesen, nach dem Beanspruchen — nicht vom Aufrufer mitgebracht.**
    // Der Taktgeber liest die Fälligen und sendet sie danach; dazwischen kann eine Administration
    // sie bearbeitet haben, und deren Fassung ist sofort freigegeben. Mit dem Mitgebrachten ginge
    // dann der alte Text raus, unter einer Freigabe für den neuen. Die Bearbeitung sperrt dieselbe
    // Zeile, die das Beanspruchen sperrt; wer danach liest, liest also, was freigegeben ist.
    const input = toQueued(
      await rows(transaction)
        .where("publication.id", "=", publicationId)
        .executeTakeFirstOrThrow(),
    );
    const broadcast = { id: input.broadcastId };

    const delivery = deliveryOf(input);

    // **Zuerst ins Archiv, dann zustellen.** Nicht mehr, weil etwas darauf verwiese — das Postfach
    // trägt den ganzen Text und zeigt nirgendwo hin —, sondern weil das Ablegen die kleinere
    // Hälfte ist und die Reihenfolge den Fehler früh sichtbar macht.
    const archivePostId = delivery.toArchive
      ? await BroadcastService.publishInArchive(
        transaction,
        input.subject,
        input.body,
        input.sendAsUserId,
      )
      : null;

    const sent = await BroadcastService.send(
      transaction,
      broadcast.id,
      audienceOf(input),
      delivery,
      input.subject,
      input.body,
      input.sendAsUserId,
    );

    await transaction
      .updateTable("broadcast")
      .set({
        recipientCount: delivery.toInbox ? sent.reach.inbox : null,
        emailRecipientCount: delivery.byEmail ? sent.reach.email : null,
        archivePostId,
      })
      .where("publicationId", "=", publicationId)
      .execute();

    return sent;
  });

  if (dispatch === undefined) {
    return false;
  }

  dispatch.announce();

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
    try {
      // deno-lint-ignore no-await-in-loop -- siehe darüber
      if (await release(row.publicationId)) {
        sent++;
      }
    } catch (failure) {
      // **Eine, die nicht rauskann, hält die anderen nicht auf.** Vorher riss der Fehler den
      // ganzen Lauf mit, und alles dahinter blieb liegen — bis zum nächsten Takt, der an derselben
      // Stelle wieder anschlug. Sie steht nach dem Rückzieher wieder auf `approved` und kommt
      // beim nächsten Mal von selbst noch einmal dran; verloren ist nichts.
      console.error(
        `Releasing broadcast ${row.publicationId} failed; it stays approved and will be tried again`,
        failure,
      );
    }
  }

  return sent;
}

export type ApprovalRefusal = "not_found" | "not_waiting";

/**
 * Gibt frei und sendet sofort.
 *
 * Ein Zustand, der nicht `awaiting_approval` ist, wird abgelehnt statt still übergangen: Zweimal
 * freigeben hieße zweimal senden, und „schon erledigt" ist eine Antwort, die jemand lesen soll.
 *
 * **Kein Verbot mehr, das Eigene freizugeben.** Was eine Administration schreibt, wartet gar nicht
 * erst. Was hier wartet, hat zuletzt jemand ohne Administration angefasst — auch wenn es einmal
 * eine Administration eingereicht hat, und genau dann muss die es freigeben dürfen.
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
    await release(publicationId);
  }

  return undefined;
}

export type EditRefusal =
  | "not_found"
  | "already_out"
  | "not_yours"
  | "sender_not_released";

/** Ohne Administration nur das Eigene — beim Bearbeiten wie beim Verwerfen. */
function mayTouch(
  publication: { writtenBy: string | null },
  actor: User,
): boolean {
  return mayAdministerPlatform(actor.platformRole) ||
    publication.writtenBy === actor.id;
}

/** Was noch zu ändern ist: weder draußen noch verworfen. */
const STILL_OPEN: PublicationStatus[] = ["awaiting_approval", "approved"];

/** Die Bedingung im Update hat nichts getroffen; die Transaktion wird damit zurückgerollt. */
class NoLongerOpen extends Error {}

/**
 * Ändert eine wartende oder freigegebene Rundmail.
 *
 * **Von einer Administration ist die neue Fassung freigegeben**, von jeder anderen Rolle wartet
 * sie wieder. Ohne Termin geht eine freigegebene Fassung sofort raus, wie beim Einreichen — das
 * Speichern einer Administration ist das Freigeben, und die Oberfläche sagt das am Knopf.
 *
 * Was schon draußen ist, lässt sich nicht mehr ändern: Die Mail ist verschickt, und eine Zeile in
 * der Datenbank zu korrigieren würde nur den Beleg von dem entfernen, was tatsächlich ankam.
 *
 * **Der Zustand wird im Update noch einmal geprüft**, nicht nur davor. Dazwischen kann der
 * Taktgeber sie versendet haben; ohne die Bedingung stünde eine verschickte Rundmail danach
 * wieder als wartend da, mit einem Text, der nie rausging.
 */
async function edit(
  publicationId: string,
  input: BroadcastInput,
  editor: User,
): Promise<QueuedBroadcast | EditRefusal> {
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

  if (!await BroadcastSenderService.mayBeSender(input.sendAsUserId)) {
    return "sender_not_released";
  }

  const approves = mayAdministerPlatform(editor.platformRole);
  const now = new Date().toISOString();

  try {
    await applyEdit(publicationId, input, editor, approves, now);
  } catch (failure) {
    if (failure instanceof NoLongerOpen) {
      return "already_out";
    }
    throw failure;
  }

  if (approves && input.scheduledFor === null) {
    await release(publicationId);
  }

  // Der Eintrag, wie er jetzt dasteht: Ob er wartet, geplant oder schon raus ist, entscheidet die
  // Rolle dessen, der gespeichert hat — und das soll die Oberfläche aus der Antwort lesen, nicht
  // selbst noch einmal herleiten.
  return await selectOneOrThrow(publicationId);
}

async function applyEdit(
  publicationId: string,
  input: BroadcastInput,
  editor: User,
  approves: boolean,
  now: string,
): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    const changed = await transaction
      .updateTable("publication")
      .set({
        status: approves ? "approved" : "awaiting_approval",
        approvedBy: approves ? editor.id : null,
        approvedAt: approves ? now : null,
        sendAsUserId: input.sendAsUserId,
        scheduledFor: input.scheduledFor,
        // **Neben `written_by`, nicht an dessen Stelle.** Wer eingereicht hat, bleibt stehen: Der
        // Fall, für den die Warteschlange existiert, ist der, dass jemand etwas Grenzwertiges
        // einreicht und eine Administration es entschärft — und dann müssen beide Namen dastehen.
        // Eine wandernde Spalte hätte den ersten gelöscht.
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

    const broadcast = await transaction
      .updateTable("broadcast")
      .set({
        subject: input.subject,
        body: input.body,
        audienceRoles: input.audienceRoles,
        includeUnverified: input.includeUnverified,
        deliverToInbox: input.deliverToInbox,
        deliverByEmail: input.deliverByEmail,
        publishInArchive: input.publishInArchive,
        updatedAt: new Date().toISOString(),
      })
      .where("publicationId", "=", publicationId)
      .returning("id")
      .executeTakeFirstOrThrow();

    // Ersetzt, nicht ergänzt: Wer beim Bearbeiten einen Namen herausnimmt, will ihn heraus haben.
    await transaction
      .deleteFrom("broadcastRecipient")
      .where("broadcastId", "=", broadcast.id)
      .execute();

    await insertNamedRecipients(transaction, broadcast.id, input.memberIds);
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
export type DiscardRefusal = "not_found" | "already_out" | "not_yours";

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

  // Die Bedingung aus demselben Grund wie beim Bearbeiten: Dazwischen kann der Taktgeber sie
  // versendet haben, und „verworfen" über einer verschickten wäre eine falsche Spur.
  const discarded = await db
    .updateTable("publication")
    .set({ status: "discarded" })
    .where("id", "=", publicationId)
    .where("status", "in", STILL_OPEN)
    .returning("id")
    .executeTakeFirst();

  return discarded === undefined ? "already_out" : undefined;
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

/** Was nach dem Zurückziehen an der Stelle der Rundmail steht — im Postfach wie im Archiv. */
export const RETRACTED_TEXT = "Diese Rundmail wurde zurückgezogen.";

/**
 * Der Ersatz für Betreff und Text der Rundmail selbst. Nicht leer, weil die Datenbank das nicht
 * zulässt (`broadcast_subject_not_blank`) — und nichts vom Wortlaut.
 */
const RETRACTED_SUBJECT = "Zurückgezogen";

export type RetractRefusal =
  | "not_found"
  | "not_the_first_administrator"
  | "not_released"
  | "already_retracted";

export type Retracted = {
  retractedAt: string;
  /** In wie vielen Postfächern der Text ersetzt wurde. */
  inboxes: number;
  archived: boolean;
};

/**
 * Zieht eine versendete Rundmail zurück — **nur der Ur-Admin, und nur der Inhalt geht.**
 *
 * **Was verschwindet:** Text und Betreff in jedem Postfach, wo an ihrer Stelle
 * `RETRACTED_TEXT` steht, damit Antworten darunter nicht in der Luft hängen; der Beitrag im Archiv,
 * genauso ersetzt statt gelöscht, damit die Sammlung keine stille Lücke hat — Dokument **und**
 * Volltext, sonst fände die Suche ihn weiter; und der Wortlaut an der Rundmail selbst, auch intern,
 * auch der Betreff. Zurückgezogen wird meist, weil der Text weg *muss*.
 *
 * **Was bleibt:** wer wann zurückgezogen hat, wer sie geschrieben und freigegeben hat, der
 * Absender, der Empfängerkreis samt den namentlich Genannten und die Empfängerzahlen. Nichts
 * davon ist Inhalt, und wer sie bekam, braucht man gerade danach, um die Betroffenen anzusprechen.
 *
 * **Was nicht verschwindet, und das sagt die Oberfläche vorher:** Mails, die beim Relais liegen;
 * Antworten, die den Text zitieren; Meldungen, die ihren eigenen Auszug tragen. Die übrigen Mails
 * hält `stopMailsOf` an, sobald festgeschrieben ist.
 *
 * **Nur einmal**, mit derselben Bedingung im `WHERE` wie beim Freigeben: Zweimal gleichzeitig
 * gedrückt, trifft der zweite nichts mehr.
 */
async function retract(
  publicationId: string,
  actor: User,
): Promise<RetractRefusal | Retracted> {
  // Die Rolle reicht nicht, und das ist die Entscheidung: Zurückziehen ist der eine Schritt, der
  // an allen Freigaben vorbei wirkt, also liegt er bei dem einen Konto, das ohne Freigabe sendet.
  if (!actor.isPrimordialAdmin) {
    return "not_the_first_administrator";
  }

  const now = new Date().toISOString();

  const outcome = await db.transaction().execute(async (transaction) => {
    const claimed = await transaction
      .updateTable("publication")
      .set({ retractedBy: actor.id, retractedAt: now })
      .where("id", "=", publicationId)
      .where("kind", "=", "broadcast")
      .where("status", "=", "released")
      .where("retractedAt", "is", null)
      .returning("id")
      .executeTakeFirst();

    if (claimed === undefined) {
      const found = await transaction
        .selectFrom("publication")
        .select(["status", "retractedAt"])
        .where("id", "=", publicationId)
        .where("kind", "=", "broadcast")
        .executeTakeFirst();

      return found === undefined
        ? "not_found" as const
        : found.retractedAt !== null
        ? "already_retracted" as const
        : "not_released" as const;
    }

    const broadcast = await transaction
      .updateTable("broadcast")
      .set({
        subject: RETRACTED_SUBJECT,
        body: RETRACTED_TEXT,
        updatedAt: now,
      })
      .where("publicationId", "=", publicationId)
      .returning(["id", "archivePostId"])
      .executeTakeFirstOrThrow();

    const replaced = await transaction
      .updateTable("chatMessage")
      .set({ text: RETRACTED_TEXT, subject: null })
      .where("broadcastId", "=", broadcast.id)
      .returning(["id", "chatGroupId", "createdAt", "createdBy"])
      .execute();

    // Wer die Gespräche gerade offen hat, sieht sonst den Text weiter, der weg soll.
    const members = replaced.length === 0 ? [] : await transaction
      .selectFrom("userInChatGroup")
      .select(["chatGroupId", "userId"])
      .where(
        "chatGroupId",
        "in",
        replaced.map((message) => message.chatGroupId),
      )
      .execute();

    const senderName = replaced[0]?.createdBy === null ||
        replaced[0] === undefined
      ? null
      : (await transaction
        .selectFrom("user")
        .select("username")
        .where("id", "=", replaced[0].createdBy)
        .executeTakeFirst())?.username ?? null;

    if (broadcast.archivePostId !== null) {
      const document = plainTextToDocument(RETRACTED_TEXT);

      await transaction
        .updateTable("writingPost")
        .set({
          document,
          text: documentToPlainText(document),
          editedBy: actor.id,
          editedAt: now,
        })
        .where("id", "=", broadcast.archivePostId)
        .execute();
    }

    return {
      broadcastId: broadcast.id,
      archived: broadcast.archivePostId !== null,
      replaced,
      members,
      senderName,
    };
  });

  if (typeof outcome === "string") {
    return outcome;
  }

  // Erst nach dem Festschreiben: Ein Rückzieher darf nichts angehalten und niemandem etwas
  // angekündigt haben.
  BroadcastService.stopMailsOf(outcome.broadcastId);

  for (const message of outcome.replaced) {
    publishChatEvent(
      outcome.members
        .filter((member) => member.chatGroupId === message.chatGroupId)
        .map((member) => member.userId),
      {
        chatGroupId: message.chatGroupId,
        // Dieselbe Kennung wie die Nachricht, die ersetzt wird: Die Oberfläche legt sie darüber.
        message: {
          id: message.id,
          text: RETRACTED_TEXT,
          createdAt: message.createdAt,
          createdBy: message.createdBy,
          createdByUsername: outcome.senderName,
        },
      },
    );
  }

  return {
    retractedAt: now,
    inboxes: outcome.replaced.length,
    archived: outcome.archived,
  };
}

export const BroadcastQueueService = {
  retract,
  submit,
  approve,
  releaseDue,
  edit,
  discard,
  selectOne,
  listWaiting,
  listReleased,
};
