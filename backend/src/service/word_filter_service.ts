import { db } from "@/src/database/client.ts";
import type {
  DocumentNode,
  PostDocument,
} from "@/src/document/document_schema.ts";

/**
 * Words the community does not print, and the masking that hides them.
 *
 * **The mask is applied when text is read, never when it is written.** Nothing here ever changes a
 * stored row. That is the whole design, and both halves of it matter: taking a word off the list
 * makes every older text readable again exactly as its author wrote it, and adding one masks
 * everything already written without a single row being touched. A filter that rewrote posts on
 * save would be a one-way door — the original would be gone, and the list could never be corrected.
 *
 * **It is applied on the server, not in the browser.** Masking in the client would leave the word
 * one devtools panel away in the response body, which is not a filter but a decoration.
 *
 * Matching is **plain, case-insensitive substring** — deliberately, and it is the one decision here
 * worth arguing with. Substring is what catches German compounds, where a word rarely stands alone;
 * whole-word matching would print „Arschgeweih" in full. The cost is the other direction: a short
 * entry masks the middle of innocent words, so the interface says so where the list is edited and
 * the minimum length is two characters. Leetspeak and letter tricks are out of scope, as asked.
 *
 * The trade was put to the platform owner with both halves named, and substring is what they chose.
 * Switching to whole words later is a one-line change here — `\b` either side of the alternation —
 * but it is a decision about their language, not a refactor.
 */

/** Always three, whatever the word's length — a mask that measures the word is half a hint. */
const MASK = "***";

/** The shortest entry the table accepts, restated for the message the route gives back. */
export const MINIMUM_WORD_LENGTH = 2;

export type BlockedWord = {
  word: string;
  addedBy: { id: string; username: string } | null;
  addedAt: string;
  note: string | null;
};

/**
 * The compiled matcher, rebuilt at most every `CACHE_TTL_MS`.
 *
 * Masking runs on every post, message and profile that anybody reads, so asking the database each
 * time would put a query on the hottest path in the product. The cost of the cache is that a word
 * added on one instance takes up to the TTL to take effect on another — acceptable for a list that
 * changes a few times a year, and the instance doing the adding clears its own immediately.
 */
const CACHE_TTL_MS = 30_000;

let cache: { pattern: RegExp | undefined; expiresAt: number } | undefined;

/** `.` and `+` are ordinary characters in a blocked word, not syntax. */
function escapeForRegex(word: string): string {
  return word.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(words: string[]): RegExp | undefined {
  if (words.length === 0) {
    return undefined;
  }

  // Longest first, so a list holding both „arsch" and „arschloch" masks the longer one as one
  // mask rather than leaving „***loch" behind.
  const ordered = [...words].sort((a, b) => b.length - a.length);

  return new RegExp(ordered.map(escapeForRegex).join("|"), "giu");
}

async function pattern(): Promise<RegExp | undefined> {
  if (cache !== undefined && cache.expiresAt > Date.now()) {
    return cache.pattern;
  }

  const rows = await db.selectFrom("blockedWord").select("word").execute();
  const compiled = compile(rows.map((row) => row.word));

  cache = { pattern: compiled, expiresAt: Date.now() + CACHE_TTL_MS };
  return compiled;
}

/** After any change to the list, so the instance that made it does not serve a stale mask. */
function forgetCachedWords(): void {
  cache = undefined;
}

/**
 * The masking itself, exported for its own test and for callers that already hold the pattern.
 * A fresh `lastIndex` matters: the regex is global, and a shared one carries its position between
 * calls, which would make every second string mask from the middle.
 */
export function applyMask(text: string, matcher: RegExp | undefined): string {
  if (matcher === undefined || text === "") {
    return text;
  }

  matcher.lastIndex = 0;
  return text.replaceAll(matcher, MASK);
}

/** One string. Everything that is prose and not a document goes through here. */
async function maskText(text: string): Promise<string> {
  return applyMask(text, await pattern());
}

/** The same for a value that may be absent, which most profile prose is. */
async function maskNullableText<T extends string | null>(text: T): Promise<T> {
  return (text === null ? text : await maskText(text)) as T;
}

/**
 * A document tree, masked in its `text` nodes and nowhere else.
 *
 * Rebuilt rather than mutated: the caller's value may be a cached query result, and rewriting it
 * in place would mask a row that a later read then serves from the same object.
 */
export function maskDocumentWith(
  document: PostDocument,
  matcher: RegExp | undefined,
): PostDocument {
  if (matcher === undefined) {
    return document;
  }

  const walk = (node: DocumentNode): DocumentNode => ({
    ...node,
    ...(node.text === undefined ? {} : { text: applyMask(node.text, matcher) }),
    ...(node.content === undefined ? {} : { content: node.content.map(walk) }),
  });

  return walk(document as DocumentNode) as PostDocument;
}

async function maskDocument(document: PostDocument): Promise<PostDocument> {
  return maskDocumentWith(document, await pattern());
}

/**
 * Both halves of a post at once, sharing one compiled pattern rather than resolving it per field.
 * A page of twenty posts is forty maskings, and the pattern lookup is the only part that can hit
 * the database.
 */
async function maskPosts<
  T extends { document: PostDocument; text?: string },
>(posts: T[]): Promise<T[]> {
  const matcher = await pattern();

  if (matcher === undefined) {
    return posts;
  }

  return posts.map((post) => ({
    ...post,
    document: maskDocumentWith(post.document, matcher),
    ...(post.text === undefined ? {} : { text: applyMask(post.text, matcher) }),
  }));
}

/** Alphabetical: this is a list somebody reads to find out whether something is on it. */
async function listBlockedWords(): Promise<BlockedWord[]> {
  const rows = await db
    .selectFrom("blockedWord")
    .leftJoin("user", "user.id", "blockedWord.addedBy")
    .select([
      "blockedWord.word",
      "blockedWord.addedAt",
      "blockedWord.note",
      "user.id as addedById",
      "user.username as addedByUsername",
    ])
    .orderBy("blockedWord.word", "asc")
    .execute();

  return rows.map((row) => ({
    word: row.word,
    addedAt: row.addedAt,
    note: row.note,
    addedBy: row.addedById === null || row.addedByUsername === null
      ? null
      : { id: row.addedById, username: row.addedByUsername },
  }));
}

/** Adding a word already on the list only refreshes its note and who added it. */
async function blockWord(
  word: string,
  addedBy: string,
  note: string | null,
): Promise<void> {
  await db
    .insertInto("blockedWord")
    .values({ word: word.trim().toLowerCase(), addedBy, note })
    .onConflict((conflict) =>
      conflict.column("word").doUpdateSet({ note, addedBy })
    )
    .execute();

  forgetCachedWords();
}

async function unblockWord(word: string): Promise<void> {
  await db
    .deleteFrom("blockedWord")
    .where("word", "=", word.trim().toLowerCase())
    .execute();

  forgetCachedWords();
}

export const WordFilterService = {
  listBlockedWords,
  blockWord,
  unblockWord,
  maskText,
  maskNullableText,
  maskDocument,
  maskPosts,
  forgetCachedWords,
};
