/**
 * Shortens a plot description for a card, at a word.
 *
 * **Explicitly, and not with `-webkit-line-clamp`.** That property does the visual half well and
 * the rest not at all: whether the ellipsis appears, and whether it appears where the text actually
 * stops, differs between browsers — and there is no way to ask it whether it cut anything, which is
 * what decides if „Weiterlesen" belongs under the card. A count of characters is the same
 * everywhere and answers both questions.
 *
 * The cut lands on the last space before the limit, so a word is never split. A text with no space
 * in its first `limit` characters — one very long word — is cut where the limit falls, because the
 * alternative is showing all of it.
 *
 * The ellipsis is a real character in the returned string, not a pseudo-element: it has to survive
 * being copied, read aloud and rendered by anything.
 */
export const CARD_DESCRIPTION_LIMIT = 280

export type Shortened = {
  text: string
  /** True where something was left out, which is the only reason to offer „Weiterlesen". */
  wasCut: boolean
}

export function shortenForCard(
  description: string,
  limit: number = CARD_DESCRIPTION_LIMIT,
): Shortened {
  const text = description.trim()

  if (text.length <= limit) {
    return { text, wasCut: false }
  }

  const upToLimit = text.slice(0, limit)
  const lastSpace = upToLimit.lastIndexOf(' ')

  // A comma or a full stop left hanging before the ellipsis reads like a typo rather than a cut.
  const cut = (lastSpace > 0 ? upToLimit.slice(0, lastSpace) : upToLimit).replace(
    /[\s,;:.!?—–-]+$/u,
    '',
  )

  return { text: `${cut} …`, wasCut: true }
}
