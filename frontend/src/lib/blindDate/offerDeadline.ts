/**
 * Whether an offered plot still takes applications.
 *
 * Asked in two places — the page, which says so beside the plot, and the rail, which stops offering
 * the button — and they have to agree, so the question is answered once here rather than twice by
 * hand.
 *
 * The server asks it again when the application arrives. This is not the check; it is what keeps a
 * member from filling in a form that will be refused.
 */
export function applicationsHaveClosed(closesAt: string | null, now: Date = new Date()): boolean {
  return closesAt !== null && new Date(closesAt) <= now
}
