import { PERSON_FIELDS } from "@/src/service/person_fields.ts";

/**
 * Which responses in the generated interface document can name a person.
 *
 * Read from `open-api.json` rather than from the route files: that document is produced from the
 * routes by `deno task open-api:generate`, so it cannot omit an endpoint somebody forgot to
 * mention anywhere. Used by the inventory test, and by the task that prints the inventory when a
 * route changes.
 *
 * The field names come from `person_fields.ts` — the same list the masking uses. A seventh field
 * added there appears here on the next run, which is the point of having one list.
 */

const DOCUMENT = new URL("../../open-api.json", import.meta.url);

const PERSON_FIELD_NAMES = new Set(PERSON_FIELDS.map((field) => field.id));

/**
 * Every person field anywhere inside a response, however deeply nested.
 *
 * Walks the whole subtree rather than reading the top level: a response is a page with `results`,
 * whose entries are the objects that name anybody, and the sections of the search sit one level
 * deeper again. Depth is where the last two gaps were.
 */
function personFieldsIn(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const entry of node) {
      personFieldsIn(entry, found);
    }
    return;
  }

  if (node === null || typeof node !== "object") {
    return;
  }

  const object = node as Record<string, unknown>;
  const properties = object.properties;

  if (properties !== null && typeof properties === "object") {
    for (const name of Object.keys(properties as Record<string, unknown>)) {
      if (PERSON_FIELD_NAMES.has(name)) {
        found.add(name);
      }
    }
  }

  for (const value of Object.values(object)) {
    personFieldsIn(value, found);
  }
}

/** `METHOD /path` to the sorted person fields its responses can carry. */
export async function personFieldsByRoute(): Promise<Map<string, string[]>> {
  const document = JSON.parse(await Deno.readTextFile(DOCUMENT)) as {
    paths?: Record<string, Record<string, { responses?: unknown }>>;
  };

  const byRoute = new Map<string, string[]>();

  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const found = new Set<string>();
      personFieldsIn(operation.responses, found);

      if (found.size > 0) {
        byRoute.set(`${method.toUpperCase()} ${path}`, [...found].toSorted());
      }
    }
  }

  return byRoute;
}
