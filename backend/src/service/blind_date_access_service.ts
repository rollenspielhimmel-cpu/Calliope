import { db } from "@/src/database/client.ts";
import type { User } from "@/src/service/user_service.ts";
import { mayModeratePlatform } from "@/src/service/platform_authorization.ts";

/**
 * Who may work the Blind-Date desk, and why somebody may not.
 *
 * Three conditions, and the interface says which one failed rather than showing a locked door: the
 * menu entry stays where it is for everybody on the team, and the page explains itself. A hidden
 * entry is a feature people ask about in chat; a refused one answers itself.
 *
 * **1. An operator.** Anybody working this desk is already a moderator or an administrator.
 *
 * **2. The right itself.** Granted by name and only by the root administrator — see the migration
 * that adds the column. Being a moderator is not enough: who is hoping to be paired with whom is
 * the most personal thing on this platform, and the team wanted that given out deliberately.
 *
 * **3. No application of one's own that is still open.**
 *
 * The third is the one worth the words. A manager may apply for a Blind-Date like anybody else —
 * that is the point, and the desk says so out loud so nobody has to guess. But from the moment they
 * do, they see nothing here: not the queue, not their own application in it, not who else is
 * waiting. Otherwise they would be reading the queue they are standing in, and would know exactly
 * who was still unmatched when their turn came.
 *
 * **Derived from the application, never stored.** The rule is „while your own application is open",
 * and the application already knows whether it is open. A flag beside it would have to be set on
 * applying, cleared on matching, cleared again on withdrawing, and cleared by hand the first time
 * any of those paths grew a case nobody thought of — and each of those is a chance to keep an
 * access one should not have. Nothing to forget here.
 *
 * **The root administrator is exempt from the third condition**, and from nothing else. Somebody
 * has to be able to work the desk while a manager waits, and that is the account named for it. If
 * the root administrator applies as well, they still see the queue — but `matchApplications` will
 * not let them pair themselves, and that refusal has no exceptions at all.
 */

export type AccessRefusal =
  /** Not on the team. */
  | "not_an_operator"
  /** On the team, but this right was never granted. */
  | "not_granted"
  /** Has the right, and an application of their own that has not been settled. */
  | "own_application_open";

export type Access = {
  granted: boolean;
  refusal?: AccessRefusal;
  /**
   * True for the root administrator, who additionally may grant and revoke this right. The
   * interface shows the granting section only to them.
   */
  mayGrant: boolean;
};

/** Whether this member has an application nobody has decided on yet. */
async function hasOpenApplication(userId: string): Promise<boolean> {
  const application = await db
    .selectFrom("blindDateApplication")
    .select("id")
    .where("userId", "=", userId)
    .where("status", "=", "pending")
    .executeTakeFirst();

  return application !== undefined;
}

async function accessFor(user: User): Promise<Access> {
  const mayGrant = user.isPrimordialAdmin;

  if (!mayModeratePlatform(user.platformRole)) {
    return { granted: false, refusal: "not_an_operator", mayGrant };
  }

  // The root administrator holds this right by being that account: it cannot be taken away, or
  // there would be a way to leave the desk with nobody who can reach it.
  if (!user.isPrimordialAdmin && !user.mayManageBlindDate) {
    return { granted: false, refusal: "not_granted", mayGrant };
  }

  if (!user.isPrimordialAdmin && await hasOpenApplication(user.id)) {
    return { granted: false, refusal: "own_application_open", mayGrant };
  }

  return { granted: true, mayGrant };
}

/** Everybody who holds the right, for the root administrator's own list. */
export type Manager = {
  id: string;
  username: string;
  /** True while their own application is open, which is why they cannot see the desk right now. */
  isSuspended: boolean;
};

async function listManagers(): Promise<Manager[]> {
  const rows = await db
    .selectFrom("user")
    .leftJoin("blindDateApplication", (join) =>
      join
        .onRef("blindDateApplication.userId", "=", "user.id")
        .on("blindDateApplication.status", "=", "pending"))
    .select((eb) => [
      "user.id",
      "user.username",
      eb("blindDateApplication.id", "is not", null).as("isSuspended"),
    ])
    .where("user.mayManageBlindDate", "=", true)
    .orderBy("user.username", "asc")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    isSuspended: row.isSuspended === true,
  }));
}

export type GrantRefusal = "not_found" | "not_an_operator";

/**
 * Grants the right, or takes it away.
 *
 * Only to somebody who is on the team: the right decides what an operator may reach, and giving it
 * to a member who cannot reach the moderation at all would be a setting that does nothing and reads
 * as if it did.
 *
 * The root administrator is not in this list and cannot be added to it — they hold the right by
 * being that account, and a row saying so would suggest it could be removed.
 */
async function setManagement(
  userId: string,
  mayManage: boolean,
): Promise<GrantRefusal | undefined> {
  const user = await db
    .selectFrom("user")
    .select(["id", "platformRole", "isPrimordialAdmin"])
    .where("id", "=", userId)
    .executeTakeFirst();

  if (user === undefined) {
    return "not_found";
  }

  if (user.isPrimordialAdmin || !mayModeratePlatform(user.platformRole)) {
    return "not_an_operator";
  }

  await db
    .updateTable("user")
    .set({ mayManageBlindDate: mayManage })
    .where("id", "=", userId)
    .execute();

  return undefined;
}

export const BlindDateAccessService = {
  accessFor,
  hasOpenApplication,
  listManagers,
  setManagement,
};
