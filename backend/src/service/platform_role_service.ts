import { db } from "@/src/database/client.ts";
import type { PlatformRole } from "@/src/database/schema.ts";

/**
 * Who holds a platform role, and granting or revoking one. The two roles are the enum's own and
 * are not extended here: adding a third — a mediator, an event manager — means replacing a fixed
 * enum with something the operators can define, which is a decision of its own rather than a
 * column change.
 *
 * `grant_role.ts` does the same thing from the command line and stays: the *first* administrator
 * has to come from somewhere, and nobody can grant a role through this until one exists.
 */

export type Operator = {
  id: string;
  username: string;
  platformRole: PlatformRole;
  isPrimordialAdmin: boolean;
  createdAt: string;
};

/** Administrators first, then alphabetically: the shorter list is the one being looked for. */
async function listOperators(): Promise<Operator[]> {
  const rows = await db
    .selectFrom("user")
    .select([
      "id",
      "username",
      "platformRole",
      "createdAt",
      "isPrimordialAdmin",
    ])
    .where("platformRole", "is not", null)
    .orderBy("platformRole", "asc")
    .orderBy("username", "asc")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    // Narrowed by the `is not null` above, which Kysely cannot carry into the column's type.
    platformRole: row.platformRole as PlatformRole,
    isPrimordialAdmin: row.isPrimordialAdmin,
    createdAt: row.createdAt,
  }));
}

export type RoleRefusal =
  | "not_found"
  | "is_self"
  | "is_banned"
  | "is_primordial"
  | "administrator_is_reserved";

/**
 * Granting is also revoking: `null` is the ordinary member, so one route covers both and there
 * is no state where a member has been un-granted but not yet made ordinary.
 *
 * Nobody may change their own role. That stops an administrator demoting themselves out of the
 * last administrator seat, and it is the same shape as the rule that an operator cannot ban
 * themselves — power is taken away by somebody else, never by oneself in passing.
 *
 * Two further rules keep the first administrator above the rest: its own role cannot be touched
 * by anybody, and only it may grant or revoke `administrator`. See the refusals below.
 */
async function setRole(
  userId: string,
  role: PlatformRole | null,
  actingAs: { id: string; isPrimordialAdmin: boolean },
): Promise<RoleRefusal | undefined> {
  if (userId === actingAs.id) {
    return "is_self";
  }

  const target = await db
    .selectFrom("user")
    .select(["id", "bannedAt", "platformRole", "isPrimordialAdmin"])
    .where("id", "=", userId)
    .executeTakeFirst();

  if (target === undefined) {
    return "not_found";
  }

  // Nothing reaches the first administrator's role. The database refuses this as well — see the
  // CHECK constraint in the migration — so this exists to answer with a sentence rather than a
  // 500, not to be the guarantee.
  if (target.isPrimordialAdmin) {
    return "is_primordial";
  }

  // The administrator role is the first administrator's to give and to take back. An ordinary
  // administrator appoints moderators and no more, so the set of administrators can only be
  // changed by the one account that cannot itself be changed — otherwise an administrator could
  // appoint a second, who could remove the first, and the level above the roles would mean
  // nothing.
  if (
    !actingAs.isPrimordialAdmin &&
    (role === "administrator" || target.platformRole === "administrator")
  ) {
    return "administrator_is_reserved";
  }

  // A banned account cannot be given a role, because an account holding one cannot be banned:
  // granting first would be a way to make a ban unliftable by anybody but an administrator.
  if (role !== null && target.bannedAt !== null) {
    return "is_banned";
  }

  await db
    .updateTable("user")
    .set({ platformRole: role })
    .where("id", "=", userId)
    .execute();

  return undefined;
}

export const PlatformRoleService = { listOperators, setRole };
