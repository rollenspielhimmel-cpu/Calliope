import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import NewVersionNotice from '@/components/layout/NewVersionNotice.vue'
import { backendIsNewer, noteRelease } from '@/lib/api/release'

/**
 * Der Hinweis, dass das Backend weiter ist als diese Seite.
 *
 * **Warum er überhaupt geprüft wird:** Ein Deploy tauscht den Server aus, nicht die offenen
 * Browser. Läuft der Vergleich falsch herum, steht der Satz entweder dauernd da — dann liest ihn
 * niemand mehr — oder nie, und dann arbeitet jemand tagelang gegen ein Backend, das seinen Stand
 * nicht kennt. Beides fällt erst auf, wenn es zu spät ist.
 */

vi.mock('@/lib/branding', () => ({ COMMIT: 'abc1234' }))

function headers(release?: string): Headers {
  const value = new Headers()
  if (release !== undefined) {
    value.set('X-Release', release)
  }
  return value
}

beforeEach(() => {
  backendIsNewer.value = false
})

describe('noteRelease', () => {
  it('schlägt an, wenn das Backend einen anderen Stand meldet', () => {
    noteRelease(headers('def5678'))

    expect(backendIsNewer.value).toBe(true)
  })

  it('bleibt still beim selben Stand', () => {
    noteRelease(headers('abc1234'))

    expect(backendIsNewer.value).toBe(false)
  })

  it('bleibt still, wenn niemand gestempelt hat', () => {
    // In der Entwicklung schickt das Backend die Kopfzeile gar nicht. Ohne zwei Stände gibt es
    // keine Aussage über sie, und eine Warnung wäre dort reines Rauschen.
    noteRelease(headers())

    expect(backendIsNewer.value).toBe(false)
  })

  it('springt nicht zurück, wenn danach wieder etwas Gleiches kommt', () => {
    noteRelease(headers('def5678'))
    noteRelease(headers('abc1234'))

    // Zurückzuspringen hieße zu behaupten, der Stand sei wieder gleich. Wird er in diesem Tab
    // nicht mehr.
    expect(backendIsNewer.value).toBe(true)
  })
})

describe('NewVersionNotice', () => {
  it('zeigt nichts, solange die Stände zusammenpassen', () => {
    expect(mount(NewVersionNotice).text()).toBe('')
  })

  it('sagt einen Satz und bietet das Neuladen an', async () => {
    const wrapper = mount(NewVersionNotice)
    backendIsNewer.value = true
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Eine neue Fassung ist da')

    // **Nie von selbst.** Wer gerade eine lange Nachricht tippt, verlöre sie — der Hinweis fragt,
    // er handelt nicht.
    expect(wrapper.findAll('button')).toHaveLength(1)
  })
})
