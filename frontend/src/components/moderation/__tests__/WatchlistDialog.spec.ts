import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import WatchlistDialog from '@/components/moderation/WatchlistDialog.vue'

/**
 * The one field putting somebody on the watchlist needs, and the rule that it cannot be skipped:
 * an entry saying nothing is one nobody can act on later.
 *
 * The generated hook and the query client are mocked, because what is under test is the guard and
 * the payload rather than vue-query. Mounted shallow for the same reason — the dialog's own
 * chrome is shadcn's and is exercised by clicking through the real app.
 */
const add = vi.fn<(variables: { userId: string; data: { note: string } }) => Promise<void>>()

/**
 * A real ref, not `{ value: false }`: a plain object is truthy, so `v-if="isPending"` would hold
 * the component on its spinner and hide what these assertions are about. Dereferenced only when a
 * hook is called, which keeps it out of the hoisted mock factory's dead zone.
 */
const notPending = ref(false)

vi.mock('@/api/moderation/moderation', () => ({
  useAddToWatchlist: () => ({ mutateAsync: add, isPending: notPending }),
  getListWatchlistQueryKey: () => ['watchlist'],
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

function watchlistDialog(note?: string) {
  return mount(WatchlistDialog, {
    props: { open: true, userId: 'a-user', username: 'federkiel', note },
    shallow: true,
  })
}

/** The component's own state, which is what a shallow mount leaves to reach for directly. */
function state(wrapper: ReturnType<typeof watchlistDialog>) {
  return wrapper.vm as unknown as {
    draft: string
    error: string | undefined
    confirm: () => Promise<void>
  }
}

beforeEach(() => {
  add.mockReset()
  add.mockResolvedValue(undefined)
})

describe('WatchlistDialog', () => {
  it('refuses an entry with no note, and asks for nothing', async () => {
    const wrapper = watchlistDialog()
    const vm = state(wrapper)

    await vm.confirm()

    expect(add).not.toHaveBeenCalled()
    // Still open: a refused save must not look like a save that worked.
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('refuses a note of nothing but spaces, which is what Enter in an empty field sends', async () => {
    const wrapper = watchlistDialog()
    const vm = state(wrapper)

    vm.draft = '   '
    await vm.confirm()

    expect(add).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('sends the trimmed note and closes', async () => {
    const wrapper = watchlistDialog()
    const vm = state(wrapper)

    vm.draft = '  Meldet sich häufig bei Mehrfach-Accounts  '
    await vm.confirm()

    expect(add).toHaveBeenCalledWith({
      userId: 'a-user',
      data: { note: 'Meldet sich häufig bei Mehrfach-Accounts' },
    })
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('starts from the note already stored, so changing one is not retyping it', async () => {
    const wrapper = watchlistDialog('Schon vermerkt')

    // Filled when it opens, which for this mount is the moment it appears.
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(state(wrapper).draft).toBe('Schon vermerkt')
  })

  it('stays open and says so when the request fails', async () => {
    add.mockRejectedValue(new Error('nope'))

    const wrapper = watchlistDialog()
    const vm = state(wrapper)

    vm.draft = 'Ein Vermerk'
    await vm.confirm()

    expect(vm.error).toBe('Das ist gerade nicht möglich. Versuche es später noch einmal.')
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })
})
