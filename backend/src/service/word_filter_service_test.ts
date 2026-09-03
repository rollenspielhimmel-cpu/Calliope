import { assertEquals } from "@std/assert";
import { db } from "@/src/database/client.ts";
import type { PostDocument } from "@/src/document/document_schema.ts";
import { WordFilterService } from "@/src/service/word_filter_service.ts";

/**
 * The masking, which is the whole of this feature — the list around it is a table with three
 * columns.
 *
 * The rule it exists to keep is that **nothing is ever rewritten in storage**. Two tests below say
 * so directly: a word added after the fact masks text already written, and taking the word off
 * again gives the original back, letter for letter. If either stops holding, the feature has
 * quietly become the thing it was built not to be.
 *
 * Its own words, and it clears the service's cache around every one of them: the compiled matcher
 * is shared process-wide, so a file that left a word behind would mask a neighbour's fixtures.
 */

const TEST_WORDS = ["dummkopf", "quatschkram", "arsch", "arschloch"];

async function block(...words: string[]) {
  for (const word of words) {
    // deno-lint-ignore no-await-in-loop -- a handful, and the order is what some tests are about
    await db
      .insertInto("blockedWord")
      .values({ word })
      .onConflict((conflict) => conflict.column("word").doNothing())
      .execute();
  }

  WordFilterService.forgetCachedWords();
}

Deno.test.beforeEach(async () => {
  await db.deleteFrom("blockedWord").where("word", "in", TEST_WORDS).execute();
  WordFilterService.forgetCachedWords();
});

Deno.test.afterEach(async () => {
  await db.deleteFrom("blockedWord").where("word", "in", TEST_WORDS).execute();
  WordFilterService.forgetCachedWords();
});

function documentSaying(...paragraphs: string[]): PostDocument {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  } as PostDocument;
}

Deno.test("an empty list changes nothing at all", async () => {
  const text = "Ein ganz gewöhnlicher Satz.";

  assertEquals(await WordFilterService.maskText(text), text);
});

Deno.test("a blocked word is masked as three asterisks, whatever its length", async () => {
  await block("dummkopf");

  // Not one asterisk per letter: a mask that measures the word is half a hint.
  assertEquals(
    await WordFilterService.maskText("So ein Dummkopf!"),
    "So ein ***!",
  );
});

Deno.test("the match ignores case", async () => {
  await block("dummkopf");

  assertEquals(
    await WordFilterService.maskText("DUMMKOPF, Dummkopf, dummkopf"),
    "***, ***, ***",
  );
});

Deno.test("a word inside a compound is masked, which is the point of substring matching", async () => {
  await block("arsch");

  // German compounds are why this is not whole-word matching: „Arschgeweih" would otherwise
  // print in full while „Arsch" alone was masked.
  assertEquals(
    await WordFilterService.maskText("Ein Arschgeweih."),
    "Ein ***geweih.",
  );
});

Deno.test("the longer of two overlapping entries wins", async () => {
  await block("arsch", "arschloch");

  // Shortest-first would leave „***loch" standing, which names the word it was hiding.
  assertEquals(await WordFilterService.maskText("du arschloch"), "du ***");
});

Deno.test("every occurrence in one text is masked, not only the first", async () => {
  await block("quatschkram");

  assertEquals(
    await WordFilterService.maskText("quatschkram und quatschkram"),
    "*** und ***",
  );
});

Deno.test("two texts in a row are both masked from the start", async () => {
  await block("dummkopf");

  // The compiled matcher is global and shared. Without resetting `lastIndex` the second call
  // resumes where the first stopped and masks nothing, or masks from the middle.
  assertEquals(await WordFilterService.maskText("dummkopf"), "***");
  assertEquals(await WordFilterService.maskText("dummkopf"), "***");
});

Deno.test("a document is masked in its text nodes and keeps its shape", async () => {
  await block("dummkopf");

  const masked = await WordFilterService.maskDocument(
    documentSaying("Hallo dummkopf", "Und noch ein Absatz"),
  );

  assertEquals(masked, documentSaying("Hallo ***", "Und noch ein Absatz"));
});

Deno.test("masking a document does not touch the one handed in", async () => {
  await block("dummkopf");

  const original = documentSaying("Hallo dummkopf");
  await WordFilterService.maskDocument(original);

  // Rebuilt, never mutated: the caller's value may be a cached row, and rewriting it in place
  // would mask storage after all — through the back door.
  assertEquals(original, documentSaying("Hallo dummkopf"));
});

Deno.test("a post is masked in its document and its text projection together", async () => {
  await block("dummkopf");

  const [masked] = await WordFilterService.maskPosts([
    { document: documentSaying("Hallo dummkopf"), text: "Hallo dummkopf" },
  ]);

  assertEquals(masked?.text, "Hallo ***");
  assertEquals(masked?.document, documentSaying("Hallo ***"));
});

Deno.test("a word added afterwards masks what was already written", async () => {
  const written = "So ein Dummkopf.";

  // Nothing is masked while the list is empty — this is the text as it sits in the database.
  assertEquals(await WordFilterService.maskText(written), written);

  await block("dummkopf");

  // The same string, now masked, without a single row having been rewritten.
  assertEquals(await WordFilterService.maskText(written), "So ein ***.");
});

Deno.test("taking a word off the list gives the original text back", async () => {
  const written = "So ein Dummkopf.";

  await block("dummkopf");
  assertEquals(await WordFilterService.maskText(written), "So ein ***.");

  await WordFilterService.unblockWord("dummkopf");

  // The reason the mask is a read-time filter: this is only possible because the row was never
  // touched. A filter that rewrote on save could not undo itself.
  assertEquals(await WordFilterService.maskText(written), written);
});

Deno.test("a word carrying regex punctuation is matched literally", async () => {
  await db
    .insertInto("blockedWord")
    .values({ word: "a.b" })
    .onConflict((conflict) => conflict.column("word").doNothing())
    .execute();
  WordFilterService.forgetCachedWords();

  try {
    // `.` is a character here, not "any character": „axb" must survive.
    assertEquals(await WordFilterService.maskText("axb"), "axb");
    assertEquals(await WordFilterService.maskText("a.b"), "***");
  } finally {
    await db.deleteFrom("blockedWord").where("word", "=", "a.b").execute();
    WordFilterService.forgetCachedWords();
  }
});

Deno.test("null prose stays null rather than becoming an empty string", async () => {
  await block("dummkopf");

  assertEquals(await WordFilterService.maskNullableText(null), null);
  assertEquals(
    await WordFilterService.maskNullableText("dummkopf"),
    "***",
  );
});
