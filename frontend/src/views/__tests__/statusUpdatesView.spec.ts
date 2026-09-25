import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { VueQueryPlugin } from '@tanstack/vue-query'
import StatusUpdatesView from '@/views/StatusUpdatesView.vue'
import StatusFeed from '@/components/status/StatusFeed.vue'

/**
 * Die Seite mit allen Statusmeldungen, und der Kasten, der auf sie verweist.
 *
 * **Der Fall, für den es sie gibt:** Ältere Meldungen verschwanden. Der Kasten auf der Startseite
 * holte eine Seite und fragte nie wieder nach — der Server konnte längst blättern, es rief nur
 * niemand.
 */

function statusUpdate(id: string, body: string) {
  return {
    id,
    body,
    createdAt: '2026-09-06T10:00:00.000Z',
    createdBy: 'u1',
    createdByUsername: 'federkiel',
    commentCount: 0,
  }
}

const firstPage = {
  status: 200,
  data: { results: [statusUpdate('s1', 'Die neueste.')], nextCursor: 's1' },
}

const lastPage = {
  status: 200,
  data: { results: [statusUpdate('s0', 'Die allererste.')], nextCursor: null },
}

const list = vi.fn<(body: { limit: number; before?: string }) => Promise<unknown>>()

vi.mock('@/api/status-updates/status-updates', () => ({
  listStatusUpdates: (body: { limit: number; before?: string }) => list(body),
  getListStatusUpdatesQueryKey: (body?: unknown) => ['QUERY', 'api', 'status-updates', body],
  createStatusUpdate: () => Promise.resolve({ status: 201, data: statusUpdate('neu', 'Neu.') }),
  createStatusUpdateComment: () => Promise.resolve({ status: 201, data: {} }),
  useGetStatusUpdateSubscription: () => ({
    data: ref({ status: 200, data: { subscribed: true, explicit: false } }),
    refetch: () => Promise.resolve(),
  }),
  setStatusUpdateSubscription: () => Promise.resolve({ status: 200, data: {} }),
  useListStatusUpdateComments: () => ({
    data: ref({ status: 200, data: { totalResults: 0, results: [] } }),
    isPending: ref(false),
    refetch: () => Promise.resolve(),
  }),
}))

vi.mock('@/components/layout/AppLayout.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

// Der Einstellungsdialog bringt eigene Abfragen mit — hier geht es um die Liste, nicht um ihn.
vi.mock('@/components/status/StatusSettingsDialog.vue', () => ({
  default: { template: '<button data-settings />' },
}))

function mountWith(component: unknown, hash = '') {
  return mount(component as Parameters<typeof mount>[0], {
    global: {
      plugins: [VueQueryPlugin],
      stubs: { RouterLink: RouterLinkStub },
      mocks: { $route: { hash } },
    },
  })
}

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRoute: () => ({ hash: '' }),
}))

beforeEach(() => {
  list.mockReset()
  list.mockImplementation(({ before }) =>
    Promise.resolve(before === undefined ? firstPage : lastPage),
  )
})

describe('Die Seite mit allen Statusmeldungen', () => {
  it('lädt ältere nach und hängt sie an', async () => {
    const wrapper = mountWith(StatusUpdatesView)
    await flushPromises()

    expect(wrapper.text()).toContain('Die neueste.')
    expect(wrapper.text()).not.toContain('Die allererste.')

    const more = wrapper.findAll('button').find((button) => button.text().includes('Mehr'))
    expect(more).toBeDefined()

    await more?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Die allererste.')
    // Die neuere bleibt stehen: angehängt, nicht ersetzt.
    expect(wrapper.text()).toContain('Die neueste.')
  })

  it('bietet nichts mehr an, wenn die erste erreicht ist, und sagt das', async () => {
    const wrapper = mountWith(StatusUpdatesView)
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Mehr'))
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('button').some((button) => button.text().includes('Mehr'))).toBe(false)
    expect(wrapper.text()).toContain('Das war die erste.')
  })
})

describe('Der Kasten auf der Startseite', () => {
  it('holt zehn und blättert nicht', async () => {
    // Zehn, weil der Kasten ein Blick ist: Was darüber hinausgeht, steht auf der Seite.
    const wrapper = mountWith(StatusFeed)
    await flushPromises()

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }))
    expect(wrapper.findAll('button').some((button) => button.text().includes('Mehr'))).toBe(false)
  })

  it('verweist auf die Seite mit allen', async () => {
    const wrapper = mountWith(StatusFeed)
    await flushPromises()

    const toPage = wrapper
      .findAllComponents(RouterLinkStub)
      .filter(
        (link) => (link.props('to') as { name?: string } | undefined)?.name === 'statusUpdates',
      )

    // Zwei Wege dorthin: die Uhrzeit der Meldung und der Verweis unter dem Kasten.
    expect(toPage.length).toBeGreaterThanOrEqual(1)
    expect(wrapper.text()).toContain('Alle Statusmeldungen')
  })
})
