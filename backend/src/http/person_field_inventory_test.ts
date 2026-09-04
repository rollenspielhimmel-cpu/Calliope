import { assertEquals } from "@std/assert";
import { PERSON_FIELD_INVENTORY } from "@/src/http/person_field_inventory.ts";
import { personFieldsByRoute } from "@/src/http/person_field_scan.ts";

/**
 * **The one that catches the case nobody thought of.**
 *
 * Every other guard here is a list somebody wrote: the leak test names the endpoints it knows, the
 * middleware covers the subtree it was pointed at. Both were in place while a group's pages printed
 * two real usernames for weeks, because a list written by a person cannot contain the route that
 * person has not seen.
 *
 * This one is not written by a person. It reads `open-api.json` — generated from the routes
 * themselves by `deno task open-api:generate` — and asks a question no list can dodge: which
 * responses can name somebody, and has each been decided about? A new endpoint carrying
 * `createdBy` fails this the moment it exists, and the failure says what to do.
 *
 * It deliberately does **not** check that anything is masked. It checks that somebody looked. The
 * masking guarantees live in `blind_date_leak_test.ts`, which asserts on real bodies; this file
 * guarantees that the set of places needing that scrutiny is complete rather than remembered.
 */

Deno.test("every response that can name a person has been decided about", async () => {
  const found = await personFieldsByRoute();

  const inventory = new Map(
    PERSON_FIELD_INVENTORY.map((entry) => [entry.route, entry]),
  );

  const missing = [...found.keys()]
    .filter((route) => !inventory.has(route))
    .toSorted();

  assertEquals(
    missing,
    [],
    `These responses can name a person and are not in person_field_inventory.ts.\n` +
      `Decide what each one is — masked, deliberately public, moderation only — and add it.\n` +
      `\`deno task person-fields:inventory\` prints the file's new contents.\n\n` +
      missing.map((route) => `  ${route}`).join("\n"),
  );

  const gone = [...inventory.keys()]
    .filter((route) => !found.has(route))
    .toSorted();

  assertEquals(
    gone,
    [],
    `These routes are in person_field_inventory.ts but no longer name anybody.\n` +
      `They were removed or their response changed; drop them from the file.\n\n` +
      gone.map((route) => `  ${route}`).join("\n"),
  );
});

/**
 * A route keeping its entry while gaining a field is the shape the search bug had: the endpoint was
 * listed and watched, and a section inside it was not. Comparing the fields themselves is what
 * turns „this route was looked at once" into „this response is looked at as it is now".
 */
Deno.test("no response has quietly gained a person field", async () => {
  const found = await personFieldsByRoute();

  for (const entry of PERSON_FIELD_INVENTORY) {
    const fields = found.get(entry.route);

    if (fields === undefined) {
      continue;
    }

    assertEquals(
      fields,
      [...entry.fields],
      `${entry.route} now carries different person fields than the inventory records.\n` +
        `If the new one is fine, update the entry — and check that whatever masks this route ` +
        `knows about it.`,
    );
  }
});
