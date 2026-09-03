import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import MemberIpDialog from '@/components/moderation/MemberIpDialog.vue'

/**
 * The addresses a member has connected from, and banning one of them.
 *
 * Two things are worth pinning down: that banning an address asks for a reason the way banning an
 * account does, and that the ban is aimed at the address the operator opened rather than at
 * whichever one happens to be first.
 */
const mocks = vi.hoisted(() => ({
  addresses: { value: undefined as unknown },
  ban: vi.fn<(variables: { data: { ipAddress: string; reason: string } }) => Promise<void>>(),
}))

/**
 * A real ref, not `{ value: false }`: a plain object is truthy, so `v-if="isPending"` would hold
 * the component on its spinner and hide what these assertions are about. Dereferenced only when a
 * hook is called, which keeps it out of the hoisted mock factory's dead zone.
 */
const notPending = ref(false)

vi.mock('@/api/moderation/moderation', () => ({
  useListIpAddressesForMember: () => ({ data: mocks.addresses, isPending: notPending }),
  useBanIpAddress: () => ({ mutateAsync: mocks.ban, isPending: notPending }),
  getListIpAddressesForMemberQueryKey: () => ['ip-addresses'],
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

function ipDialog() {
  return mount(MemberIpDialog, {
    props: { open: true, userId: 'a-user', username: 'federkiel' },
    shallow: true,
    // The address list renders for real now that `isPending` is a ref rather than a truthy
    // object, and it links to the accounts sharing an address. There is no router here.
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}

function state(wrapper: ReturnType<typeof ipDialog>) {
  return wrapper.vm as unknown as {
    entries: { ipAddress: string }[]
    banningAddress: string | undefined
    reason: string
    error: string | undefined
    startBan: (ipAddress: string) => void
    confirmBan: (ipAddress: string) => Promise<void>
  }
}

beforeEach(() => {
  mocks.addresses.value = {
    status: 200,
    data: [
      {
        ipAddress: '198.51.100.1',
        firstSeenAt: '2026-09-01T00:00:00+00:00',
        lastSeenAt: '2026-09-02T00:00:00+00:00',
        sharedWith: [{ id: 'another-user', username: 'tintenfleck' }],
      },
      {
        ipAddress: '198.51.100.2',
        firstSeenAt: '2026-09-01T00:00:00+00:00',
        lastSeenAt: '2026-09-02T00:00:00+00:00',
        sharedWith: [],
      },
    ],
  }
  mocks.ban.mockReset().mockResolvedValue(undefined)
})

describe('MemberIpDialog', () => {
  it('lists what the member connected from, shared accounts included', () => {
    const vm = state(ipDialog())

    expect(vm.entries.map((entry) => entry.ipAddress)).toEqual(['198.51.100.1', '198.51.100.2'])
  })

  it('opens the reason field for the address that was clicked, and closes it again', () => {
    const vm = state(ipDialog())

    vm.startBan('198.51.100.2')
    expect(vm.banningAddress).toBe('198.51.100.2')

    // The same button is the way back out, which is what its label says.
    vm.startBan('198.51.100.2')
    expect(vm.banningAddress).toBeUndefined()
  })

  it('bans nothing without a reason', async () => {
    const vm = state(ipDialog())

    vm.startBan('198.51.100.1')
    vm.reason = '   '
    await vm.confirmBan('198.51.100.1')

    expect(mocks.ban).not.toHaveBeenCalled()
  })

  it('bans the address it was opened for, with the trimmed reason', async () => {
    const vm = state(ipDialog())

    vm.startBan('198.51.100.2')
    vm.reason = '  Wiederholt Mehrfach-Accounts  '
    await vm.confirmBan('198.51.100.2')

    expect(mocks.ban).toHaveBeenCalledWith({
      data: { ipAddress: '198.51.100.2', reason: 'Wiederholt Mehrfach-Accounts' },
    })
    // The field closes only once it worked.
    expect(vm.banningAddress).toBeUndefined()
  })

  it('keeps the reason and says so when the ban fails', async () => {
    mocks.ban.mockRejectedValue(new Error('nope'))
    const vm = state(ipDialog())

    vm.startBan('198.51.100.1')
    vm.reason = 'Ein Grund'
    await vm.confirmBan('198.51.100.1')

    expect(vm.error).toBe('Das ist gerade nicht möglich. Versuche es später noch einmal.')
    // Nothing is thrown away: the field stays open with what was typed in it.
    expect(vm.banningAddress).toBe('198.51.100.1')
    expect(vm.reason).toBe('Ein Grund')
  })

  it('shows nothing rather than failing when the account has no stored address', () => {
    mocks.addresses.value = { status: 200, data: [] }

    expect(state(ipDialog()).entries).toEqual([])
  })
})
