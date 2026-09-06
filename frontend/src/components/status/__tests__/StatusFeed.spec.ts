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
  commentCount: 1,
}

const existingComment = {
  id: 'c0',
  statusUpdateId: 's1',
  body: 'Das ist ein ziemlich langer Kommentar, der beim Zitieren gekuerzt werden muss, damit die Zeile eine Zeile bleibt.',
  createdAt: '2026-09-06T10:02:00.000Z',
  createdBy: 'u3',
  createdByUsername: 'randnotiz',
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
    Promise.resolve({ status: 200, data: { totalResults: 1, results: [existingComment] } }),
  createStatusUpdateComment: (...args: unknown[]) => createComment(...args),
}))

async function feedWithCommentsOpen() {
  const wrapper = mount(StatusFeed, {
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()

  // Die Kommentare hängen hinter dem Aufklapper; ohne ihn gibt es kein Feld.
  const toggles = wrapper.findAll('button')
  const comments = toggles.find((button) => button.text().includes('1'))
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

describe('Zitieren', () => {
  it('setzt den Bezug ins Feld und kürzt einen langen Kommentar', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await feedWithCommentsOpen()

    const quote = wrapper.findAll('button').find((button) => button.text() === '· Zitieren')
    expect(quote?.exists()).toBe(true)

    await quote?.trigger('click')

    const field = wrapper.find('input[type="text"]')
    const value = (field.element as HTMLInputElement).value

    // Der Name gehört dazu, sonst weiß niemand, worauf sich das Zitat bezieht.
    expect(value).toContain('@randnotiz')
    expect(value).toContain('Das ist ein ziemlich langer Kommentar')

    // Gekürzt: Ein Kommentar steht hier auf einer Zeile, und das Zitat gehört mit darauf.
    expect(value).toContain('…')
    expect(value).not.toContain('eine Zeile bleibt')

    // Und der Blinkstrich steht dahinter, damit man einfach weiterschreibt.
    expect(value.endsWith(' ')).toBe(true)
  })

  it('stellt das Zitat vor das, was schon getippt war', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await feedWithCommentsOpen()
    const field = wrapper.find('input[type="text"]')

    await field.setValue('Sehe ich anders.')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '· Zitieren')
      ?.trigger('click')

    const value = (field.element as HTMLInputElement).value

    // Wer schon etwas getippt hat, meint die Antwort — und die gehört hinter das Zitat.
    expect(value.indexOf('@randnotiz')).toBeLessThan(value.indexOf('Sehe ich anders.'))
  })
})
