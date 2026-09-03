import { describe, expect, it } from 'vitest'
import { CARD_DESCRIPTION_LIMIT, shortenForCard } from '@/lib/blindDate/truncate'

/**
 * Shortening a plot for a card.
 *
 * The two answers this gives are what the card renders: the text, and whether anything was left
 * out — the second decides if „Weiterlesen" appears at all, and a link to something you have
 * already read whole is a small betrayal.
 *
 * The cases below are the ones a browser's own clamping got wrong, which is why this exists rather
 * than `-webkit-line-clamp`: an ellipsis that never showed, and no way to ask whether it cut.
 */

const long = 'Wort '.repeat(200).trim()

describe('shortenForCard', () => {
  it('leaves a short description exactly as it is', () => {
    const short = 'Zwei Fremde treffen in einer Nacht aufeinander.'

    expect(shortenForCard(short)).toEqual({ text: short, wasCut: false })
  })

  it('leaves one that is exactly at the limit alone', () => {
    const exact = 'a'.repeat(CARD_DESCRIPTION_LIMIT)

    expect(shortenForCard(exact).wasCut).toBe(false)
    expect(shortenForCard(exact).text).not.toContain('…')
  })

  it('cuts a longer one and says so', () => {
    const { text, wasCut } = shortenForCard(long)

    expect(wasCut).toBe(true)
    expect(text.endsWith(' …')).toBe(true)
    expect(text.length).toBeLessThanOrEqual(CARD_DESCRIPTION_LIMIT + 2)
  })

  it('never splits a word', () => {
    const { text } = shortenForCard(long)
    const withoutEllipsis = text.slice(0, -2)

    // Every word that survived is a whole one, which is what the space-boundary cut is for.
    expect(withoutEllipsis.split(' ').every((word) => word === 'Wort')).toBe(true)
  })

  it('does not leave punctuation dangling before the ellipsis', () => {
    // A comma right where the cut lands would read as a typo rather than as an omission.
    const withComma = `${'x'.repeat(CARD_DESCRIPTION_LIMIT - 20)} Wort, weiter und weiter und weiter`

    expect(shortenForCard(withComma).text).not.toContain(', …')
  })

  it('cuts a single very long word rather than showing all of it', () => {
    const oneWord = 'a'.repeat(CARD_DESCRIPTION_LIMIT * 2)
    const { text, wasCut } = shortenForCard(oneWord)

    expect(wasCut).toBe(true)
    expect(text.length).toBeLessThan(oneWord.length)
  })

  it('measures the trimmed text, not the whitespace around it', () => {
    const padded = `   ${'a'.repeat(10)}   `

    expect(shortenForCard(padded)).toEqual({ text: 'a'.repeat(10), wasCut: false })
  })
})
