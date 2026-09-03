import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import IpAddressesView from '@/views/moderation/IpAddressesView.vue'

/**
 * The three tabs of the address tool, and what each of them is allowed to claim.
 *
 * Behind the role gate, so it cannot be looked at without a session — and what matters here is not
 * how it looks but what it *says*: a shared address is a reason to look, never a finding, and a
 * banned address has to be marked as banned wherever it appears or the three tabs disagree about
 * the same fact.
 */

/**
 * A real ref, not `{ value: false }`: a plain object is truthy, so `v-if="isPending"` held every
 * tab on its spinner and the assertions read an empty page. Dereferenced only when a hook is
 * called, which is what keeps it out of the hoisted factory's dead zone.
 */
const notPending = ref(false)

const overview = {
  value: {
    status: 200,
    data: {
      totalResults: 2,
      results: [
        {
          id: 'u1',
          username: 'federkiel',
          emailAddress: 'federkiel@example.invalid',
          bannedAt: null,
          ipAddresses: ['203.0.113.5', '203.0.113.9'],
          possibleAlts: [{ id: 'u2', username: 'tintenfass' }],
        },
        {
          id: 'u3',
          username: 'einzelgaenger',
          emailAddress: 'einzel@example.invalid',
          bannedAt: '2026-08-01T10:00:00Z',
          ipAddresses: [],
          possibleAlts: [],
        },
      ],
    },
  },
}

const bans = {
  value: {
    status: 200,
    data: [
      {
        ipAddress: '203.0.113.5',
        bannedAt: '2026-08-30T10:00:00Z',
        bannedBy: { id: 'u9', username: 'aufsicht' },
        reason: 'Wiederholte Belästigung',
        accounts: [
          { id: 'u1', username: 'federkiel', emailAddress: 'federkiel@example.invalid' },
          { id: 'u2', username: 'tintenfass', emailAddress: 'tinte@example.invalid' },
        ],
      },
      {
        ipAddress: '198.51.100.4',
        bannedAt: '2026-08-29T10:00:00Z',
        bannedBy: null,
        reason: 'Massenregistrierung',
        accounts: [],
      },
    ],
  },
}

const shared = {
  value: {
    status: 200,
    data: {
      totalResults: 1,
      results: [
        {
          id: '203.0.113.5',
          ipAddress: '203.0.113.5',
          accountCount: 2,
          accounts: [
            { id: 'u1', username: 'federkiel', emailAddress: 'federkiel@example.invalid' },
            { id: 'u2', username: 'tintenfass', emailAddress: 'tinte@example.invalid' },
          ],
        },
      ],
    },
  },
}

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListIpOverview: () => ({ data: overview, isPending: notPending }),
  useListBannedIps: () => ({ data: bans, isPending: notPending }),
  useListSharedIpAddresses: () => ({ data: shared, isPending: notPending }),
  useUnbanIpAddress: () => ({
    mutateAsync: vi.fn<() => Promise<unknown>>(),
    isPending: notPending,
  }),
  getListBannedIpsQueryKey: () => ['bans'],
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

// `usePagedList` keeps the page in the URL, so it needs a route to read and a router to push to.
// Neither is what these assertions are about — the two paged tabs fit on one page here.
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
}))

function tool() {
  return mount(IpAddressesView, {
    global: {
      stubs: {
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
        AppLayout: { template: '<div><slot /></div>' },
        ModerationPage: { template: '<div><slot /></div>' },
        ListPagination: true,
      },
    },
  })
}

/** The tab strip's buttons, in order. */
function tabs(wrapper: ReturnType<typeof tool>) {
  return wrapper.findAll('[role="tab"]')
}

async function open(wrapper: ReturnType<typeof tool>, label: string) {
  const button = tabs(wrapper).find((one) => one.text().startsWith(label))
  await button?.trigger('click')
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('IpAddressesView', () => {
  it('opens on the member overview', () => {
    const wrapper = tool()

    expect(tabs(wrapper)[0]?.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.text()).toContain('Mögliche Nebenaccounts')
  })

  it('counts the two tabs whose number is the news, and not the first', () => {
    const wrapper = tool()

    // „Übersicht" is every member; a count there is the member total and says nothing.
    expect(tabs(wrapper)[0]?.text()).toBe('Übersicht')
    expect(tabs(wrapper)[1]?.text()).toContain('2')
    expect(tabs(wrapper)[2]?.text()).toContain('1')
  })

  it('names a member’s addresses and the accounts sharing them', () => {
    const text = tool().text()

    expect(text).toContain('203.0.113.5')
    expect(text).toContain('203.0.113.9')
    expect(text).toContain('tintenfass')
  })

  it('says so rather than leaving a member with no session looking empty', () => {
    expect(tool().text()).toContain('Noch keine Anmeldung')
  })

  it('marks a banned address as banned in the overview too', async () => {
    // The same fact in three places has to read the same in all three, or the tabs disagree.
    const wrapper = tool()
    expect(wrapper.text()).toContain('gesperrt')

    await open(wrapper, 'Übereinstimmungen')
    expect(wrapper.text()).toContain('gesperrt')
  })

  it('names who a ban reached, with their addresses', async () => {
    const wrapper = tool()
    await open(wrapper, 'Gesperrt')

    expect(wrapper.text()).toContain('Wiederholte Belästigung')
    expect(wrapper.text()).toContain('federkiel')
    expect(wrapper.text()).toContain('tinte@example.invalid')
  })

  it('says plainly when a ban reached nobody here', async () => {
    const wrapper = tool()
    await open(wrapper, 'Gesperrt')

    // An empty account list is a real answer, not a rendering gap: an address can be banned
    // that no account here has ever used.
    expect(wrapper.text()).toContain('Kein Konto hier hat diese Adresse je genutzt')
  })

  it('calls a shared address a reason to look, not a finding', async () => {
    const wrapper = tool()
    await open(wrapper, 'Übereinstimmungen')

    // The wording is the safeguard: this is what somebody will quote back at a member.
    expect(wrapper.text()).toContain('Anlass hinzusehen, kein Befund')
    expect(wrapper.text()).toContain('2 Konten')
  })
})
