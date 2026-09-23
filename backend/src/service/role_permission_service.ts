import { db, type Transaction } from "@/src/database/client.ts";
import type {
  PlatformPermission,
  PlatformRole,
} from "@/src/database/schema.ts";

/**
 * Which role may do what beyond its name — `platform_role_permission`.
 *
 * **Only the first administrator changes this**, as it does the sender list: a role that could be
 * given the right to prepare publications by any administrator would be a way to hand the team's
 * voice to somebody without the account that stands above the roles noticing.
 *
 * Administrators are not in the table and cannot be put there — the database refuses the row. They
 * may everything, and `mayPreparePublications` says so; see the migration for why.
 */

/** Every role that can be given something, i.e. every role but the one that has everything. */
export type GrantableRole = Exclude<PlatformRole, "administrator">;

export type RolePermission = {
  role: GrantableRole;
  permission: PlatformPermission;
  grantedByUsername: string | null;
  grantedAt: string;
};

async function list(): Promise<RolePermission[]> {
  const rows = await db
    .selectFrom("platformRolePermission")
    .leftJoin("user", "user.id", "platformRolePermission.grantedBy")
    .select([
      "platformRolePermission.role",
      "platformRolePermission.permission",
      "user.username as grantedByUsername",
      "platformRolePermission.grantedAt",
    ])
    .orderBy("platformRolePermission.role")
    .orderBy("platformRolePermission.permission")
    .execute();

  // The CHECK constraint keeps `administrator` out, which Kysely cannot carry into the type.
  return rows.map((row) => ({ ...row, role: row.role as GrantableRole }));
}

/** Idempotent: granting what is already granted keeps the first grant's who and when. */
async function grant(
  transaction: Transaction,
  role: GrantableRole,
  permission: PlatformPermission,
  grantedBy: string,
): Promise<void> {
  await transaction
    .insertInto("platformRolePermission")
    .values({ role, permission, grantedBy })
    .onConflict((conflict) => conflict.doNothing())
    .execute();
}

/**
 * Takes effect with the next request of everybody holding the role: the permission rides on the
 * session user, and the session user is read afresh each time.
 */
async function revoke(
  transaction: Transaction,
  role: GrantableRole,
  permission: PlatformPermission,
): Promise<void> {
  await transaction
    .deleteFrom("platformRolePermission")
    .where("role", "=", role)
    .where("permission", "=", permission)
    .execute();
}

export const RolePermissionService = { list, grant, revoke };
