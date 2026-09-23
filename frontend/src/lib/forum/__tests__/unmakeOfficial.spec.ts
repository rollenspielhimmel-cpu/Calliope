import { describe, expect, it } from 'vitest'
import { mayUnmakeOfficial } from '@/lib/forum/permission'

/**
 * Der Knopf, der auf der Beta in jedem Fall in eine Absage lief: einmal zu Recht, einmal zu
 * Unrecht angeboten. Hier steht, wann es ihn gibt.
 */
describe('mayUnmakeOfficial', () => {
  const madeAfterwards = { isOfficial: true, madeOfficialAfterwards: true }
  const writtenAsOfficial = { isOfficial: true, madeOfficialAfterwards: false }
  const ordinary = { isOfficial: false, madeOfficialAfterwards: false }
  const notTold = { isOfficial: true, madeOfficialAfterwards: null }

  it('bietet den Weg zurück bei einem nachträglich offiziellen Thread', () => {
    expect(mayUnmakeOfficial(madeAfterwards, true)).toBe(true)
  })

  it('bietet ihn nicht bei einem als offiziell geschriebenen Thread', () => {
    expect(mayUnmakeOfficial(writtenAsOfficial, true)).toBe(false)
  })

  it('bietet ihn nicht bei einem gewöhnlichen Thread', () => {
    expect(mayUnmakeOfficial(ordinary, true)).toBe(false)
  })

  it('bietet ihn niemandem außer der Administration', () => {
    expect(mayUnmakeOfficial(madeAfterwards, false)).toBe(false)
  })

  /** Wer die Herkunft nicht erfährt, bekommt auch den Knopf nicht — die API wiese ihn ab. */
  it('bietet ihn nicht, wenn die Herkunft nicht mitkommt', () => {
    expect(mayUnmakeOfficial(notTold, true)).toBe(false)
  })

  it('bietet ihn nicht, solange der Thread noch nicht da ist', () => {
    expect(mayUnmakeOfficial(undefined, true)).toBe(false)
  })
})
