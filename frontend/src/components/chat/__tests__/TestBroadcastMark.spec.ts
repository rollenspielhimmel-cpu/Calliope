import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TestBroadcastMark from '@/components/chat/TestBroadcastMark.vue'

/**
 * Die Markierung einer Test-Rundmail: — T E S T - R U N D M A I L —, fett.
 *
 * **Gesperrt nur fürs Auge.** Was hier geprüft wird, ist das, was ein Vorleseprogramm und die Suche
 * auf der Seite sehen — nicht, wie es aussieht. Echte Leerzeichen zwischen den Buchstaben sähen
 * genauso aus, aber vorgelesen würde Buchstabe für Buchstabe, und gefunden würde das Wort nicht.
 */
describe('TestBroadcastMark', () => {
  it('steht im Dokument als gewöhnliches Wort, ohne Leerzeichen zwischen den Buchstaben', () => {
    const wrapper = mount(TestBroadcastMark)

    // Was nicht ausgeblendet ist, liest ein Vorleseprogramm: genau das eine Wort.
    const spoken = wrapper
      .findAll('span')
      .filter((each) => each.attributes('aria-hidden') === undefined)
      .map((each) => each.element.childNodes)
      .flatMap((nodes) => [...nodes].filter((node) => node.nodeType === Node.TEXT_NODE))
      .map((node) => node.textContent)
      .join('')
    expect(spoken).toBe('Test-Rundmail')
  })

  it('blendet die Gedankenstriche für Vorleseprogramme aus', () => {
    const hidden = mount(TestBroadcastMark)
      .findAll('[aria-hidden="true"]')
      .map((each) => each.text())
    expect(hidden).toEqual(['—', '—'])
  })

  it('sperrt, versalt und fettet über den Stil', () => {
    const classes = mount(TestBroadcastMark).classes()
    expect(classes).toContain('font-bold')
    expect(classes).toContain('uppercase')
    expect(classes.some((each) => each.startsWith('tracking-'))).toBe(true)
  })
})
