import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import StatusFeed from '@/components/status/StatusFeed.vue'

/**
 * Das Kommentarfeld einer Statusmeldung.
 *
 * **Der Fall, für den es diese Datei gibt:** Nach dem Absenden stand der Text wieder im Feld. Nicht,
 * weil das Leeren vergessen worden wäre — es stand da, als `input.value = ''` — sondern weil
 * `Input` seinen Wert selbst hält und ihn beim nächsten Zeichnen zurückschreibt. Und gezeichnet
 * wird sofort, weil die Kommentarliste sich gerade geändert hat.
 *
 * Ein Fehler, den man im Diff nicht sieht: Die Zeile, die leert, ist da und sieht richtig aus.
 */

const update = {
  id: 's1',
  body: 'Heute nur eine Zeile geschrieben.',
  createdAt: '2026-09-06T10:00:00.000Z',
  createdBy: 'u1',
  createdByUsername: 'federkiel',
  commentCount: 0,
}

const createdComment = {
  id: 'c1',
  statusUpdateId: 's1',
  body: 'Immerhin eine.',
  createdAt: '2026-09-06T10:05:00.000Z',
  createdBy: 'u2',
  createdByUsername: 'tintenfleck',
}

const createComment = vi.fn<(...args: unknown[]) => Promise<unknown>>()

vi.mock('@/api/status-updates/status-updates', () => ({
  listStatusUpdates: () =>
    Promise.resolve({ status: 200, data: { totalResults: 1, results: [update] } }),
  listStatusUpdateComments: () =>
    Promise.resolve({ status: 200, data: { totalResults: 0, results: [] } }),
  createStatusUpdateComment: (...args: unknown[]) => createComment(...args),
}))

async function feedWithCommentsOpen() {
  const wrapper = mount(StatusFeed, {
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()

  // Die Kommentare hängen hinter dem Aufklapper; ohne ihn gibt es kein Feld.
  const toggles = wrapper.findAll('button')
  const comments = toggles.find((button) => button.text().includes('0'))
  await comments?.trigger('click')
  await flushPromises()

  return wrapper
}

describe('StatusFeed', () => {
  it('leert das Kommentarfeld, nachdem der Kommentar angekommen ist', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await feedWithCommentsOpen()
    const field = wrapper.find('input[type="text"]')
    expect(field.exists()).toBe(true)

    await field.setValue('Immerhin eine.')
    await field.trigger('keydown.enter')
    await flushPromises()

    expect(createComment).toHaveBeenCalled()
    expect((field.element as HTMLInputElement).value).toBe('')
  })

  it('behält den Text, wenn das Absenden fehlschlägt', async () => {
    // Sonst wäre ein Aussetzer der Verbindung gleichbedeutend damit, das Geschriebene zu verlieren.
    createComment.mockResolvedValue({ status: 500, data: { error: 'kaputt' } })

    const wrapper = await feedWithCommentsOpen()
    const field = wrapper.find('input[type="text"]')

    await field.setValue('Immerhin eine.')
    await field.trigger('keydown.enter')
    await flushPromises()

    expect((field.element as HTMLInputElement).value).toBe('Immerhin eine.')
  })
})
