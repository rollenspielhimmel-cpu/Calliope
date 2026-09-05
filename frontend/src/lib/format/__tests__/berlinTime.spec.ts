import { describe, expect, it } from 'vitest'
import { berlinToUtc, formatBerlin, utcToBerlin } from '@/lib/format/berlinTime'

/**
 * Die Umrechnung, an der eine Rundmail eine Stunde zu früh oder zu spät ankommt.
 *
 * **Die Fälle, die zählen, sind die um die Zeitumstellung herum.** Eine „plus zwei Stunden"-Regel
 * besteht jeden Test, den man im Sommer schreibt, und liegt ab Ende Oktober falsch — deshalb steht
 * hier je ein Datum aus beiden Hälften des Jahres und die Nacht dazwischen.
 *
 * 2026: Sommerzeit vom 29. März bis zum 25. Oktober.
 */

describe('berlinToUtc', () => {
  it('rechnet Sommerzeit um: 20 Uhr in Berlin sind 18 Uhr UTC', () => {
    expect(berlinToUtc('2026-09-06T20:00')).toBe('2026-09-06T18:00:00.000Z')
  })

  it('rechnet Winterzeit um: 20 Uhr in Berlin sind 19 Uhr UTC', () => {
    expect(berlinToUtc('2026-12-06T20:00')).toBe('2026-12-06T19:00:00.000Z')
  })

  /**
   * Der Tag der Umstellung selbst. Um 03:00 gilt die Sommerzeit bereits — eine Regel, die den
   * Versatz „von heute" nähme, läge hier um eine Stunde daneben.
   */
  it('trifft den Nachmittag des Umstellungstags im Frühjahr', () => {
    expect(berlinToUtc('2026-03-29T15:00')).toBe('2026-03-29T13:00:00.000Z')
  })

  it('trifft den Nachmittag des Umstellungstags im Herbst', () => {
    expect(berlinToUtc('2026-10-25T15:00')).toBe('2026-10-25T14:00:00.000Z')
  })

  /**
   * Die Stunde, die es nicht gibt: In der Nacht auf den 29. März springt die Uhr von 02:00 auf
   * 03:00. Wer 02:30 eintippt, meint einen Zeitpunkt, den es nicht gibt — das Ergebnis landet auf
   * der Stunde danach, wie es ein Kalender auch täte, statt eine Fehlermeldung zu zeigen, die
   * niemand versteht.
   */
  it('beantwortet die Stunde, die es nicht gibt, statt zu scheitern', () => {
    const answer = berlinToUtc('2026-03-29T02:30')

    expect(answer).toBe('2026-03-29T01:30:00.000Z')
  })

  /**
   * Die doppelte Stunde im Herbst. 02:30 gibt es zweimal — einmal in der Sommerzeit (00:30 UTC)
   * und einmal danach (01:30 UTC). Das Ergebnis liegt auf dem zweiten, also später statt früher.
   *
   * Festgehalten, damit die Antwort eine bekannte ist und keine zufällige: Wer die Umrechnung
   * später anfasst, sieht hier, welchen der beiden Zeitpunkte sie bisher lieferte.
   */
  it('beantwortet die doppelte Stunde eindeutig, und zwar später statt früher', () => {
    expect(berlinToUtc('2026-10-25T02:30')).toBe('2026-10-25T01:30:00.000Z')
  })

  it('nimmt auch einen Wert mit Sekunden entgegen', () => {
    expect(berlinToUtc('2026-09-06T20:00:00')).toBe('2026-09-06T18:00:00.000Z')
  })
})

describe('utcToBerlin', () => {
  it('ist der Rückweg von berlinToUtc', () => {
    for (const wall of ['2026-09-06T20:00', '2026-12-06T20:00', '2026-06-01T09:15']) {
      expect(utcToBerlin(berlinToUtc(wall))).toBe(wall)
    }
  })

  it('liefert die Form, die ein datetime-local erwartet', () => {
    expect(utcToBerlin('2026-09-06T18:00:00.000Z')).toBe('2026-09-06T20:00')
  })
})

describe('formatBerlin', () => {
  it('nennt Wochentag, Datum und Uhrzeit nach Berliner Uhr', () => {
    const text = formatBerlin('2026-09-06T18:00:00.000Z')

    expect(text).toContain('20:00')
    expect(text).toContain('September')
    expect(text.endsWith('Uhr')).toBe(true)
  })

  /** Im Winter dieselbe Wanduhrzeit aus einem anderen UTC-Zeitpunkt. */
  it('rechnet auch im Winter nach Berlin und nicht nach UTC', () => {
    expect(formatBerlin('2026-12-06T19:00:00.000Z')).toContain('20:00')
  })
})
