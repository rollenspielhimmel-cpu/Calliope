import { describe, expect, it } from 'vitest'
import { cutAtWord, ELLIPSIS, shortenToFit } from '@/lib/blindDate/truncate'

/**
 * Shortening a plot for a card.
 *
 * The two answers this gives are what the card renders: the text, and whether anything was left
 * out — the second decides if „Weiterlesen" appears at all, and a link to something you have
 * already read whole is a small betrayal.
 *
 * **The bug these were rewritten for:** the cut used to happen at 280 characters, so a plot of 293
 * ended in „…" while two lines of the box stood empty. The measuring now belongs to the card, and
 * this file hands `shortenToFit` a stand-in for it — a box that holds so many characters — which
 * is the whole reason the measuring is a parameter rather than a `scrollHeight` read in here.
 */

/** A card that fits `capacity` characters, counting the ellipsis like any other text. */
function boxHolding(capacity: number): (candidate: string) => boolean {
  return (candidate) => candidate.length <= capacity
}

const long = 'Wort '.repeat(200).trim()

describe('shortenToFit', () => {
  it('leaves a description that fits exactly as it is', () => {
    const short = 'Zwei Fremde treffen in einer Nacht aufeinander.'

    expect(shortenToFit(short, boxHolding(500))).toEqual({ text: short, wasCut: false })
  })

  /** The case that was wrong: room to spare, and an ellipsis promising more anyway. */
  it('adds no ellipsis while the text still fits, however long it is', () => {
    const result = shortenToFit(long, boxHolding(long.length))

    expect(result.wasCut).toBe(false)
    expect(result.text).not.toContain('…')
  })

  it('cuts and says so once the text no longer fits', () => {
    const result = shortenToFit(long, boxHolding(100))

    expect(result.wasCut).toBe(true)
    expect(result.text.endsWith(ELLIPSIS)).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(100)
  })

  /** The point of measuring: a bigger box shows more, and the same text is cut differently. */
  it('shows as much as the box holds', () => {
    const narrow = shortenToFit(long, boxHolding(100))
    const wide = shortenToFit(long, boxHolding(400))

    expect(wide.text.length).toBeGreaterThan(narrow.text.length)
    expect(wide.text.length).toBeLessThanOrEqual(400)
  })

  it('never splits a word', () => {
    const { text } = shortenToFit(long, boxHolding(103))

    expect(text.slice(0, -ELLIPSIS.length).endsWith('Wort')).toBe(true)
  })

  it('leaves no comma hanging in front of the ellipsis', () => {
    const withComma = `${'x'.repeat(60)} Wort, weiter und weiter und weiter`

    expect(shortenToFit(withComma, boxHolding(70)).text).not.toContain(', …')
  })

  /** One very long word: there is no space to cut at, so it is cut where the box ends. */
  it('cuts a single endless word rather than showing all of it', () => {
    const oneWord = 'a'.repeat(500)
    const { text, wasCut } = shortenToFit(oneWord, boxHolding(80))

    expect(wasCut).toBe(true)
    expect(text.length).toBeLessThanOrEqual(80)
  })

  it('trims the description before measuring it', () => {
    const padded = `   ${'a'.repeat(10)}   `

    expect(shortenToFit(padded, boxHolding(50))).toEqual({ text: 'a'.repeat(10), wasCut: false })
  })

  /**
   * A box too small for anything is still answered, rather than looping: the search settles on
   * nothing plus the ellipsis, which is what a card that narrow can show.
   */
  it('answers even when nothing fits', () => {
    const result = shortenToFit(long, () => false)

    expect(result.wasCut).toBe(true)
    expect(result.text).toBe(ELLIPSIS)
  })
})

describe('cutAtWord', () => {
  it('returns a short text untouched', () => {
    expect(cutAtWord('kurz', 100)).toBe('kurz')
  })

  it('cuts at the last space before the limit', () => {
    expect(cutAtWord('eins zwei drei vier', 12)).toBe('eins zwei')
  })
})
