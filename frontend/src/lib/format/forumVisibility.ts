import type { CreateSubForumBodyVisibility, GetCurrentUser200PlatformRole } from '@/api/models'

/**
 * Named once here rather than aliased at each call site. Orval writes a separate enum per
 * operation, all four identical because the spec has one `FORUM_VISIBILITY_SCHEMA` behind them;
 * this picks one and makes it the name the interface uses.
 */
export type ForumVisibility = CreateSubForumBodyVisibility

/**
 * Who may read a sub-forum or a thread, in words rather than the enum's.
 *
 * One place, because there are now three: the administration form, the forum's front page and the
 * dialog moderation narrows a thread with. „Nur Moderation" appearing as „Moderationsteam" in one
 * of them would read as a different setting rather than the same one.
 *
 * The enum is declared open-to-closed, and this object keeps that order — it is iterated to build
 * the choices in a form, so the order here is the order somebody reads them in.
 */
export const FORUM_VISIBILITY_LABELS: Record<ForumVisibility, string> = {
  everyone: 'Alle, auch ohne Konto',
  members: 'Alle Mitglieder',
  moderation: 'Nur Moderation',
  administration: 'Nur Administration',
}

/**
 * The short mark beside a title, and only where it is not the ordinary case: a sub-forum open to
 * members says nothing, because that is what a forum is. Said once, next to the thing it is about
 * — the same rule a group's privacy mark follows.
 */
export function restrictedForumLabel(visibility: ForumVisibility): string | undefined {
  return visibility === 'moderation' || visibility === 'administration'
    ? FORUM_VISIBILITY_LABELS[visibility]
    : undefined
}

/** Ascending strictness, matching the enum's declaration order and the backend's `RANK`. */
const RANK: Record<ForumVisibility, number> = {
  everyone: 0,
  members: 1,
  moderation: 2,
  administration: 3,
}

/**
 * The levels this account may set, which is the same rule the API applies: nobody may put a thread
 * beyond their own reach, because they could then not bring it back. Offering the refused option
 * and letting the request fail would be telling somebody they may do something and then refusing.
 */
export function reachableVisibilities(
  role: GetCurrentUser200PlatformRole | null | undefined,
): ForumVisibility[] {
  const ceiling: ForumVisibility =
    role === 'administrator' ? 'administration' : role === 'moderator' ? 'moderation' : 'members'

  return (Object.keys(FORUM_VISIBILITY_LABELS) as ForumVisibility[]).filter(
    (visibility) => RANK[visibility] <= RANK[ceiling],
  )
}
