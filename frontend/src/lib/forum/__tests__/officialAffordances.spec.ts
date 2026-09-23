import { describe, expect, it } from 'vitest'
import { maySeeOfficialLog, mayUnmakeOfficial } from '@/lib/forum/permission'

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

/**
 * Der zweite Knopf, den die Beta verschluckt hat: Nach dem Zurücknehmen war der Thread nicht mehr
 * offiziell, und mit ihm verschwand die Aufzeichnung beider Namenstausche.
 */
describe('maySeeOfficialLog', () => {
  it('zeigt das Protokoll eines offiziellen Threads', () => {
    expect(maySeeOfficialLog({ hasOfficialHistory: true }, true)).toBe(true)
  })

  it('zeigt es weiterhin, nachdem „offiziell" zurückgenommen wurde', () => {
    // Der Thread ist dann gewöhnlich — und hat trotzdem etwas zu erzählen.
    expect(maySeeOfficialLog({ hasOfficialHistory: true }, true)).toBe(true)
  })

  it('zeigt kein leeres Protokoll an einem gewöhnlichen Thread', () => {
    expect(maySeeOfficialLog({ hasOfficialHistory: false }, true)).toBe(false)
  })

  it('zeigt es niemandem außer der Administration', () => {
    expect(maySeeOfficialLog({ hasOfficialHistory: true }, false)).toBe(false)
    expect(maySeeOfficialLog({ hasOfficialHistory: null }, true)).toBe(false)
  })

  it('zeigt es nicht, solange der Thread noch nicht da ist', () => {
    expect(maySeeOfficialLog(undefined, true)).toBe(false)
  })
})
