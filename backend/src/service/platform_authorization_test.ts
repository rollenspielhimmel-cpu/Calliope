import { assertEquals } from "@std/assert";
import { PLATFORM_ROLES } from "@/src/database/schema.ts";
import {
  mayAdministerPlatform,
  mayModeratePlatform,
  mayPreparePublications,
} from "./platform_authorization.ts";

Deno.test("no role may do nothing", () => {
  assertEquals(mayModeratePlatform(null), false);
  assertEquals(mayAdministerPlatform(null), false);
});

Deno.test("administrator is a superset of moderator", () => {
  assertEquals(mayModeratePlatform("moderator"), true);
  assertEquals(mayModeratePlatform("administrator"), true);

  assertEquals(mayAdministerPlatform("moderator"), false);
  assertEquals(mayAdministerPlatform("administrator"), true);
});

Deno.test("every role the database allows is answered for", () => {
  // A role added to the enum without a decision here would otherwise default to "may not",
  // silently, wherever it was granted.
  for (const role of PLATFORM_ROLES) {
    assertEquals(
      mayModeratePlatform(role) || mayAdministerPlatform(role),
      true,
      `${role} can do nothing at all — is it handled?`,
    );
  }
});

/**
 * **Vorbereiten ist eine Berechtigung, keine Rolle.** Was zählt, ist die Liste am Konto — außer bei
 * Administrationen, die alles dürfen, auch ohne Zeile. Sonst ließen sie sich aus dem Vorbereiten
 * aussperren und damit aus der Freigabe dessen, was sie selbst schreiben.
 */
Deno.test("preparing publications follows the role's permissions, and administrators always may", () => {
  assertEquals(
    mayPreparePublications({
      platformRole: "moderator",
      permissions: ["prepare_publications"],
    }),
    true,
  );
  assertEquals(
    mayPreparePublications({ platformRole: "moderator", permissions: [] }),
    false,
    "einer Rolle entzogen, heißt: nicht mehr",
  );
  assertEquals(
    mayPreparePublications({ platformRole: "administrator", permissions: [] }),
    true,
    "Administrationen brauchen keine Zeile",
  );
  assertEquals(
    mayPreparePublications({ platformRole: null, permissions: [] }),
    false,
  );
});
