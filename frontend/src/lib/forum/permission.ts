import type { ForumPermission } from '@/lib/format/forum'

/**
 * Whether this viewer may write to a row of the forum — the mirror of the backend's
 * `mayActInForum`, and one function for the same reason that is one table.
 *
 * A row cannot answer it alone: `effectiveMemberPermission` is what **members** get, deliberately,
 * so that an operator can still be shown which rows are hidden. An operator passes whatever it
 * says (#21), which is why the two arguments are needed together.
 *
 * It decides an *affordance*, never access — the API checks again, and is the only thing that
 * can refuse.
 */
export function mayWriteInForum(
  permission: ForumPermission | undefined,
  isOperator: boolean,
): boolean {
  return isOperator || permission === 'write'
}

/**
 * Ob „Nicht mehr offiziell" angeboten wird.
 *
 * **Nur dort, wo es etwas zurückzunehmen gibt.** Ein Thread, der als offizieller geschrieben
 * wurde, hat keinen früheren Namen — die API weist es ab, und tat das auch vorher schon. Aber ein
 * Knopf, der in der Hälfte der Fälle nur eine Absage holt, ist kein Knopf.
 *
 * `madeOfficialAfterwards` ist `null` für alle außer der Administration, weil es niemanden sonst
 * etwas angeht. Also entscheidet hier `=== true` und nicht „nicht falsch": Wer die Angabe nicht
 * bekommt, bekommt auch den Knopf nicht, und die API hätte ihn ohnehin abgewiesen.
 */
export function mayUnmakeOfficial(
  thread: { isOfficial: boolean; madeOfficialAfterwards: boolean | null } | undefined,
  isAdministrator: boolean,
): boolean {
  return isAdministrator && thread?.isOfficial === true && thread.madeOfficialAfterwards === true
}
