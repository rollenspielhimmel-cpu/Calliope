import { db } from "@/src/database/client.ts";
import { ENDED_BECAUSE_NAME_REVEALED } from "@/src/service/blind_date_ended_reason.ts";
import { nameMatcherFor } from "@/src/service/blind_date_name_guard_service.ts";

/**
 * Who a member is called inside a group whose authors are pseudonymous.
 *
 * Blind-Date is the reason this exists: two people write together with their real accounts and
 * find out who the other is only when they both decide to. Everything that names an author inside
 * such a group has to go through here, because one surface that forgets prints a real name and
 * **that cannot be taken back**.
 *
 * The shape of the safeguard is deliberate. This resolves a whole group's mapping in one query and
 * hands back a function, so a caller masking twenty posts asks the database once. And the thing
 * that actually keeps it honest is not this file but `blind_date_leak_test.ts`, which calls every
 * endpoint that can return anything about such a group and asserts the real usernames appear in no
 * response body at all. A new endpoint that forgets is a failing test, not a disclosure.
 *
 * **The avatar goes with the name.** A picture identifies somebody at least as well as a username,
 * so a masked author has none — the interface draws the same placeholder it draws for anybody
 * without one.
 */

/**
 * Numbered from the sorted partner ids: arbitrary, and the same on every read, which is all the
 * label has to be. It is not the join order and not the account age — „Partner 1" saying who
 * registered first would be a hint, and hints are the whole thing being avoided here.
 */
const LABEL_PREFIX = "Blind-Date-Partner";

/** What a masked author looks like everywhere: a name, no picture, and no account to open. */
export type MaskedAuthor = { username: string; avatarUrl: null };

/**
 * The two real names, as a matcher that hides them wherever they appear in the group's prose.
 *
 * **Only once moderation has confirmed a leak**, and then in every post rather than only the one
 * that was reported: once a name is out it can be anywhere, including in posts written before the
 * guard existed. Before that confirmation nothing is masked at all — a username may be an ordinary
 * German word, and hiding „Rose" out of somebody's prose on a suspicion would disfigure innocent
 * writing exactly the way the automatic ending used to.
 *
 * Hidden at the read and never rewritten in the row, the same rule the blocked-word list follows,
 * so a revealed pair reads its own names back in full.
 */
export type GroupNameMask = {
  author: (userId: string | null) => MaskedAuthor;
  /** `undefined` when neither name is long enough to match on safely. */
  names: RegExp | undefined;
};

/**
 * Masks one group's authors, or does nothing at all.
 *
 * `undefined` for a group that is not pseudonymous — every caller checks for that rather than
 * calling a mask that happens to be the identity, so the ordinary path costs one comparison.
 */
export type GroupMask = ((userId: string | null) => MaskedAuthor) | undefined;

/** One row per author of the group, so the number is stable across every read. */
async function partnersOf(
  writingGroupId: string,
): Promise<Array<{ userId: string; username: string }>> {
  return await db
    .selectFrom("blindDatePartner")
    .innerJoin(
      "blindDatePair",
      "blindDatePair.id",
      "blindDatePartner.pairId",
    )
    .innerJoin("user", "user.id", "blindDatePartner.userId")
    .select(["blindDatePartner.userId", "user.username"])
    .where("blindDatePair.writingGroupId", "=", writingGroupId)
    .orderBy("blindDatePartner.userId", "asc")
    .execute();
}

function labelsFor(
  partners: Array<{ userId: string }>,
): Map<string, string> {
  return new Map(
    partners.map((
      partner,
      index,
    ) => [partner.userId, `${LABEL_PREFIX} ${index + 1}`]),
  );
}

/**
 * The mask for one group, or `undefined` where its authors are named openly.
 *
 * Two queries at most, and only for the groups that need them: the flag is read first, and the
 * partner list only where it is set.
 */
async function maskForGroup(writingGroupId: string): Promise<GroupMask> {
  return (await fullMaskForGroup(writingGroupId))?.author;
}

/** The whole mask — the author labels and the name matcher — for the paths that need both. */
async function fullMaskForGroup(
  writingGroupId: string,
): Promise<GroupNameMask | undefined> {
  const group = await db
    .selectFrom("writingGroup")
    .select("authorsArePseudonymous")
    .where("id", "=", writingGroupId)
    .executeTakeFirst();

  if (group === undefined || !group.authorsArePseudonymous) {
    return undefined;
  }

  const partners = await partnersOf(writingGroupId);
  const labels = labelsFor(partners);

  // Only a confirmed leak turns the names off. A suspicion under review changes nothing about how
  // the group reads: the post stays as written, with a notice beside it.
  const leaked = await db
    .selectFrom("blindDatePair")
    .select("id")
    .where("writingGroupId", "=", writingGroupId)
    .where("endedReason", "=", ENDED_BECAUSE_NAME_REVEALED)
    .executeTakeFirst();

  const author = (userId: string | null): MaskedAuthor => ({
    // Somebody who is in the group without being one of the two — an operator who joined, or a
    // deleted account — still gets a mask rather than their name. Falling back to the real name
    // for the case nobody thought of is exactly the wrong direction to fail in.
    username: (userId === null ? undefined : labels.get(userId)) ??
      `${LABEL_PREFIX} ?`,
    avatarUrl: null,
  });

  return {
    author,
    names: leaked === undefined
      ? undefined
      : nameMatcherFor(partners.map((partner) => partner.username)),
  };
}

/**
 * The same for several groups at once, which the group *list* needs: twenty groups must not be
 * twenty pairs of queries.
 */
async function masksForGroups(
  writingGroupIds: string[],
): Promise<Map<string, NonNullable<GroupMask>>> {
  const masks = new Map<string, NonNullable<GroupMask>>();

  if (writingGroupIds.length === 0) {
    return masks;
  }

  const pseudonymous = await db
    .selectFrom("writingGroup")
    .select("id")
    .where("id", "in", writingGroupIds)
    .where("authorsArePseudonymous", "=", true)
    .execute();

  if (pseudonymous.length === 0) {
    return masks;
  }

  const groupIds = pseudonymous.map((group) => group.id);

  const partners = await db
    .selectFrom("blindDatePartner")
    .innerJoin("blindDatePair", "blindDatePair.id", "blindDatePartner.pairId")
    .select(["blindDatePair.writingGroupId", "blindDatePartner.userId"])
    .where("blindDatePair.writingGroupId", "in", groupIds)
    .orderBy("blindDatePartner.userId", "asc")
    .execute();

  const byGroup = new Map<string, string[]>();

  for (const partner of partners) {
    const held = byGroup.get(partner.writingGroupId) ?? [];
    held.push(partner.userId);
    byGroup.set(partner.writingGroupId, held);
  }

  for (const groupId of groupIds) {
    const labels = new Map(
      (byGroup.get(groupId) ?? []).map((
        userId,
        index,
      ) => [userId, `${LABEL_PREFIX} ${index + 1}`]),
    );

    masks.set(groupId, (userId) => ({
      username: (userId === null ? undefined : labels.get(userId)) ??
        `${LABEL_PREFIX} ?`,
      avatarUrl: null,
    }));
  }

  return masks;
}

/**
 * **The report queue is deliberately not masked, and needs nothing here to stay that way.**
 * `report_service` and `visible_target` read the author straight from `user`, never through a
 * group's projection, so an operator judging a report from a Blind-Date sees who wrote it. A
 * pseudonym is not somebody anybody can act on, and that queue already carries the real excerpt.
 *
 * There is deliberately no "may see through the mask" helper. A reader-dependent unmask is one
 * `if` away from being applied where it does not belong, and the only place that needs the real
 * name already has it without asking.
 */

export const PseudonymService = {
  maskForGroup,
  fullMaskForGroup,
  masksForGroups,
};
