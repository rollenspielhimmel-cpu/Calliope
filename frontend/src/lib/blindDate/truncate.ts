/**
 * Shortens a plot description for a card, at a word — and only when it does not fit.
 *
 * **The card decides, not a character count.** This counted to 280 and cut there, which meant a
 * plot of 293 characters ended in „…" while the box below it still had two empty lines: the
 * ellipsis promised more text, „Weiterlesen" led to almost nothing, and both were wrong. How much
 * fits depends on the card's width, the length of the words, and how much room the chips and roles
 * below leave over — none of which a constant can know.
 *
 * **Still not `-webkit-line-clamp`.** That property does the visual half well and the rest not at
 * all: whether the ellipsis appears, and where, differs between browsers, and it cannot be asked
 * whether it cut anything — which is what decides if „Weiterlesen" belongs under the card. So the
 * measuring happens here and the answer is a real string, which survives being copied and read
 * aloud.
 *
 * The cut lands on the last space before the limit, so a word is never split. A text with no space
 * in its first `limit` characters — one very long word — is cut where the limit falls, because the
 * alternative is showing all of it.
 */

export type Shortened = {
  text: string
  /** True where something was left out, which is the only reason to offer „Weiterlesen". */
  wasCut: boolean
}

/** A space before it, so the ellipsis reads as a pause rather than as part of the last word. */
export const ELLIPSIS = ' …'

/**
 * The text up to `limit` characters, ending at a word boundary and without trailing punctuation —
 * a comma or a full stop left hanging before the ellipsis reads like a typo rather than a cut.
 */
export function cutAtWord(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }

  const upToLimit = text.slice(0, limit)
  const lastSpace = upToLimit.lastIndexOf(' ')

  return (lastSpace > 0 ? upToLimit.slice(0, lastSpace) : upToLimit).replace(/[\s,;:.!?—–-]+$/u, '')
}

/**
 * The longest form of `description` that `fits` accepts.
 *
 * `fits` is the caller's measuring tape: the card writes the candidate into its own paragraph and
 * reports whether it still overflows. Passed in rather than measured here so this stays testable
 * without a browser — and so the same search serves any box that can answer the question.
 *
 * A binary search rather than a walk: a description runs to eight thousand characters, and eight
 * hundred measurements would be eight hundred reflows. Thirteen answer the same question.
 */
export function shortenToFit(description: string, fits: (candidate: string) => boolean): Shortened {
  const text = description.trim()

  if (fits(text)) {
    return { text, wasCut: false }
  }

  // The invariant: `low` always fits, `high` is the first length not known to fit. Both are
  // character counts of the *uncut* text; `cutAtWord` turns one into what is shown.
  let low = 0
  let high = text.length

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)

    if (fits(cutAtWord(text, middle) + ELLIPSIS)) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  return { text: cutAtWord(text, low) + ELLIPSIS, wasCut: true }
}
