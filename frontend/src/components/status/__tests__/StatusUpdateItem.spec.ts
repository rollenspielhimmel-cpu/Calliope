import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { VueQueryPlugin } from '@tanstack/vue-query'
import StatusUpdateItem from '@/components/status/StatusUpdateItem.vue'

/**
 * Eine Statusmeldung mit ihren Kommentaren.
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
  useListStatusUpdateComments: () => ({
    data: ref({ status: 200, data: { totalResults: 1, results: [existingComment] } }),
    isPending: ref(false),
    refetch: () => Promise.resolve(),
  }),
  createStatusUpdateComment: (...args: unknown[]) => createComment(...args),
  listStatusUpdates: () =>
    Promise.resolve({ status: 200, data: { results: [update], nextCursor: null } }),
  getListStatusUpdatesQueryKey: () => ['QUERY', 'api', 'status-updates', {}],
}))

function item(layout: 'box' | 'page' = 'box') {
  return mount(StatusUpdateItem, {
    props: { update, layout },
    global: { plugins: [VueQueryPlugin], stubs: { RouterLink: RouterLinkStub } },
  })
}

async function itemWithCommentsOpen(layout: 'box' | 'page' = 'box') {
  const wrapper = item(layout)
  await flushPromises()

  // Die Kommentare hängen hinter dem Aufklapper; ohne ihn gibt es kein Feld.
  const toggle = wrapper.findAll('button').find((button) => button.text().includes('1'))
  await toggle?.trigger('click')
  await flushPromises()

  return wrapper
}

describe('StatusUpdateItem, kommentieren', () => {
  it('leert das Kommentarfeld, nachdem der Kommentar angekommen ist', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await itemWithCommentsOpen()
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

    const wrapper = await itemWithCommentsOpen()
    const field = wrapper.find('input[type="text"]')

    await field.setValue('Immerhin eine.')
    await field.trigger('keydown.enter')
    await flushPromises()

    expect((field.element as HTMLInputElement).value).toBe('Immerhin eine.')
  })

  /**
   * Der Scrollbereich in einem Scrollbereich: Er saß im Kasten, der selbst scrollt, und zeigte
   * vier Kommentare durch ein Guckloch von 160 Pixeln. Jetzt scrollt nur der Kasten.
   */
  it('setzt die Kommentare nicht in einen eigenen Scrollbereich', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await itemWithCommentsOpen()

    expect(wrapper.html()).not.toContain('max-h-40')
    expect(wrapper.findAll('.overflow-y-auto')).toHaveLength(0)
  })
})

describe('StatusUpdateItem, der Weg zur Seite', () => {
  it('führt von der Uhrzeit im Kasten auf die Seite, zu genau dieser Meldung', async () => {
    const wrapper = item('box')
    await flushPromises()

    const links = wrapper.findAllComponents(RouterLinkStub)
    const toPage = links.find(
      (link) => (link.props('to') as { name?: string } | undefined)?.name === 'statusUpdates',
    )

    expect(toPage).toBeDefined()
    expect(toPage?.props('to')).toMatchObject({ name: 'statusUpdates', hash: '#s1' })
  })

  it('verweist auf der Seite selbst nicht auf die Seite', async () => {
    // Ein Verweis auf die Stelle, an der man schon steht, ist kein Angebot, sondern Rauschen.
    const wrapper = item('page')
    await flushPromises()

    const links = wrapper.findAllComponents(RouterLinkStub)
    const toPage = links.find(
      (link) => (link.props('to') as { name?: string } | undefined)?.name === 'statusUpdates',
    )

    expect(toPage).toBeUndefined()
  })

  /** Der Anker, auf den die Uhrzeit zeigt — ohne ihn landet man oben statt bei der Meldung. */
  it('trägt ihre Kennung als Anker', async () => {
    const wrapper = item('page')
    await flushPromises()

    expect(wrapper.find('#s1').exists()).toBe(true)
  })
})

describe('Zitieren', () => {
  it('setzt den Bezug ins Feld und kürzt einen langen Kommentar', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await itemWithCommentsOpen()

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

    const wrapper = await itemWithCommentsOpen()
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
