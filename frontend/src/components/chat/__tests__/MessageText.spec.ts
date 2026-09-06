import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageText from '../MessageText.vue'

/**
 * Der Nachrichtentext, angeschnitten.
 *
 * Diese Datei ist entstanden, weil ein Postfach, das über eine Benachrichtigung geöffnet wurde,
 * leer blieb — kein Gespräch, kein leerer Zustand, nur der Schleier. So sieht es aus, wenn beim
 * Zeichnen etwas fliegt und Vue den Teilbaum abräumt, und dieses Bauteil war das neueste darin.
 */

describe('MessageText', () => {
  it('zeigt einen kurzen Text ungekürzt und ohne Knopf', () => {
    const wrapper = mount(MessageText, { props: { text: 'Kurz und gut.' } })

    expect(wrapper.text()).toContain('Kurz und gut.')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('schneidet einen langen Text an und bietet Weiterlesen', async () => {
    const long = 'Wort '.repeat(400)
    const wrapper = mount(MessageText, { props: { text: long } })

    expect(wrapper.text()).toContain('…')
    expect(wrapper.text()).toContain('Weiterlesen')

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('Weniger anzeigen')
  })

  it('kommt mit einem leeren Text zurecht', () => {
    const wrapper = mount(MessageText, { props: { text: '' } })

    expect(wrapper.find('button').exists()).toBe(false)
  })
})
