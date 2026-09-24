import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import StatusBody from '@/components/status/StatusBody.vue'

/**
 * Der gekürzte Text einer Statusmeldung.
 *
 * **Der Fall, für den es diese Datei gibt:** Eine Meldung darf vier Tausend Zeichen lang sein, und
 * eine einzige davon nahm den ganzen Kasten ein. Man sah dann eine Meldung statt zehn.
 *
 * **Warum hier gemessen wird und nicht gezählt** — und warum dieser Test ein Maßband erfindet:
 * jsdom setzt kein Layout, also sind `scrollHeight` und `clientHeight` dort beide null, und alles
 * „passt". Die beiden Eigenschaften werden deshalb ersetzt: eine feste Deckelung, und eine Höhe,
 * die mit der Textlänge wächst. Was geprüft wird, ist nicht die Arithmetik der Suche — die steht in
 * `lib/text/__tests__/shortenToFit.spec.ts` — sondern dass die Komponente das Ergebnis richtig
 * anbietet: „…" und „weiterlesen" nur dann, wenn wirklich etwas fehlt.
 */

const SHORT = 'Heute nur eine Zeile geschrieben.'
const LONG = `Langer Probetext, ${'noch ein Stück Text, '.repeat(40)}und hier endet er.`

/** Ab wie vielen Zeichen der erfundene Kasten überläuft. */
const CAP = 120

function measureBy(cap: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 100
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return (this.textContent?.length ?? 0) > cap ? 200 : 100
    },
  })
}

beforeEach(() => {
  // vueuse beobachtet das Element; jsdom kennt ResizeObserver nicht.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  measureBy(CAP)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function body(text: string) {
  return mount(StatusBody, { props: { text, lines: 4 }, attachTo: document.body })
}

describe('StatusBody', () => {
  it('lässt einen Text, der passt, ganz stehen — ohne „…" und ohne Angebot', async () => {
    // Ein Angebot, das zu dem führt, was man schon gelesen hat, ist ein kleiner Betrug.
    const wrapper = body(SHORT)
    await flushPromises()

    expect(wrapper.text()).toContain(SHORT)
    expect(wrapper.text()).not.toContain('…')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('kürzt einen Text, der nicht passt, und bietet „weiterlesen" an', async () => {
    const wrapper = body(LONG)
    await flushPromises()

    const paragraph = wrapper.find('p')
    expect(paragraph.text().length).toBeLessThan(LONG.length)
    expect(paragraph.text()).toContain('…')
    expect(wrapper.find('button').text()).toBe('weiterlesen')
  })

  it('zeigt nach dem Aufklappen alles und den Weg zurück', async () => {
    const wrapper = body(LONG)
    await flushPromises()

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('p').text()).toContain('und hier endet er.')
    // Ohne „weniger" ließe sich eine aufgeklappte Meldung nicht wieder wegräumen.
    expect(wrapper.find('button').text()).toBe('weniger')
  })

  it('kürzt wieder, wenn man zusammenklappt', async () => {
    const wrapper = body(LONG)
    await flushPromises()

    await wrapper.find('button').trigger('click')
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('p').text()).not.toContain('und hier endet er.')
    expect(wrapper.find('button').text()).toBe('weiterlesen')
  })

  /** Mittig wurde zweimal probiert und zweimal verworfen — Fließtext liest sich linksbündig. */
  it('stellt den Absatz nirgends mittig', async () => {
    const wrapper = mount(StatusBody, { props: { text: LONG, lines: 3 } })
    await flushPromises()

    expect(wrapper.find('p').classes()).not.toContain('text-center')
  })

  /**
   * **Der Fall, für den das Angebot im Text steht:** Darunter gesetzt bekam „… weiterlesen" eine
   * eigene Zeile, auch wenn die letzte Textzeile nach zwei Wörtern endete — eine ganze Zeile für
   * zwei Wörter, in einem Kasten, in dem jede zählt.
   */
  it('setzt „weiterlesen" in denselben Absatz wie den Text', async () => {
    const wrapper = body(LONG)
    await flushPromises()

    const paragraph = wrapper.find('p')
    expect(paragraph.find('button').exists()).toBe(true)
    // Und direkt hinter dem Text, ohne trennbaren Abstand: „…" und „weiterlesen" gehören zusammen.
    expect(paragraph.find('button').classes()).toContain('whitespace-nowrap')
  })

  /** Der Ort entscheidet, nicht der Text: Die Deckelung steht in Zeilen, nicht in Zeichen. */
  it('deckelt die Höhe nach der Zeilenzahl, die der Ort vorgibt', async () => {
    const wrapper = mount(StatusBody, { props: { text: SHORT, lines: 4 } })
    await flushPromises()

    expect(wrapper.find('p').attributes('style')).toContain('max-height')
  })
})
