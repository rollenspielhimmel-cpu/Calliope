import { db } from "@/src/database/client.ts";
import { ENDED_BECAUSE_NAME_REVEALED } from "@/src/service/blind_date_ended_reason.ts";
import type { PostDocument } from "@/src/document/document_schema.ts";
import { documentToPlainText } from "@/src/document/document_text.ts";
import { maskDocumentWith } from "@/src/service/word_filter_service.ts";
import { NotificationService } from "@/src/service/notification_service.ts";
import { blindDateEndedMail } from "@/src/mail/blind_date_ended_mail.ts";
import { Mailer } from "@/src/mail/mailer.ts";

/**
 * Catches somebody writing their own name into the thread where the two organise — and hands it to
 * a human rather than acting on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **THIS IS A BASIC CHECK, NOT A GUARANTEE.** It matches the two usernames literally, on word
 * boundaries, case-insensitively. It does not catch — and is not written to catch:
 *
 *   - a name spelled around the filter: „S a h a r a", „Sah4ra", „S-a-h-a-r-a"
 *   - a typo, a nickname, a shortening, a real first name that is not the username
 *   - „ich bin die aus der Werkstatt-Gruppe", or any other way of saying who you are
 *   - a picture, a link, a signature carrying the name in an avatar
 *
 * Anybody determined to give themselves away will. What this catches is the ordinary slip: the
 * habitual sign-off, the reflex to introduce yourself.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **It reports; it does not decide.** An earlier version ended the Blind-Date, excluded the author
 * and sent a mail the moment a name matched. With whole words from three characters up, a username
 * that is an ordinary German word — „Rose", „Wolke", „Sturm" — makes a false positive realistic,
 * and one of those cost two people their Blind-Date over a harmless sentence. So a match now files
 * a report and nothing else happens until moderation says so.
 *
 * **What that costs, stated plainly:** between the match and the human decision the post is shown
 * as written, so the other person can read the name in it. The guard no longer prevents the leak —
 * it records it and carries the consequence afterwards. That is the trade the platform owner chose
 * over disfiguring an innocent sentence before anybody had looked at it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **Word boundaries, unlike the blocked-word list.** That list matches substrings because German
 * compounds hide slurs inside longer words. A username is not a compound: „Ann" inside „Anna",
 * „dann", „Kanne" would put a Blind-Date in front of moderation over nothing.
 */

/** What is written into the exclusion list once a suspicion is confirmed. */
export const AUTOMATIC_EXCLUSION_REASON =
  "Automatisch erkannt und von der Moderation bestätigt: eigener Benutzername im Thread „Gemeinsamer Austausch“ genannt";

/** The reason on the report, which is what the queue shows. */
const SUSPICION_REPORT_REASON =
  "Automatisch erkannt: In „Gemeinsamer Austausch“ steht der Benutzername einer der beiden am Blind-Date beteiligten Personen. Bitte prüfen, ob sich jemand tatsächlich zu erkennen gegeben hat — ein Benutzername kann auch ein gewöhnliches Wort sein.";

/**
 * Only whole words, and a name too short to be a word is not matched at all: a two-letter
 * username would fire on half the German language.
 */
const SHORTEST_GUARDED_NAME = 3;

function escapeForRegex(word: string): string {
  return word.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A matcher for these two names, used to detect and — once a suspicion is confirmed — to hide
 * them through `maskDocumentWith` wherever the group is read.
 *
 * Built per pair rather than added to the team's blocked-word list: those two names are not
 * blocked anywhere else, and putting them there would mask two ordinary members' names in every
 * post on the platform.
 */
export function nameMatcherFor(usernames: string[]): RegExp | undefined {
  const guarded = usernames.filter(
    (name) => name.length >= SHORTEST_GUARDED_NAME,
  );

  if (guarded.length === 0) {
    return undefined;
  }

  // Longest first, for the reason the word list gives: overlapping names should mask as one.
  const ordered = [...guarded].sort((a, b) => b.length - a.length);

  return new RegExp(
    `\\b(?:${ordered.map(escapeForRegex).join("|")})\\b`,
    "giu",
  );
}

type PairContext = {
  pairId: string;
  writingGroupId: string;
  authorId: string;
  otherId: string;
  usernames: string[];
};

/**
 * Whether this post is in a running Blind-Date's *exchange* thread and contains one of the two
 * names. The thread is matched by the id the pair holds, never by its title — a member may rename
 * it, and a guard that stopped applying when somebody tidied up would be worse than none.
 */
async function inspect(
  writingThreadId: string,
  authorId: string,
  document: PostDocument,
): Promise<PairContext | undefined> {
  const partners = await db
    .selectFrom("blindDatePair")
    .innerJoin(
      "blindDatePartner",
      "blindDatePartner.pairId",
      "blindDatePair.id",
    )
    .innerJoin("user", "user.id", "blindDatePartner.userId")
    .select([
      "blindDatePair.id as pairId",
      "blindDatePair.writingGroupId",
      "blindDatePartner.userId",
      "user.username",
    ])
    .where("blindDatePair.exchangeThreadId", "=", writingThreadId)
    .where("blindDatePair.revealedAt", "is", null)
    .where("blindDatePair.endedAt", "is", null)
    .execute();

  const first = partners[0];

  if (first === undefined) {
    return undefined;
  }

  const usernames = partners.map((partner) => partner.username);
  const matcher = nameMatcherFor(usernames);

  // The stored text, not the tree: the same projection search and report excerpts read.
  if (matcher === undefined || !matcher.test(documentToPlainText(document))) {
    return undefined;
  }

  const other = partners.find((partner) => partner.userId !== authorId);

  if (other === undefined) {
    return undefined;
  }

  return {
    pairId: first.pairId,
    writingGroupId: first.writingGroupId,
    authorId,
    otherId: other.userId,
    usernames,
  };
}

/**
 * Files the suspicion: an ordinary report with no reporter, and a row tying it to the Blind-Date.
 *
 * Nothing else. Both of them keep writing, nobody is excluded, no mail goes out — every one of
 * those waits for `confirm`.
 */
async function fileSuspicion(
  context: PairContext,
  writingPostId: string,
  excerpt: string,
): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    const report = await transaction
      .insertInto("report")
      .values({
        // Nobody reported this. Null is how every automatic act in this project records a missing
        // human — the same as `created_by` on a group the matching made.
        reporterId: null,
        targetType: "writing_post",
        reportedWritingPostId: writingPostId,
        reportedAuthorId: context.authorId,
        targetExcerpt: excerpt,
        category: "other",
        reason: SUSPICION_REPORT_REASON,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await transaction
      .insertInto("blindDateNameSuspicion")
      .values({
        reportId: report.id,
        pairId: context.pairId,
        writingPostId,
        suspectedId: context.authorId,
      })
      .execute();
  });
}

/**
 * The whole guard, as one call for the post route to make. Returns nothing: what it does is put a
 * report in the queue, and the caller has no decision left to take.
 */
async function guard(
  writingThreadId: string,
  authorId: string,
  writingPostId: string,
  document: PostDocument,
): Promise<void> {
  const context = await inspect(writingThreadId, authorId, document);

  if (context === undefined) {
    return;
  }

  const alreadyOpen = await db
    .selectFrom("blindDateNameSuspicion")
    .select("id")
    .where("writingPostId", "=", writingPostId)
    .where("resolvedAt", "is", null)
    .executeTakeFirst();

  if (alreadyOpen !== undefined) {
    return;
  }

  await fileSuspicion(context, writingPostId, documentToPlainText(document));
}

/**
 * Which of these posts moderation is currently looking at, so the interface can say so beside them.
 *
 * One query for a whole page. The post is shown **as written** while this is true: masking it
 * before a human had looked would disfigure an innocent sentence, which is the whole reason the
 * guard stopped acting on its own.
 */
async function postsUnderReview(
  writingPostIds: string[],
): Promise<Set<string>> {
  if (writingPostIds.length === 0) {
    return new Set();
  }

  const open = await db
    .selectFrom("blindDateNameSuspicion")
    .select("writingPostId")
    .where("writingPostId", "in", writingPostIds)
    .where("resolvedAt", "is", null)
    .execute();

  return new Set(
    open
      .map((row) => row.writingPostId)
      .filter((id): id is string => id !== null),
  );
}

export type OpenSuspicion = {
  id: string;
  reportId: string;
  writingGroupId: string;
  writingPostId: string | null;
  suspected: { id: string; username: string };
  excerpt: string;
  createdAt: string;
};

/**
 * What is waiting for a decision, oldest first.
 *
 * The excerpt comes from the report, which stored what the post said at the time — so an operator
 * reads the sentence as it was even if it has since been edited.
 */
async function listOpenSuspicions(): Promise<OpenSuspicion[]> {
  const rows = await db
    .selectFrom("blindDateNameSuspicion")
    .innerJoin("report", "report.id", "blindDateNameSuspicion.reportId")
    .innerJoin(
      "blindDatePair",
      "blindDatePair.id",
      "blindDateNameSuspicion.pairId",
    )
    .innerJoin("user", "user.id", "blindDateNameSuspicion.suspectedId")
    .select([
      "blindDateNameSuspicion.id",
      "blindDateNameSuspicion.reportId",
      "blindDateNameSuspicion.writingPostId",
      "blindDateNameSuspicion.createdAt",
      "blindDatePair.writingGroupId",
      "user.id as suspectedId",
      "user.username",
      "report.targetExcerpt",
    ])
    .where("blindDateNameSuspicion.resolvedAt", "is", null)
    .orderBy("blindDateNameSuspicion.createdAt", "asc")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    reportId: row.reportId,
    writingGroupId: row.writingGroupId,
    writingPostId: row.writingPostId,
    suspected: { id: row.suspectedId, username: row.username },
    excerpt: row.targetExcerpt,
    createdAt: row.createdAt,
  }));
}

export type SuspicionRefusal = "not_found" | "already_resolved";

/**
 * Moderation says the name really was given away.
 *
 * Only now do the consequences from the first version land: the pair ends, both seats are freed,
 * the author goes on the exclusion list and gets the mail, and the other is told it ended without
 * being told why.
 *
 * **Ending is not deleting.** The group, its four threads and everything both of them wrote stay,
 * and stay pseudonymous. From here on the two names are masked wherever the group is read.
 */
async function confirm(
  suspicionId: string,
  resolvedBy: string,
): Promise<SuspicionRefusal | undefined> {
  const outcome = await db.transaction().execute<
    SuspicionRefusal | {
      authorId: string;
      writingGroupId: string;
      otherId: string;
    }
  >(async (transaction) => {
    const suspicion = await transaction
      .selectFrom("blindDateNameSuspicion")
      .innerJoin(
        "blindDatePair",
        "blindDatePair.id",
        "blindDateNameSuspicion.pairId",
      )
      .select([
        "blindDateNameSuspicion.id",
        "blindDateNameSuspicion.pairId",
        "blindDateNameSuspicion.reportId",
        "blindDateNameSuspicion.suspectedId",
        "blindDatePair.writingGroupId",
      ])
      .where("blindDateNameSuspicion.id", "=", suspicionId)
      .executeTakeFirst();

    if (suspicion === undefined) {
      return "not_found";
    }

    const marked = await transaction
      .updateTable("blindDateNameSuspicion")
      .set({
        resolvedAt: new Date().toISOString(),
        resolvedBy,
        confirmed: true,
      })
      .where("id", "=", suspicionId)
      .where("resolvedAt", "is", null)
      .returning("id")
      .executeTakeFirst();

    // Two operators reaching the same suspicion: the second loses here rather than applying the
    // consequences a second time.
    if (marked === undefined) {
      return "already_resolved";
    }

    const others = await transaction
      .selectFrom("blindDatePartner")
      .select("userId")
      .where("pairId", "=", suspicion.pairId)
      .where("userId", "!=", suspicion.suspectedId)
      .execute();

    await transaction
      .updateTable("blindDatePair")
      .set({
        endedAt: new Date().toISOString(),
        endedReason: ENDED_BECAUSE_NAME_REVEALED,
      })
      .where("id", "=", suspicion.pairId)
      .where("endedAt", "is", null)
      .execute();

    await transaction
      .updateTable("blindDatePartner")
      .set({ isActive: false })
      .where("pairId", "=", suspicion.pairId)
      .execute();

    await transaction
      .insertInto("blindDateExclusion")
      .values({
        userId: suspicion.suspectedId,
        reason: AUTOMATIC_EXCLUSION_REASON,
        // The operator who confirmed it. Unlike the first version this *was* a human decision,
        // and the list should say whose.
        addedBy: resolvedBy,
      })
      .onConflict((conflict) =>
        conflict.column("userId").doUpdateSet({
          reason: AUTOMATIC_EXCLUSION_REASON,
          addedBy: resolvedBy,
        })
      )
      .execute();

    await transaction
      .updateTable("blindDateApplication")
      .set({
        status: "declined",
        decidedAt: new Date().toISOString(),
        decidedBy: resolvedBy,
        decisionNote: AUTOMATIC_EXCLUSION_REASON,
      })
      .where("userId", "=", suspicion.suspectedId)
      .where("status", "=", "pending")
      .execute();

    // The report is closed with the decision, so the queue does not hold it open afterwards.
    await transaction
      .updateTable("report")
      .set({
        closedAt: new Date().toISOString(),
        operatorId: resolvedBy,
        closingOutcome: "content_removed",
        closingNote: AUTOMATIC_EXCLUSION_REASON,
      })
      .where("id", "=", suspicion.reportId)
      .where("closedAt", "is", null)
      .execute();

    for (const other of others) {
      // deno-lint-ignore no-await-in-loop -- one partner, and the transaction owns the order
      await NotificationService.insertBlindDateEndedNotification(
        transaction,
        suspicion.writingGroupId,
        other.userId,
      );
    }

    return {
      authorId: suspicion.suspectedId,
      writingGroupId: suspicion.writingGroupId,
      otherId: others[0]?.userId ?? "",
    };
  });

  if (outcome === "not_found" || outcome === "already_resolved") {
    return outcome;
  }

  const author = await db
    .selectFrom("user")
    .select(["username", "emailAddress"])
    .where("id", "=", outcome.authorId)
    .executeTakeFirst();

  if (author !== undefined) {
    // In the background, like every other mail here: the decision stands either way, and a mail
    // server being unwell must not undo what an operator just decided.
    Mailer.sendInBackground(blindDateEndedMail(author));
  }

  return undefined;
}

/**
 * Moderation says it was nothing — a username that happens to be an ordinary word, a coincidence.
 *
 * Nothing happens to anybody. The notice beside the post disappears, the Blind-Date carries on,
 * and the report is closed as what it was.
 */
async function dismiss(
  suspicionId: string,
  resolvedBy: string,
): Promise<SuspicionRefusal | undefined> {
  return await db.transaction().execute(async (transaction) => {
    const suspicion = await transaction
      .selectFrom("blindDateNameSuspicion")
      .select(["id", "reportId"])
      .where("id", "=", suspicionId)
      .executeTakeFirst();

    if (suspicion === undefined) {
      return "not_found";
    }

    const marked = await transaction
      .updateTable("blindDateNameSuspicion")
      .set({
        resolvedAt: new Date().toISOString(),
        resolvedBy,
        confirmed: false,
      })
      .where("id", "=", suspicionId)
      .where("resolvedAt", "is", null)
      .returning("id")
      .executeTakeFirst();

    if (marked === undefined) {
      return "already_resolved";
    }

    await transaction
      .updateTable("report")
      .set({
        closedAt: new Date().toISOString(),
        operatorId: resolvedBy,
        closingOutcome: "no_violation",
        closingNote:
          "Kein Namensverdacht — der Treffer war ein gewöhnliches Wort.",
      })
      .where("id", "=", suspicion.reportId)
      .where("closedAt", "is", null)
      .execute();

    return undefined;
  });
}

/** Masks a document with a pair's matcher, for the read paths. */
function mask(
  document: PostDocument,
  matcher: RegExp | undefined,
): PostDocument {
  return maskDocumentWith(document, matcher);
}

export const BlindDateNameGuardService = {
  guard,
  listOpenSuspicions,
  inspect,
  postsUnderReview,
  confirm,
  dismiss,
  mask,
  nameMatcherFor,
};
