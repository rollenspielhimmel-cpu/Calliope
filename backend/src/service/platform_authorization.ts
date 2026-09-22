import type { PlatformRole } from "@/src/database/schema.ts";

/**
 * Roles on the account, for the site as a whole. The group-level twin of this file is
 * `writing_group_authorization.ts`, and the two must not be confused: administering a writing
 * group is authority over that group's content and confers nothing here.
 *
 * `null` is the ordinary member, which is almost everybody, so both predicates take it.
 */

/** Moderators act on content and accounts; administrators may do everything a moderator may. */
export function mayModeratePlatform(role: PlatformRole | null): boolean {
  return role === "moderator" || role === "administrator";
}

/** Reserved for what changes the platform itself, granting a role included. */
export function mayAdministerPlatform(role: PlatformRole | null): boolean {
  return role === "administrator";
}

/**
 * Writing broadcasts and official threads, submitting them, reading the queue — not releasing them,
 * which stays `mayAdministerPlatform`.
 *
 * **A permission a role is given, not a role.** Which roles hold it is `platform_role_permission`,
 * carried on the session user; administrators hold it without a row, because being able to take it
 * from them would be a way to lock them out of approving what they write themselves.
 */
export function mayPreparePublications(
  user: { platformRole: PlatformRole | null; permissions: readonly string[] },
): boolean {
  return mayAdministerPlatform(user.platformRole) ||
    user.permissions.includes("prepare_publications");
}
