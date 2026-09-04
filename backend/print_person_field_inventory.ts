import { personFieldsByRoute } from "@/src/http/person_field_scan.ts";
import { PERSON_FIELD_INVENTORY } from "@/src/http/person_field_inventory.ts";

/**
 * Prints `person_field_inventory.ts`'s entries as they would be now.
 *
 *     deno task person-fields:inventory
 *
 * Run it when `person_field_inventory_test.ts` fails, paste the result over the entries, and give
 * anything new a reason. It carries reasons already decided across, so nothing has to be looked up
 * twice — but a route it has never seen gets `TODO`, which does not compile against `Reason` and
 * therefore cannot be pasted and forgotten.
 */
const known = new Map(
  PERSON_FIELD_INVENTORY.map((entry) => [entry.route, entry.reason]),
);

const found = await personFieldsByRoute();

const entries = [...found.entries()]
  .toSorted(([a], [b]) => a.localeCompare(b))
  .map(([route, fields]) => {
    const reason = known.get(route) ?? "TODO";
    const list = fields.map((field) => JSON.stringify(field)).join(", ");
    return `  {\n    route: ${
      JSON.stringify(route)
    },\n    fields: [${list}],\n    reason: ${JSON.stringify(reason)},\n  },`;
  });

console.log(entries.join("\n"));

const todo = [...found.keys()].filter((route) => !known.has(route));

if (todo.length > 0) {
  console.error(
    `\n${todo.length} route(s) need a reason — they are marked "TODO" above:\n${
      todo.map((route) => `  ${route}`).join("\n")
    }`,
  );
}
