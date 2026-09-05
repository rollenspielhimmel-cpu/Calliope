import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ModerationView from '@/views/ModerationView.vue'

/**
 * The one box on this page that changes colour, and the count in it.
 *
 * Worth a spec even though the rest of `views/` has none: the page is behind the role gate, so it
 * cannot be looked at without a session, and what is being asserted — that red means "somebody is
 * waiting" and never appears otherwise — is exactly the thing that would rot unnoticed. A box that
 * is always red is a box nobody sees.
 */

const reports = { value: { status: 200, data: { totalResults: 0 } } }
const currentUser = { value: { status: 200, data: { platformRole: 'administrator' } } }

/** Die zweite Zahl auf dieser Seite: Rundmails, die auf eine Freigabe warten. */
const broadcastQueue: { value: { status: number; data: unknown[] } } = {
  value: { status: 200, data: [] },
}

vi.mock('@/api/reports/reports', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListReports: () => ({ data: reports }),
}))

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListBroadcastQueue: () => ({ data: broadcastQueue }),
}))

// Spread rather than replaced: `lib/api/queryClient.ts` imports `getGetCurrentUserQueryKey` from
// here to recognise the session check, and a bare mock takes that with it.
vi.mock('@/api/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetCurrentUser: () => ({ data: currentUser }),
}))

function moderationView() {
  return mount(ModerationView, {
    global: {
      stubs: {
        // Rendered as a real element so its classes and its `to` can be read.
        RouterLink: { props: ['to'], template: '<a :data-to="to.name"><slot /></a>' },
        AppLayout: { template: '<div><slot /></div>' },
      },
    },
  })
}

beforeEach(() => {
  reports.value = { status: 200, data: { totalResults: 0 } }
  currentUser.value = { status: 200, data: { platformRole: 'administrator' } }
  broadcastQueue.value = { status: 200, data: [] }
})

describe('ModerationView', () => {
  it('puts the reports first, ahead of every other tile', () => {
    const links = moderationView().findAll('a')

    expect(links[0]?.attributes('data-to')).toBe('moderationReports')
  })

  it('stays an ordinary card while nothing is open', () => {
    const wrapper = moderationView()
    const box = wrapper.findAll('a')[0]

    expect(box?.classes()).toContain('bg-paper-0')
    expect(box?.classes()).not.toContain('bg-surface-alert')
    // No number at all rather than a „0": nothing is waiting, so nothing is counted at you.
    expect(box?.text()).not.toContain('offen')
    expect(box?.text()).toContain('Nichts Offenes')
  })

  it('turns red and says how many the moment one is open', () => {
    reports.value = { status: 200, data: { totalResults: 3 } }

    const box = moderationView().findAll('a')[0]

    expect(box?.classes()).toContain('bg-surface-alert')
    expect(box?.classes()).toContain('border-line-alert')
    // The real count, not a static mark: three reports and a one look the same otherwise.
    expect(box?.text()).toContain('3 offen')
  })

  it('counts one report as one', () => {
    reports.value = { status: 200, data: { totalResults: 1 } }

    expect(moderationView().findAll('a')[0]?.text()).toContain('1 offen')
  })

  it('reads a queue it could not load as nothing to answer', () => {
    // A failed count must not paint the page red: an alert nobody can act on is noise, and the
    // queue itself says what is wrong when it is opened.
    reports.value = { status: 500, data: { totalResults: 0 } } as never

    const box = moderationView().findAll('a')[0]

    expect(box?.classes()).toContain('bg-paper-0')
    expect(box?.text()).not.toContain('offen')
  })

  it('still hides the administrator-only tiles from a moderator', () => {
    currentUser.value = { status: 200, data: { platformRole: 'moderator' } }

    const text = moderationView().text()

    expect(text).toContain('IP-Adressen und Sperren')
    expect(text).not.toContain('Gesperrte E-Mail-Domains')
  })
})

/**
 * Die zweite Zahl auf dieser Seite — und sie folgt derselben Regel wie die erste: Sie erscheint
 * nur, wenn wirklich etwas wartet. Ein Zeichen, das immer da ist, wird nicht mehr gelesen.
 */
describe('Warteschlange der Rundmails', () => {
  it('sagt nichts, solange nichts auf eine Freigabe wartet', () => {
    const view = moderationView()

    expect(view.text()).not.toContain('offen')
  })

  it('zeigt, wie viele warten, sobald etwas wartet', () => {
    broadcastQueue.value = { status: 200, data: [{}, {}] }

    const view = moderationView()

    expect(view.text()).toContain('2 offen')
  })

  /**
   * Für die Moderation antwortet die Abfrage nicht — die Route ist der Administration vorbehalten.
   * Eine nicht geladene Warteschlange heißt „nichts zu tun", nicht „unbekannt": Die Kachel ist für
   * sie ohnehin nicht da, und eine Zahl aus einer fehlgeschlagenen Abfrage wäre schlimmer als keine.
   */
  it('liest eine Warteschlange, die sie nicht laden konnte, als nichts', () => {
    broadcastQueue.value = { status: 403, data: [] }

    const view = moderationView()

    expect(view.text()).not.toContain('offen')
  })
})
