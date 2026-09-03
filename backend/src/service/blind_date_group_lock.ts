import { db } from "@/src/database/client.ts";

/**
 * Three things nobody may do to a group while its Blind-Date is still anonymous.
 *
 * The two people in it are **both administrators** — neither stands above the other, which is the
 * right shape for a group two strangers share. An administrator may ordinarily rename the group,
 * rename a thread and invite somebody, and all three reach straight through the anonymity: a group
 * renamed to something one of them is known for, a thread titled after a character from their other
 * stories, a third person let in who knows them both.
 *
 * So these three are refused here regardless of role. Not a punishment and not a statement about
 * trust — the anonymity is the thing both of them agreed to, and a rule that depends on nobody
 * thinking of it is not a rule.
 *
 * **Keyed on `authors_are_pseudonymous`**, the same flag the reveal clears. It therefore lifts by
 * itself the moment the two of them decide it should, and a revealed Blind-Date is an ordinary
 * group in this respect as in every other. Nothing here is permanent.
 *
 * Deliberately not `blind_date_pair`: a group is locked because it is *pseudonymous*, and reading
 * the flag that says so keeps the rule and its reason the same sentence.
 */

/**
 * Said for all three, because it describes the rule rather than the attempt. Somebody who tried to
 * rename a thread learns why, and also learns what else waits — which saves them finding out one
 * refusal at a time.
 */
export const PSEUDONYMOUS_GROUP_REFUSAL =
  "Solange euer Blind-Date anonym ist, bleiben Gruppenname, Thread-Titel und Mitglieder so, wie das Team sie angelegt hat. Nach der Enthüllung könnt ihr alles davon ändern.";

export async function isPseudonymous(writingGroupId: string): Promise<boolean> {
  const group = await db
    .selectFrom("writingGroup")
    .select("authorsArePseudonymous")
    .where("id", "=", writingGroupId)
    .executeTakeFirst();

  // A group that is not there is not locked; the route's own 404 says the rest.
  return group?.authorsArePseudonymous === true;
}
