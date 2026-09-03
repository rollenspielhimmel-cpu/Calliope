import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import BlindDateQueuePanel from '@/components/moderation/BlindDateQueuePanel.vue'

/**
 * Choosing the two applications that become a Blind-Date.
 *
 * The panel deliberately suggests nothing, so the only logic in it is the selection — and that is
 * where a wrong pair would come from. Three rules: never more than two, a third click replaces the
 * older choice rather than refusing, and the confirming form appears only once two are chosen.
 */

const notPending = ref(false)

function application(username: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `app-${username}`,
    createdAt: '2026-09-01T10:00:00Z',
    user: { id: `user-${username}`, username },
    onlineMinutes: 1200,
    offerTitle: null,
    plotTitle: `Handlung von ${username}`,
    writingStyle: 'prose',
    postLength: 'medium',
    roleGender: 'weiblich',
    pairing: 'offen',
    note: null,
    ...overrides,
  }
}

const queue = {
  value: {
    status: 200,
    data: [application('federkiel'), application('tintenfass'), application('nachtfalter')],
  },
}

const matchPair = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })
const decline = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListBlindDateApplications: () => ({ data: queue, isPending: notPending }),
  useMatchBlindDateApplications: () => ({ mutateAsync: matchPair, isPending: notPending }),
  useDeclineBlindDateApplication: () => ({ mutateAsync: decline, isPending: notPending }),
  getListBlindDateApplicationsQueryKey: () => ['queue'],
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

function panel() {
  return mount(BlindDateQueuePanel, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}

/** The „Auswählen" button of the nth row. */
function chooser(wrapper: ReturnType<typeof panel>, index: number) {
  return wrapper.findAll('li').at(index)?.findAll('button').at(0)
}

function state(wrapper: ReturnType<typeof panel>) {
  return wrapper.vm as unknown as { selected: string[]; plotTitle: string }
}

beforeEach(() => {
  matchPair.mockClear()
  decline.mockClear()
})

describe('BlindDateQueuePanel', () => {
  it('suggests nothing and shows no form until two are chosen', () => {
    const wrapper = panel()

    expect(wrapper.findAll('li')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('Blind-Date anlegen')
  })

  it('shows the form once two are chosen, naming both', async () => {
    const wrapper = panel()

    await chooser(wrapper, 0)?.trigger('click')
    expect(wrapper.text()).not.toContain('Blind-Date anlegen')

    await chooser(wrapper, 1)?.trigger('click')

    expect(wrapper.text()).toContain('Blind-Date anlegen')
    expect(wrapper.text()).toContain('federkiel und tintenfass')
  })

  it('a third choice replaces the older one rather than being refused', async () => {
    const wrapper = panel()

    await chooser(wrapper, 0)?.trigger('click')
    await chooser(wrapper, 1)?.trigger('click')
    await chooser(wrapper, 2)?.trigger('click')

    // Somebody correcting themselves expects the newest two, not a refusal.
    expect(state(wrapper).selected).toEqual(['app-tintenfass', 'app-nachtfalter'])
  })

  it('clicking a chosen row again lets it go', async () => {
    const wrapper = panel()

    await chooser(wrapper, 0)?.trigger('click')
    await chooser(wrapper, 0)?.trigger('click')

    expect(state(wrapper).selected).toEqual([])
  })

  it('prefills the plot from the first choice, and leaves a typed one alone', async () => {
    const wrapper = panel()

    await chooser(wrapper, 0)?.trigger('click')
    expect(state(wrapper).plotTitle).toBe('Handlung von federkiel')

    state(wrapper).plotTitle = 'Etwas anderes'
    await chooser(wrapper, 1)?.trigger('click')

    // Overwriting somebody mid-sentence would be worse than an empty box.
    expect(state(wrapper).plotTitle).toBe('Etwas anderes')
  })

  it('sends both application ids and the chosen plot', async () => {
    const wrapper = panel()

    await chooser(wrapper, 0)?.trigger('click')
    await chooser(wrapper, 1)?.trigger('click')

    const vm = state(wrapper)
    vm.plotTitle = 'Whispers of Eldermere'
    ;(vm as unknown as { synopsis: string }).synopsis = 'Zwei Fremde.'
    await wrapper.vm.$nextTick()

    await (wrapper.vm as unknown as { confirmMatch: () => Promise<void> }).confirmMatch()

    expect(matchPair).toHaveBeenCalledWith({
      data: {
        firstApplicationId: 'app-federkiel',
        secondApplicationId: 'app-tintenfass',
        plotTitle: 'Whispers of Eldermere',
        synopsis: 'Zwei Fremde.',
      },
    })
  })

  it('shows the preferences a pairing is judged on, in German', () => {
    const text = panel().text()

    // The enum is English; nothing an operator reads is.
    expect(text).toContain('Roman')
    expect(text).toContain('mittele Posts')
    expect(text).toContain('Rolle: weiblich')
    expect(text).toContain('1.200 Min. online')
  })
})
