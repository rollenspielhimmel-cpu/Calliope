import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import { mount } from '@vue/test-utils'
import BlindDateParticipationPanel from '@/components/moderation/BlindDateParticipationPanel.vue'

/**
 * The table that says how somebody's Blind-Dates went.
 *
 * Behind the role gate, so it cannot be looked at without a session — the same reason
 * `moderationView.spec.ts` exists. What is asserted here is what a later edit could break without
 * anybody noticing: that the counts stay attached to the right member, that leaving and being left
 * stay apart, that reordering sends the reader back to the first page, and that an untranslated
 * reason is still shown rather than swallowed.
 */

const notPending = ref(false)

/** What the component asked the API for, which is the only way its sort and paging leave it. */
const asked = ref<Record<string, unknown> | undefined>(undefined)

/** The page lives in the URL, so `usePagedList` needs a route that behaves like one. */
const route = reactive<{ query: Record<string, string | undefined> }>({ query: {} })

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRoute: () => route,
  useRouter: () => ({
    push: ({ query }: { query: Record<string, string | undefined> }) => {
      route.query = query
    },
  }),
}))

function row(username: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `user-${username}`,
    username,
    revealed: 0,
    ended: 0,
    endedByThem: 0,
    running: 0,
    endedReasons: [] as string[],
    lastMatchedAt: '2026-08-30T10:00:00Z',
    ...overrides,
  }
}

const FULL_PAGE = {
  status: 200,
  data: {
    totalResults: 3,
    results: [
      // Three ended, and only one of them by her: the distinction the whole table exists for.
      row('federkiel', {
        ended: 3,
        endedByThem: 1,
        revealed: 1,
        endedReasons: ['name_revealed'],
      }),
      row('tintenfass', { ended: 1, revealed: 2, endedReasons: ['aufgegeben'] }),
      row('nachtfalter', { revealed: 4, running: 1 }),
    ],
  },
}

const page = ref<unknown>(FULL_PAGE)

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListBlindDateParticipation: (request: { value: Record<string, unknown> }) => {
    // Read through a getter rather than captured once: the body is a computed, and the point of
    // several of these tests is what it becomes after a click.
    return {
      data: {
        get value() {
          asked.value = request.value
          return page.value
        },
      },
      isPending: notPending,
    }
  },
}))

function panel() {
  return mount(BlindDateParticipationPanel, {
    global: {
      stubs: {
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
        ListPagination: true,
      },
    },
  })
}

function header(wrapper: ReturnType<typeof panel>, label: string) {
  return wrapper.findAll('button').find((button) => button.text() === label)!
}

describe('BlindDateParticipationPanel', () => {
  beforeEach(() => {
    asked.value = undefined
    route.query = {}
    page.value = FULL_PAGE
  })

  it('asks for the ones people ended themselves first', () => {
    panel()

    // Not „ended": being left is not a pattern about the person it happened to, and opening on
    // that number would put the wrong people at the top of the page.
    expect(asked.value).toMatchObject({ sortAttribute: 'endedByThem', sortOrder: 'desc' })
  })

  it('shows what somebody ended themselves apart from what merely ended', () => {
    const cells = panel().findAll('li')[0]!.findAll('span')

    // Enthüllt, selbst beendet, beendet, läuft — a row that collapsed the middle two would say
    // federkiel walked out of three Blind-Dates when she walked out of one.
    expect(cells.map((cell) => cell.text())).toEqual(['1', '1', '3', '0', expect.any(String)])
  })

  it("keeps each member's counts on their own row", () => {
    const rows = panel().findAll('li')

    expect(rows).toHaveLength(3)
    expect(rows[0]!.text()).toContain('federkiel')
    expect(rows[0]!.text()).toContain('Name genannt')
    expect(rows[2]!.text()).toContain('nachtfalter')
    expect(rows[2]!.text()).not.toContain('Name genannt')
  })

  it('shows a reason nobody has translated rather than dropping it', () => {
    expect(panel().findAll('li')[1]!.text()).toContain('aufgegeben')
  })

  it('sorts the name ascending and everything else descending', async () => {
    const wrapper = panel()

    await header(wrapper, 'Mitglied').trigger('click')
    expect(asked.value).toMatchObject({ sortAttribute: 'username', sortOrder: 'asc' })

    await header(wrapper, 'Enthüllt').trigger('click')
    expect(asked.value).toMatchObject({ sortAttribute: 'revealed', sortOrder: 'desc' })

    await header(wrapper, 'Selbst beendet').trigger('click')
    expect(asked.value).toMatchObject({ sortAttribute: 'endedByThem', sortOrder: 'desc' })
  })

  it('goes back to the first page when the order changes', async () => {
    // A total that actually has a second page: `usePagedList` corrects a page past the end, so
    // with the three-row fixture page 2 would be pulled back to 1 before this could assert
    // anything — and the test would then pass for the wrong reason.
    page.value = { status: 200, data: { totalResults: 60, results: FULL_PAGE.data.results } }

    const wrapper = panel()

    // Page 2 of one ordering is not page 2 of another, so an offset carried across would show a
    // stretch of the list nobody asked for.
    route.query = { page: '2' }
    await nextTick()
    expect(asked.value).toMatchObject({ offset: 25 })

    await header(wrapper, 'Läuft').trigger('click')
    await nextTick()
    expect(asked.value).toMatchObject({ sortAttribute: 'running', offset: 0 })
  })

  it('says so plainly when nobody has taken part', () => {
    page.value = { status: 200, data: { totalResults: 0, results: [] } }

    expect(panel().text()).toContain('Noch war niemand in einem Blind-Date')
  })
})
