import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MemberModerationTools from '@/components/moderation/MemberModerationTools.vue'
import ModerationToolButton from '@/components/moderation/ModerationToolButton.vue'
import { useIpAddressView } from '@/composables/useIpAddressView'

/**
 * The row of operator icons on a profile: which of them are there at all, and what the eye does
 * on each of its two states.
 *
 * The generated hooks are mocked — what is under test is this component's own logic — but
 * `useIpAddressView` is the real one, because whether the addresses are offered *is* the switch
 * and mocking it would test nothing.
 */
const mocks = vi.hoisted(() => ({
  /** Assigned by the factory below, which is where the ref can actually be made. */
  setWatchlist: undefined as unknown as (value: unknown) => void,
  remove: vi.fn<(variables: { userId: string }) => Promise<void>>(),
}))

/**
 * A real `ref`, not a plain `{ value }`: the component reads the list inside a `computed`, so a
 * holder that is not reactive would only ever be right if it were filled before mounting — and
 * the transition from "not watched" to "watched" is exactly what has to be observed here.
 */
vi.mock('@/api/moderation/moderation', async () => {
  const { ref } = await import('vue')
  const watchlist = ref<unknown>(undefined)

  mocks.setWatchlist = (value) => {
    watchlist.value = value
  }

  return {
    useListWatchlist: () => ({ data: watchlist }),
    useRemoveFromWatchlist: () => ({ mutateAsync: mocks.remove, isPending: ref(false) }),
    getListWatchlistQueryKey: () => ['watchlist'],
  }
})

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

/** The shape the generated query hook answers with, which the component reads by status. */
function watchlistHolding(...usernames: { id: string; note: string }[]) {
  return {
    status: 200,
    data: usernames.map((entry) => ({
      user: { id: entry.id, username: 'federkiel' },
      note: entry.note,
      addedBy: null,
      addedAt: '2026-09-02T00:00:00+00:00',
    })),
  }
}

/**
 * Not `shallow`: the buttons sit inside `TooltipProvider`, and a stubbed component renders no
 * slot — stubbing it would take every button with it and leave a test that passes on nothing.
 * Only the three dialogs are stubbed, which are what this row opens rather than what it is.
 */
function tools(options: { mayModerate?: boolean; isOwnProfile?: boolean } = {}) {
  return mount(MemberModerationTools, {
    props: {
      userId: 'a-user',
      username: 'federkiel',
      mayModerate: options.mayModerate ?? true,
      isOwnProfile: options.isOwnProfile ?? false,
    },
    global: {
      stubs: {
        WatchlistDialog: true,
        MemberStrikeDialog: true,
        MemberIpDialog: true,
      },
    },
  })
}

/** The labels of the icons actually rendered, which is what says a tool is offered. */
function labels(wrapper: ReturnType<typeof tools>): string[] {
  return wrapper
    .findAllComponents(ModerationToolButton)
    .map((button) => String(button.props('label')))
}

function eye(wrapper: ReturnType<typeof tools>) {
  return wrapper
    .findAllComponents(ModerationToolButton)
    .find((button) => String(button.props('label')).includes('Beobachtungsliste'))
}

const { enabled: ipAddressViewEnabled } = useIpAddressView()

beforeEach(() => {
  mocks.setWatchlist(watchlistHolding())
  mocks.remove.mockReset()
  mocks.remove.mockResolvedValue(undefined)
  ipAddressViewEnabled.value = false
})

describe('MemberModerationTools', () => {
  it('offers nothing at all to somebody without a platform role', () => {
    const wrapper = tools({ mayModerate: false })

    expect(labels(wrapper)).toEqual([])
  })

  it('leaves the addresses out entirely while the switch is off', () => {
    const wrapper = tools()

    // Absent, not merely inactive: an address says where somebody sits, so it is not offered
    // on every profile that happens to open.
    expect(labels(wrapper)).not.toContain('IP-Adressen')
    expect(wrapper.findAllComponents(ModerationToolButton)).toHaveLength(2)
  })

  it('offers the addresses once the switch is on', async () => {
    ipAddressViewEnabled.value = true
    const wrapper = tools()
    await nextTick()

    expect(labels(wrapper)).toContain('IP-Adressen')
  })

  it('leaves the strike tool off one own profile, where it could not be used anyway', () => {
    const wrapper = tools({ isOwnProfile: true })

    expect(labels(wrapper)).not.toContain('Verwarnungen und Sperrungen')
  })

  it('opens the note field rather than saving when the member is not watched yet', async () => {
    const wrapper = tools()

    await eye(wrapper)?.vm.$emit('click')
    await nextTick()

    // The dialog, because a note is required; and nothing removed, because nothing was there.
    expect(wrapper.findComponent({ name: 'WatchlistDialog' }).props('open')).toBe(true)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('opens the strike dialog from the shield, and only that one', async () => {
    const wrapper = tools()

    const shield = wrapper
      .findAllComponents(ModerationToolButton)
      .find((button) => button.props('label') === 'Verwarnungen und Sperrungen')

    await shield?.vm.$emit('click')
    await nextTick()

    expect(wrapper.findComponent({ name: 'MemberStrikeDialog' }).props('open')).toBe(true)
    // The other two stay shut: one icon opens one thing.
    expect(wrapper.findComponent({ name: 'WatchlistDialog' }).props('open')).toBe(false)
    expect(wrapper.findComponent({ name: 'MemberIpDialog' }).props('open')).toBe(false)
  })

  it('opens the addresses from the globe when the switch is on', async () => {
    ipAddressViewEnabled.value = true
    const wrapper = tools()
    await nextTick()

    const globe = wrapper
      .findAllComponents(ModerationToolButton)
      .find((button) => button.props('label') === 'IP-Adressen')

    await globe?.vm.$emit('click')
    await nextTick()

    expect(wrapper.findComponent({ name: 'MemberIpDialog' }).props('open')).toBe(true)
  })

  it('draws the eye active once the member is on the list', async () => {
    mocks.setWatchlist(watchlistHolding({ id: 'a-user', note: 'Vermerkt' }))
    const wrapper = tools()
    await nextTick()

    expect(eye(wrapper)?.props('active')).toBe(true)
    // The label names what the click will do, which is now the opposite.
    expect(eye(wrapper)?.props('label')).toBe('Von der Beobachtungsliste nehmen')
  })

  it('flips the eye to active once the entry has been saved', async () => {
    const wrapper = tools()
    await nextTick()

    expect(eye(wrapper)?.props('active')).toBe(false)
    expect(eye(wrapper)?.props('label')).toBe('Auf die Beobachtungsliste')

    // What a successful save leaves behind: the invalidated list comes back holding the entry.
    mocks.setWatchlist(watchlistHolding({ id: 'a-user', note: 'Vermerkt' }))
    await nextTick()

    expect(eye(wrapper)?.props('active')).toBe(true)
    expect(eye(wrapper)?.props('label')).toBe('Von der Beobachtungsliste nehmen')
  })

  it('removes the entry on a second click rather than asking for the note again', async () => {
    mocks.setWatchlist(watchlistHolding({ id: 'a-user', note: 'Vermerkt' }))
    const wrapper = tools()
    await nextTick()

    await eye(wrapper)?.vm.$emit('click')
    await nextTick()

    expect(mocks.remove).toHaveBeenCalledWith({ userId: 'a-user' })
    expect(wrapper.findComponent({ name: 'WatchlistDialog' }).props('open')).toBe(false)
  })

  it('says so and keeps the entry when removing fails', async () => {
    mocks.setWatchlist(watchlistHolding({ id: 'a-user', note: 'Vermerkt' }))
    mocks.remove.mockRejectedValue(new Error('nope'))
    const wrapper = tools()
    await nextTick()

    await eye(wrapper)?.vm.$emit('click')
    await nextTick()

    expect(wrapper.text()).toContain('Das ist gerade nicht möglich')
  })

  it('ignores an entry about somebody else, so the eye is per member', async () => {
    mocks.setWatchlist(watchlistHolding({ id: 'another-user', note: 'Vermerkt' }))
    const wrapper = tools()
    await nextTick()

    expect(eye(wrapper)?.props('active')).toBe(false)
  })
})
