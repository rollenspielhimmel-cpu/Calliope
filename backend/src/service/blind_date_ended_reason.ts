/**
 * Why a Blind-Date stopped being current, as tokens rather than prose.
 *
 * Written into `blind_date_pair.ended_reason`, whose CHECK ties it to `ended_at`: a pair that ended
 * always says why, and a revealed one never does — revealing is an ending nobody needs a reason
 * for.
 *
 * Here rather than beside the code that writes them, because three places read them and two of
 * them had the same string typed out by hand. A token that means „the anonymity was broken" is
 * asked about in one place and written in another, and those two must not be able to drift.
 */

/**
 * The name guard: somebody named themselves in „Gemeinsamer Austausch" and an operator confirmed
 * it. The one ending that is **not** a Blind-Date somebody saw through — it is the ritual failing,
 * which is why it does not count towards what a member has completed.
 */
export const ENDED_BECAUSE_NAME_REVEALED = "name_revealed";

/**
 * One of the two ended it themselves. Either may, alone — see `blind_date_ending_service.ts` for
 * why that is not symmetrical with revealing, which needs both.
 *
 * The pair also records **who**, in `ended_by`, which is what keeps the moderation table from
 * putting the same mark on the person who was left as on the person who left.
 */
export const ENDED_BECAUSE_A_PARTNER_LEFT = "ended_by_partner";
